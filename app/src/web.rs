use std::collections::HashSet;

use askama::Template;
use axum::body::{Body, Bytes};
use axum::extract::{Query, State};
use axum::http::header::{CONTENT_DISPOSITION, CONTENT_LENGTH, CONTENT_TYPE, COOKIE, SET_COOKIE};
use axum::http::{HeaderMap, HeaderValue};
use axum::response::{IntoResponse, Redirect, Response};
use axum::routing::{get, post};
use axum::{Form, Router};
use serde::Deserialize;
use serde_json::Value;

use crate::config::AppState;
use crate::crypto::{admin_id_from_session, sign_admin_session, token_ok};
use crate::error::AppError;
use crate::commands::{describe_query, match_history, match_person, Scope, ViewQuery, When};
use crate::logic::{
    chat_type_label, display_kind, file_fingerprint, format_stamp, is_packable_media, item_in_filter, log_level_label,
    media_is_video, reveal_label, via_label,
};
use crate::telegram;
use crate::types::*;
use crate::vault::{self, SettingsPatch};

struct Html<T: Template>(T);

impl<T: Template> IntoResponse for Html<T> {
    fn into_response(self) -> Response {
        match self.0.render() {
            Ok(body) => axum::response::Html(body).into_response(),
            Err(err) => AppError::Internal(err.to_string()).into_response(),
        }
    }
}

#[derive(Template)]
#[template(path = "gate.html")]
struct GatePage {
    phase: String,
    bot_username: String,
    error: String,
    waiting: bool,
    login_url: String,
}

#[derive(Template)]
#[template(path = "desk.html")]
struct DeskPage {
    view: String,
    title: String,
    listening: bool,
    error: String,
    kept: usize,
    dups: usize,
    people_count: usize,
    filter: String,
    query: String,
    has_any: bool,
    items: Vec<ItemVm>,
    selected: Option<ItemVm>,
    people: Vec<PersonVm>,
    logs: Vec<LogVm>,
    token_on_file: bool,
    bot_username: String,
    bot_name: String,
    offset: i64,
    settings: SettingsVm,
    sources: Vec<SourceVm>,
    scope: String,
    when: String,
    flash: bool,
    query_desc: String,
    person_id: String,
    history_rows: Vec<HistVm>,
    packable: usize,
}

#[derive(Clone)]
struct ItemVm {
    id: String,
    caption: String,
    preview: String,
    meta: String,
    reveal: String,
    duplicate: bool,
    file_id: String,
    detail: String,
    kind: String,
    hash: String,
    saved: bool,
    motion: bool,
    packable: bool,
}

struct PersonVm {
    display_name: String,
    username: String,
    hidden_id: String,
    speak_count: i64,
    last_seen: String,
    on: bool,
}

struct HistVm {
    at: String,
    kind: String,
    reveal: String,
    who: String,
    caption: String,
    preview: String,
    hash: String,
}

struct LogVm {
    at: String,
    level: String,
    title: String,
    detail: String,
}

struct SettingsVm {
    photos: bool,
    videos: bool,
    animations: bool,
    documents: bool,
    flashes: bool,
    watch_new_private: bool,
    watch_new_groups: bool,
    keep_files: bool,
}

struct SourceVm {
    id: String,
    query: String,
    resolved_title: String,
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn cookie_val(headers: &HeaderMap, name: &str) -> Option<String> {
    let raw = headers.get(COOKIE)?.to_str().ok()?;
    for part in raw.split(';') {
        if let Some(v) = part.trim().strip_prefix(&format!("{name}=")) {
            return Some(v.to_string());
        }
    }
    None
}

fn session_cookie(value: &str) -> HeaderValue {
    HeaderValue::from_str(&format!(
        "jianxia_admin={value}; Path=/; HttpOnly; SameSite=Lax; Max-Age={}",
        12 * 60 * 60
    ))
    .expect("cookie")
}

fn clear_cookie() -> HeaderValue {
    HeaderValue::from_static("jianxia_admin=; Path=/; HttpOnly; Max-Age=0")
}

async fn current_admin(state: &AppState, headers: &HeaderMap) -> Option<String> {
    let token = cookie_val(headers, "jianxia_admin")?;
    let id = admin_id_from_session(&state.config.vault_secret, &token, now_ms())?;
    let admin = vault::read_admin_id(state).await.ok()?;
    (id == admin && !admin.is_empty()).then_some(id)
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/", get(home))
        .route("/login/start", post(login_start))
        .route("/login/widget", post(login_widget))
        .route("/logout", get(logout))
        .route("/listen", post(listen_on))
        .route("/listen/stop", post(listen_off))
        .route("/arm", post(arm))
        .route("/rules", post(rules))
        .route("/source/add", post(source_add))
        .route("/source/del", post(source_del))
        .route("/item/del", post(item_del))
        .route("/thumb", get(thumb_get))
        .route("/file", get(file_get))
        .route("/export", get(export))
        .route("/pack", post(pack_post))
        .route("/telegram", post(telegram_hook))
        .with_state(state)
}

#[derive(Deserialize, Default)]
struct HomeQuery {
    #[serde(default)]
    view: String,
    #[serde(default)]
    filter: String,
    #[serde(default)]
    q: String,
    #[serde(default)]
    id: String,
    #[serde(default)]
    err: String,
    #[serde(default)]
    wait: String,
    #[serde(default)]
    denied: String,
    #[serde(default)]
    scope: String,
    #[serde(default)]
    when: String,
    #[serde(default)]
    flash: String,
    #[serde(default)]
    pid: String,
}

async fn home(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<HomeQuery>,
) -> Result<Response, AppError> {
    if current_admin(&state, &headers).await.is_some() && q.denied != "1" && q.wait != "1" {
        return Ok(render_desk(&state, &q).await?.into_response());
    }
    let claimed = vault::is_claimed(&state).await?;
    let (body, _) = vault::load_body(&state).await.unwrap_or_else(|_| (crate::logic::empty_body(), 0));
    let mut phase = if !claimed { "missing" } else { "login" }.to_string();
    if q.denied == "1" {
        phase = "denied".into();
    }
    let mut waiting = q.wait == "1";
    let mut login_url = String::new();
    if waiting {
        match vault::finish_challenge(&state).await? {
            Some((true, telegram_id)) => {
                let session = sign_admin_session(&state.config.vault_secret, &telegram_id, now_ms());
                let mut res = Redirect::to("/").into_response();
                res.headers_mut().insert(SET_COOKIE, session_cookie(&session));
                return Ok(res);
            }
            Some((false, _)) => {
                return Ok(Redirect::to("/?denied=1").into_response());
            }
            None => {
                if let Some(ch) = &body.login_challenge {
                    login_url = format!("https://t.me/{}?start=login_{}", body.bot_username, ch.code);
                }
            }
        }
    }
    if q.wait == "1" {
        waiting = true;
        phase = "login".into();
    }
    Ok(Html(GatePage {
        phase,
        bot_username: body.bot_username,
        error: q.err,
        waiting,
        login_url,
    })
    .into_response())
}

async fn render_desk(state: &AppState, q: &HomeQuery) -> Result<Html<DeskPage>, AppError> {
    let (body, _) = vault::load_body(state).await?;
    let view = match q.view.as_str() {
        "people" | "ledger" | "rules" => q.view.as_str(),
        _ => "archive",
    };
    let title = match view {
        "people" => "人物",
        "ledger" => "流水",
        "rules" => "规则",
        _ => "归档",
    };
    let filter = if q.filter.is_empty() { "all" } else { q.filter.as_str() };
    let mut items: Vec<ItemVm> = body
        .items
        .iter()
        .filter(|item| item_in_filter(item, filter, &q.q))
        .map(item_vm)
        .collect();
    if items.len() > 60 {
        items.truncate(96);
    }
    let selected = body.items.iter().find(|i| i.id == q.id).map(item_vm);
    let now = chrono::Utc::now().timestamp_millis();
    let people_query = ViewQuery {
        scope: Scope::parse(&q.scope),
        when: When::parse(&q.when),
        flash_only: q.flash == "1" || q.flash == "true",
        text: q.q.clone(),
    };
    let people: Vec<PersonVm> = body
        .people
        .iter()
        .filter(|p| match_person(p, &body.history, &people_query, now))
        .take(80)
        .map(|p| PersonVm {
            display_name: p.display_name.clone(),
            username: p.username.clone().unwrap_or_else(|| "—".into()),
            hidden_id: p.hidden_id.clone(),
            speak_count: p.speak_count,
            last_seen: format_stamp(p.last_seen),
            on: p.hidden_id == q.pid,
        })
        .collect();
    let history_rows: Vec<HistVm> = body
        .history
        .iter()
        .filter(|row| match_history(row, &people_query, now))
        .filter(|row| q.pid.is_empty() || row.hidden_id == q.pid)
        .take(80)
        .map(|row| HistVm {
            at: format_stamp(row.at),
            kind: display_kind(&row.kind, &row.caption).into(),
            reveal: reveal_label(&row.reveal).into(),
            who: format!("{} · {}", row.display_name, row.hidden_id),
            caption: if row.caption.is_empty() {
                row.chat_title.clone()
            } else {
                row.caption.clone()
            },
            preview: crate::keep::page_preview(&row.preview, &row.file_unique_id, false, &row.kind),
            hash: match row.kind {
                MediaKind::Photo | MediaKind::Video | MediaKind::Animation | MediaKind::Document => {
                    row.file_unique_id.clone()
                }
                _ => String::new(),
            },
        })
        .collect();
    let logs: Vec<LogVm> = body
        .logs
        .iter()
        .take(80)
        .map(|l| LogVm {
            at: format_stamp(l.at),
            level: log_level_label(&l.level).into(),
            title: l.title.clone(),
            detail: l.detail.clone(),
        })
        .collect();
    let sources: Vec<SourceVm> = body
        .settings
        .sources
        .iter()
        .map(|s| SourceVm {
            id: s.id.clone(),
            query: s.query.clone(),
            resolved_title: s.resolved_title.clone().unwrap_or_default(),
        })
        .collect();
    let packable = items.iter().filter(|i| i.packable).count();
    Ok(Html(DeskPage {
        view: view.into(),
        title: title.into(),
        listening: body.server_listening,
        error: q.err.clone(),
        kept: body.items.iter().filter(|i| i.status == ItemStatus::Kept).count(),
        dups: body.items.iter().filter(|i| i.status == ItemStatus::Duplicate).count(),
        people_count: body.people.len(),
        filter: filter.into(),
        query: q.q.clone(),
        has_any: !body.items.is_empty(),
        items,
        selected,
        people,
        logs,
        token_on_file: token_ok(&body.settings.token),
        bot_username: body.bot_username,
        bot_name: body.bot_name,
        offset: body.update_offset,
        settings: SettingsVm {
            photos: body.settings.photos,
            videos: body.settings.videos,
            animations: body.settings.animations,
            documents: body.settings.documents,
            flashes: body.settings.flashes,
            watch_new_private: body.settings.watch_new_private,
            watch_new_groups: body.settings.watch_new_groups,
            keep_files: body.settings.keep_files,
        },
        sources,
        scope: people_query.scope.as_str().into(),
        when: people_query.when.as_str().into(),
        flash: people_query.flash_only,
        query_desc: describe_query(&people_query),
        person_id: q.pid.clone(),
        history_rows,
        packable,
    }))
}

fn item_vm(item: &ArchiveItem) -> ItemVm {
    let caption = if item.incoming.caption.is_empty() {
        "无标题".into()
    } else {
        item.incoming.caption.clone()
    };
    let kind = display_kind(&item.incoming.kind, &item.incoming.caption);
    let hash = file_fingerprint(
        &item.incoming.kind,
        &item.incoming.file_id,
        &item.incoming.file_unique_id,
    );
    let saved = item
        .incoming
        .media_url
        .as_deref()
        .map(|url| !url.is_empty())
        .unwrap_or(false);
    ItemVm {
        id: item.id.clone(),
        caption: caption.clone(),
        preview: crate::keep::page_preview(
            &item.incoming.preview,
            &item.incoming.file_unique_id,
            saved,
            &item.incoming.kind,
        ),
        meta: format!(
            "{} · {} · {} · {}",
            kind,
            item.incoming.sender_name,
            item.incoming.sender_id,
            format_stamp(item.incoming.occurred_at)
        ),
        reveal: reveal_label(&item.incoming.reveal).into(),
        duplicate: item.status == ItemStatus::Duplicate,
        file_id: urlencoding::encode(&item.incoming.file_id).into_owned(),
        detail: format!(
            "{} · {} · {} · {}",
            kind,
            chat_type_label(&item.incoming.chat_type),
            via_label(&item.via),
            item.incoming.chat_title
        ),
        kind: kind.into(),
        hash,
        saved,
        motion: media_is_video(&item.incoming.kind, &item.incoming.caption)
            || item.incoming.kind == MediaKind::Animation,
        packable: saved && is_packable_media(&item.incoming.kind, &item.incoming.caption),
    }
}

async fn login_start(State(state): State<AppState>) -> Response {
    match vault::begin_challenge(&state).await {
        Ok(_) => Redirect::to("/?wait=1").into_response(),
        Err(err) => err.redirect_home(),
    }
}

#[derive(Deserialize)]
struct WidgetForm {
    #[serde(default)]
    id: String,
    #[serde(default)]
    first_name: String,
    #[serde(default)]
    last_name: String,
    #[serde(default)]
    username: String,
    #[serde(default)]
    photo_url: String,
    #[serde(default)]
    auth_date: String,
    #[serde(default)]
    hash: String,
}

async fn login_widget(State(state): State<AppState>, Form(form): Form<WidgetForm>) -> Response {
    let fields = vec![
        ("id".into(), form.id.clone()),
        ("first_name".into(), form.first_name),
        ("last_name".into(), form.last_name),
        ("username".into(), form.username),
        ("photo_url".into(), form.photo_url),
        ("auth_date".into(), form.auth_date),
    ];
    match vault::accept_widget(&state, &form.id, fields, &form.hash).await {
        Ok(true) => {
            let session = sign_admin_session(&state.config.vault_secret, &form.id, now_ms());
            let mut res = Redirect::to("/").into_response();
            res.headers_mut().insert(SET_COOKIE, session_cookie(&session));
            res
        }
        Ok(false) => Redirect::to("/?denied=1").into_response(),
        Err(err) => err.redirect_home(),
    }
}

async fn logout() -> Response {
    let mut res = Redirect::to("/").into_response();
    res.headers_mut().insert(SET_COOKIE, clear_cookie());
    res
}

async fn require_admin(state: &AppState, headers: &HeaderMap) -> Result<(), AppError> {
    current_admin(state, headers)
        .await
        .ok_or_else(|| AppError::Unauthorized("先用 Telegram 登录".into()))
        .map(|_| ())
}

async fn listen_on(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if let Err(err) = require_admin(&state, &headers).await {
        return err.redirect_home();
    }
    match vault::set_listening(&state, true).await {
        Ok(()) => Redirect::to("/").into_response(),
        Err(err) => err.redirect_home(),
    }
}

async fn listen_off(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if let Err(err) = require_admin(&state, &headers).await {
        return err.redirect_home();
    }
    match vault::set_listening(&state, false).await {
        Ok(()) => Redirect::to("/").into_response(),
        Err(err) => err.redirect_home(),
    }
}

async fn arm(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if let Err(err) = require_admin(&state, &headers).await {
        return err.redirect_home();
    }
    let host = headers
        .get(axum::http::header::HOST)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("localhost:8080");
    let proto = headers
        .get("x-forwarded-proto")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("http");
    match vault::arm_webhook(&state, &format!("{proto}://{host}")).await {
        Ok(()) => Redirect::to("/").into_response(),
        Err(err) => err.redirect_home(),
    }
}

#[derive(Deserialize)]
struct RulesForm {
    #[serde(default)]
    flashes: Option<String>,
    #[serde(default)]
    photos: Option<String>,
    #[serde(default)]
    videos: Option<String>,
    #[serde(default)]
    documents: Option<String>,
    #[serde(default)]
    animations: Option<String>,
    #[serde(default)]
    watch_new_private: Option<String>,
    #[serde(default)]
    watch_new_groups: Option<String>,
    #[serde(default)]
    keep_files: Option<String>,
}

async fn rules(State(state): State<AppState>, headers: HeaderMap, Form(form): Form<RulesForm>) -> Response {
    if let Err(err) = require_admin(&state, &headers).await {
        return err.redirect_home();
    }
    let patch = SettingsPatch {
        photos: Some(form.photos.is_some()),
        videos: Some(form.videos.is_some()),
        animations: Some(form.animations.is_some()),
        documents: Some(form.documents.is_some()),
        flashes: Some(form.flashes.is_some()),
        watch_new_private: Some(form.watch_new_private.is_some()),
        watch_new_groups: Some(form.watch_new_groups.is_some()),
        keep_files: Some(form.keep_files.is_some()),
        token: None,
        admin_id: None,
    };
    match vault::save_settings(&state, patch).await {
        Ok(()) => Redirect::to("/?view=rules").into_response(),
        Err(err) => err.redirect_home(),
    }
}

#[derive(Deserialize)]
struct QueryForm {
    #[serde(default)]
    query: String,
    #[serde(default)]
    id: String,
    #[serde(default)]
    filter: String,
    #[serde(default)]
    q: String,
}

async fn source_add(State(state): State<AppState>, headers: HeaderMap, Form(form): Form<QueryForm>) -> Response {
    if let Err(err) = require_admin(&state, &headers).await {
        return err.redirect_home();
    }
    match vault::add_source(&state, &form.query).await {
        Ok(()) => Redirect::to("/?view=rules").into_response(),
        Err(err) => err.redirect_home(),
    }
}

async fn item_del(State(state): State<AppState>, headers: HeaderMap, Form(form): Form<QueryForm>) -> Response {
    if let Err(err) = require_admin(&state, &headers).await {
        return err.redirect_home();
    }
    let filter = if form.filter.is_empty() { "all" } else { form.filter.as_str() };
    let q = if form.q.is_empty() { form.query.as_str() } else { form.q.as_str() };
    match vault::delete_item(&state, &form.id).await {
        Ok(()) => Redirect::to(&format!(
            "/?view=archive&filter={}&q={}",
            urlencoding::encode(filter),
            urlencoding::encode(q)
        ))
        .into_response(),
        Err(err) => err.redirect_home(),
    }
}

async fn source_del(State(state): State<AppState>, headers: HeaderMap, Form(form): Form<QueryForm>) -> Response {
    if let Err(err) = require_admin(&state, &headers).await {
        return err.redirect_home();
    }
    match vault::remove_source(&state, &form.id).await {
        Ok(()) => Redirect::to("/?view=rules").into_response(),
        Err(err) => err.redirect_home(),
    }
}

#[derive(Deserialize)]
struct FileQuery {
    id: String,
}

async fn file_get(State(state): State<AppState>, headers: HeaderMap, Query(q): Query<FileQuery>) -> Response {
    if require_admin(&state, &headers).await.is_err() {
        return Redirect::to("/").into_response();
    }
    let file_id = urlencoding::decode(&q.id).unwrap_or(std::borrow::Cow::Borrowed(&q.id)).into_owned();
    match vault::file_access(&state, &file_id).await {
        Ok(access) => {
            if let Some(path) = &access.local_path {
                if path.is_file() {
                    match tokio::fs::read(path).await {
                        Ok(bytes) => {
                            let ext = crate::keep::sniff_bytes(&bytes)
                                .map(|s| s.to_string())
                                .or_else(|| path.extension().and_then(|e| e.to_str()).map(|s| s.to_string()))
                                .unwrap_or_default();
                            return file_response(crate::keep::mime_from_ext(&ext).into(), bytes);
                        }
                        Err(err) => tracing::warn!(error = %err, "本地原件读不出，改向 Telegram 拉取"),
                    }
                }
            }
            match telegram::download_file(&state.http, &access.token, &file_id, crate::keep::MAX_BYTES).await {
                Ok((mime, bytes)) => {
                    if access.keep_files {
                        match crate::keep::persist(
                            &state.config.data_dir,
                            &access.unique,
                            &access.caption,
                            &mime,
                            &bytes,
                            &access.kind,
                        )
                        .await
                        {
                            Ok(url) => {
                                let preview = if mime.starts_with("image/")
                                    || crate::keep::sniff_bytes(&bytes).map(crate::keep::is_image_ext).unwrap_or(false)
                                {
                                    crate::keep::persist_thumb(&state.config.data_dir, &access.unique, &bytes).await
                                } else {
                                    None
                                };
                                let _ = vault::remember_local(&state, &file_id, url, preview).await;
                            }
                            Err(err) => tracing::warn!(error = %err, "原件没写下盘"),
                        }
                    }
                    file_response(mime, bytes)
                }
                Err(err) => err.redirect_home(),
            }
        }
        Err(err) => err.redirect_home(),
    }
}

#[derive(Deserialize)]
struct ThumbQuery {
    u: String,
}

async fn thumb_get(State(state): State<AppState>, headers: HeaderMap, Query(q): Query<ThumbQuery>) -> Response {
    if require_admin(&state, &headers).await.is_err() {
        return Redirect::to("/").into_response();
    }
    let unique = urlencoding::decode(&q.u).unwrap_or(std::borrow::Cow::Borrowed(&q.u)).into_owned();
    match crate::keep::ensure_thumb(&state.config.data_dir, &unique).await {
        Some(path) => match tokio::fs::read(&path).await {
            Ok(bytes) => file_response("image/jpeg".into(), bytes),
            Err(_) => Response::builder()
                .status(axum::http::StatusCode::NOT_FOUND)
                .body(Body::from("没有缩略图"))
                .unwrap_or_else(|_| Redirect::to("/").into_response()),
        },
        None => Response::builder()
            .status(axum::http::StatusCode::NOT_FOUND)
            .body(Body::from("没有缩略图"))
            .unwrap_or_else(|_| Redirect::to("/").into_response()),
    }
}

fn file_response(mime: String, bytes: Vec<u8>) -> Response {
    let mut res = Response::new(Body::from(bytes));
    res.headers_mut().insert(
        CONTENT_TYPE,
        HeaderValue::from_str(&mime).unwrap_or(HeaderValue::from_static("application/octet-stream")),
    );
    res
}

fn form_ids(body: &[u8]) -> Vec<String> {
    let mut ids = Vec::new();
    let mut seen = HashSet::new();
    for (key, value) in url::form_urlencoded::parse(body) {
        if key != "id" && key != "ids" {
            continue;
        }
        for part in value.split([',', '\n', ' ']) {
            let part = part.trim();
            if part.is_empty() || !seen.insert(part.to_string()) {
                continue;
            }
            ids.push(part.to_string());
            if ids.len() >= 200 {
                return ids;
            }
        }
    }
    ids
}

fn pack_wants_xhr(headers: &HeaderMap) -> bool {
    headers
        .get("x-jianxia-pack")
        .is_some()
        || headers
            .get(axum::http::header::ACCEPT)
            .and_then(|v| v.to_str().ok())
            .map(|v| v.contains("application/json"))
            .unwrap_or(false)
}

fn pack_fail(headers: &HeaderMap, err: AppError) -> Response {
    if pack_wants_xhr(headers) {
        err.into_response()
    } else {
        err.redirect_home()
    }
}

async fn pack_post(State(state): State<AppState>, headers: HeaderMap, body: Bytes) -> Response {
    if require_admin(&state, &headers).await.is_err() {
        return Redirect::to("/").into_response();
    }
    let ids = form_ids(&body);
    match vault::load_body(&state).await {
        Ok((body, _)) => match crate::pack::build_selected(&state.config.data_dir, &body, &ids).await {
            Ok(job) => match tokio::fs::File::open(&job.dest).await {
                Ok(file) => {
                    let len = tokio::fs::metadata(&job.dest).await.ok().map(|m| m.len());
                    let stream = tokio_util::io::ReaderStream::new(file);
                    let mut res = Response::new(Body::from_stream(stream));
                    res.headers_mut()
                        .insert(CONTENT_TYPE, HeaderValue::from_static("application/zip"));
                    if let Ok(disp) = HeaderValue::from_str(&format!("attachment; filename=\"{}\"", job.filename)) {
                        res.headers_mut().insert(CONTENT_DISPOSITION, disp);
                    }
                    if let Some(len) = len {
                        if let Ok(v) = HeaderValue::from_str(&len.to_string()) {
                            res.headers_mut().insert(CONTENT_LENGTH, v);
                        }
                    }
                    tracing::info!(count = job.count, file = %job.filename, "打包已选原件");
                    res
                }
                Err(err) => pack_fail(&headers, AppError::Internal(format!("打包文件打不开: {err}"))),
            },
            Err(err) => pack_fail(&headers, err),
        },
        Err(err) => pack_fail(&headers, err),
    }
}

async fn export(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if require_admin(&state, &headers).await.is_err() {
        return Redirect::to("/").into_response();
    }
    match vault::load_body(&state).await {
        Ok((mut body, _)) => {
            body.settings.token.clear();
            body.webhook_secret.clear();
            let json = serde_json::to_vec_pretty(&body).unwrap_or_else(|_| b"{}".to_vec());
            let mut res = Response::new(Body::from(json));
            res.headers_mut()
                .insert(CONTENT_TYPE, HeaderValue::from_static("application/json; charset=utf-8"));
            res.headers_mut().insert(
                axum::http::header::CONTENT_DISPOSITION,
                HeaderValue::from_static("attachment; filename=\"jianxia-archive.json\""),
            );
            res
        }
        Err(err) => err.redirect_home(),
    }
}

async fn telegram_hook(State(state): State<AppState>, headers: HeaderMap, axum::Json(update): axum::Json<Value>) -> Result<&'static str, AppError> {
    let secret = headers
        .get("x-telegram-bot-api-secret-token")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let Some(user_id) = vault::find_user_by_webhook(&state, secret).await? else {
        return Err(AppError::Unauthorized("unauthorized".into()));
    };
    vault::accept_update(&state, &user_id, &update).await?;
    Ok("ok")
}

#[allow(dead_code)]
fn _unused_location() -> HeaderValue {
    HeaderValue::from_static("/")
}
