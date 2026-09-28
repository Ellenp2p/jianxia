use serde_json::{json, Value};
use sqlx::Row;
use url::Url;

use crate::config::AppState;
use crate::crypto::{self, is_admin_id, open_seal, seal, secret_hash, token_ok};
use crate::error::AppError;
use crate::logic::{apply_incoming, apply_talk, empty_body, uid};
use crate::parse::{command_from_update, login_attempt, observe_update, summarize_update, update_id};
use crate::telegram;
use crate::types::*;

pub const VAULT_ID: &str = "admin";

struct RowData {
    cipher: String,
    version: i64,
}

async fn read_row(state: &AppState, user_id: &str) -> Result<Option<RowData>, AppError> {
    let row = sqlx::query("select cipher, version from secretary_vault where user_id = ?1")
        .bind(user_id)
        .fetch_optional(&state.pool)
        .await?;
    Ok(row.map(|row| RowData {
        cipher: row.get("cipher"),
        version: row.get("version"),
    }))
}

pub fn parse_body(state: &AppState, cipher: &str) -> Result<SecretBody, AppError> {
    let raw = open_seal(&state.cipher, cipher)?;
    serde_json::from_str(&raw).or_else(|_| Ok(empty_body()))
}

fn shrink_body(mut body: SecretBody) -> SecretBody {
    body.items.truncate(400);
    for item in &mut body.items {
        item.incoming.preview = crate::types::shrink_preview(&item.incoming.preview);
    }
    body.history.truncate(500);
    body.logs.truncate(300);
    body.people.truncate(400);
    body
}

async fn insert_body(state: &AppState, user_id: &str, body: &SecretBody) -> Result<(), AppError> {
    let hash = if body.webhook_secret.is_empty() {
        None
    } else {
        Some(secret_hash(&body.webhook_secret))
    };
    let cipher = seal(&state.cipher, &serde_json::to_string(&shrink_body(body.clone()))?)?;
    sqlx::query(
        "insert into secretary_vault (user_id, cipher, version, webhook_hash, updated_at)
         values (?1, ?2, 1, ?3, ?4) on conflict (user_id) do nothing",
    )
    .bind(user_id)
    .bind(cipher)
    .bind(hash)
    .bind(chrono::Utc::now().to_rfc3339())
    .execute(&state.pool)
    .await?;
    Ok(())
}

async fn write_body(state: &AppState, user_id: &str, body: &SecretBody, expected: i64) -> Result<bool, AppError> {
    let hash = if body.server_listening && !body.webhook_secret.is_empty() {
        Some(secret_hash(&body.webhook_secret))
    } else {
        None
    };
    let cipher = seal(&state.cipher, &serde_json::to_string(&shrink_body(body.clone()))?)?;
    let result = sqlx::query(
        "update secretary_vault set cipher = ?1, version = version + 1, webhook_hash = ?2, updated_at = ?3
         where user_id = ?4 and version = ?5",
    )
    .bind(cipher)
    .bind(hash)
    .bind(chrono::Utc::now().to_rfc3339())
    .bind(user_id)
    .bind(expected)
    .execute(&state.pool)
    .await?;
    Ok(result.rows_affected() > 0)
}

async fn with_body<F>(state: &AppState, user_id: &str, mut change: F) -> Result<SecretBody, AppError>
where
    F: FnMut(&mut SecretBody) -> Result<(), AppError>,
{
    for _ in 0..3 {
        let row = read_row(state, user_id).await?;
        if row.is_none() {
            insert_body(state, user_id, &empty_body()).await?;
            continue;
        }
        let row = row.unwrap();
        let mut body = parse_body(state, &row.cipher)?;
        change(&mut body)?;
        if write_body(state, user_id, &body, row.version).await? {
            return Ok(body);
        }
    }
    Err(AppError::Internal("档案正在被另一边写入，请再试一次".into()))
}

pub async fn load_body(state: &AppState) -> Result<(SecretBody, i64), AppError> {
    match read_row(state, VAULT_ID).await? {
        Some(row) => Ok((parse_body(state, &row.cipher)?, row.version)),
        None => {
            insert_body(state, VAULT_ID, &empty_body()).await?;
            Ok((empty_body(), 1))
        }
    }
}

pub async fn is_claimed(state: &AppState) -> Result<bool, AppError> {
    let Some(row) = read_row(state, VAULT_ID).await? else {
        return Ok(false);
    };
    let body = parse_body(state, &row.cipher)?;
    Ok(token_ok(body.settings.token.trim()) && is_admin_id(body.settings.admin_id.trim()))
}

pub async fn read_admin_id(state: &AppState) -> Result<String, AppError> {
    Ok(load_body(state)
        .await
        .ok()
        .map(|(b, _)| b.settings.admin_id.trim().to_string())
        .unwrap_or_default())
}

pub async fn apply_boot_identity(state: &AppState, token: &str, admin_id: &str) -> Result<String, AppError> {
    let trimmed = token.trim();
    let id: String = admin_id.chars().filter(|c| c.is_ascii_digit()).take(16).collect();
    if !token_ok(trimmed) {
        return Err(AppError::BadRequest("Bot Token 格式不对".into()));
    }
    if !is_admin_id(&id) {
        return Err(AppError::BadRequest("管理员 ID 必须是 Telegram 数字 ID".into()));
    }
    let me = telegram::call(&state.http, trimmed, "getMe", json!({})).await?;
    let username = me.get("username").and_then(Value::as_str).unwrap_or("").to_string();
    let name = me.get("first_name").and_then(Value::as_str).unwrap_or("机器人").to_string();
    let bot_id = me
        .get("id")
        .and_then(|v| v.as_i64().map(|n| n.to_string()).or_else(|| v.as_u64().map(|n| n.to_string())).or_else(|| v.as_str().map(|s| s.to_string())))
        .unwrap_or_default();
    let _g = state.lock.lock().await;
    if let Some(row) = read_row(state, VAULT_ID).await? {
        let mut current = parse_body(state, &row.cipher)?;
        current.settings.token = trimmed.to_string();
        current.settings.admin_id = id;
        current.bot_username = username.clone();
        current.bot_name = name;
        current.bot_id = bot_id.clone();
        current.server_listening = true;
        if !write_body(state, VAULT_ID, &current, row.version).await? {
            return Err(AppError::Internal("没写上，再试一次".into()));
        }
    } else {
        let mut body = empty_body();
        body.settings.token = trimmed.to_string();
        body.settings.admin_id = id;
        body.bot_username = username.clone();
        body.bot_name = name;
        body.bot_id = bot_id;
        body.server_listening = true;
        insert_body(state, VAULT_ID, &body).await?;
    }
    tracing::info!(bot = %username, admin = %admin_id, "已用启动配置接上机器人");
    Ok(username)
}

pub async fn begin_challenge(state: &AppState) -> Result<(String, String), AppError> {
    let _g = state.lock.lock().await;
    let row = read_row(state, VAULT_ID)
        .await?
        .ok_or_else(|| AppError::BadRequest("先填写 Bot Token 和管理员 ID".into()))?;
    let mut current = parse_body(state, &row.cipher)?;
    if current.bot_username.is_empty() {
        return Err(AppError::BadRequest("还不知道机器人的用户名".into()));
    }
    let code = crypto::random_alnum(8);
    current.login_challenge = Some(LoginChallenge {
        code: code.clone(),
        exp: chrono::Utc::now().timestamp_millis() + 5 * 60 * 1000,
    });
    current.login_grant = None;
    if !write_body(state, VAULT_ID, &current, row.version).await? {
        return Err(AppError::Internal("登录口令没生成".into()));
    }
    Ok((code, current.bot_username))
}

pub async fn finish_challenge(state: &AppState) -> Result<Option<(bool, String)>, AppError> {
    let _g = state.lock.lock().await;
    let Some(row) = read_row(state, VAULT_ID).await? else {
        return Ok(None);
    };
    let mut body = parse_body(state, &row.cipher)?;
    let Some(grant) = body.login_grant.clone() else {
        return Ok(None);
    };
    if grant.exp < chrono::Utc::now().timestamp_millis() {
        return Ok(None);
    }
    body.login_grant = None;
    let _ = write_body(state, VAULT_ID, &body, row.version).await?;
    Ok(Some((grant.ok, grant.user_id)))
}

pub async fn accept_widget(state: &AppState, id: &str, fields: Vec<(String, String)>, hash: &str) -> Result<bool, AppError> {
    let (body, _) = load_body(state).await?;
    let token = body.settings.token.trim().to_string();
    let admin = body.settings.admin_id.trim().to_string();
    if token.is_empty() || admin.is_empty() {
        return Ok(false);
    }
    if !crypto::widget_hash_ok(&token, &fields, hash) {
        return Ok(false);
    }
    Ok(id == admin)
}

pub async fn set_listening(state: &AppState, on: bool) -> Result<(), AppError> {
    let _g = state.lock.lock().await;
    with_body(state, VAULT_ID, |body| {
        body.server_listening = on;
        if !on {
            body.webhook_secret.clear();
        }
        Ok(())
    })
    .await?;
    if on {
        tracing::info!("开始收 Telegram");
    } else {
        tracing::info!("停下来，不再收");
    }
    Ok(())
}

pub async fn save_settings(state: &AppState, patch: SettingsPatch) -> Result<(), AppError> {
    let _g = state.lock.lock().await;
    with_body(state, VAULT_ID, |body| {
        if let Some(v) = patch.photos {
            body.settings.photos = v;
        }
        if let Some(v) = patch.videos {
            body.settings.videos = v;
        }
        if let Some(v) = patch.animations {
            body.settings.animations = v;
        }
        if let Some(v) = patch.documents {
            body.settings.documents = v;
        }
        if let Some(v) = patch.flashes {
            body.settings.flashes = v;
        }
        if let Some(v) = patch.watch_new_private {
            body.settings.watch_new_private = v;
        }
        if let Some(v) = patch.watch_new_groups {
            body.settings.watch_new_groups = v;
        }
        if let Some(v) = patch.keep_files {
            body.settings.keep_files = v;
        }
        if let Some(token) = patch.token.clone() {
            let t = token.trim();
            if token_ok(t) {
                body.settings.token = t.to_string();
            }
        }
        if let Some(admin) = patch.admin_id.clone() {
            body.settings.admin_id = admin.chars().filter(|c| c.is_ascii_digit()).take(16).collect();
        }
        Ok(())
    })
    .await?;
    Ok(())
}

pub struct SettingsPatch {
    pub photos: Option<bool>,
    pub videos: Option<bool>,
    pub animations: Option<bool>,
    pub documents: Option<bool>,
    pub flashes: Option<bool>,
    pub watch_new_private: Option<bool>,
    pub watch_new_groups: Option<bool>,
    pub keep_files: Option<bool>,
    pub token: Option<String>,
    pub admin_id: Option<String>,
}

pub async fn add_source(state: &AppState, query: &str) -> Result<(), AppError> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(());
    }
    let _g = state.lock.lock().await;
    with_body(state, VAULT_ID, |body| {
        body.settings.sources.push(Source {
            id: uid("src"),
            query: q.to_string(),
            resolved_id: None,
            resolved_title: None,
            resolved_username: None,
            status: "idle".into(),
            error: None,
        });
        Ok(())
    })
    .await?;
    Ok(())
}

pub async fn remove_source(state: &AppState, id: &str) -> Result<(), AppError> {
    let _g = state.lock.lock().await;
    with_body(state, VAULT_ID, |body| {
        body.settings.sources.retain(|s| s.id != id);
        Ok(())
    })
    .await?;
    Ok(())
}

pub async fn arm_webhook(state: &AppState, origin: &str) -> Result<(), AppError> {
    let url = Url::parse(origin).map_err(|_| AppError::BadRequest("这个地址不能交给 Telegram".into()))?;
    let (body, _) = load_body(state).await?;
    let token = body.settings.token.trim().to_string();
    if !token_ok(&token) {
        return Err(AppError::BadRequest("先把 Bot Token 锁进服务器".into()));
    }
    let host = url.host_str().unwrap_or("");
    let public_https = url.scheme() == "https" && host != "localhost" && host != "127.0.0.1";
    let secret = if public_https {
        let secret = crypto::random_hex(24);
        telegram::call(
            &state.http,
            &token,
            "setWebhook",
            json!({
                "url": format!("{}/telegram", url.origin().ascii_serialization()),
                "secret_token": secret,
                "allowed_updates": telegram::ALLOWED_UPDATES,
                "drop_pending_updates": false
            }),
        )
        .await?;
        secret
    } else {
        let _ = telegram::call(&state.http, &token, "deleteWebhook", json!({ "drop_pending_updates": false })).await;
        String::new()
    };
    let _g = state.lock.lock().await;
    with_body(state, VAULT_ID, |body| {
        body.webhook_secret = secret.clone();
        body.server_listening = true;
        body.logs.insert(
            0,
            LogEntry {
                id: uid("log"),
                at: chrono::Utc::now().timestamp_millis(),
                level: LogLevel::Info,
                title: "开始收了".into(),
                detail: "关页面也会继续记。".into(),
                chat_title: String::new(),
            },
        );
        Ok(())
    })
    .await?;
    Ok(())
}

pub struct FileAccess {
    pub token: String,
    pub unique: String,
    pub caption: String,
    pub local_path: Option<std::path::PathBuf>,
    pub keep_files: bool,
    pub kind: crate::types::MediaKind,
}

pub async fn file_access(state: &AppState, file_id: &str) -> Result<FileAccess, AppError> {
    let (body, _) = load_body(state).await?;
    let token = body.settings.token.trim().to_string();
    if token.is_empty() {
        return Err(AppError::BadRequest("还没有 Token".into()));
    }
    let item = body
        .items
        .iter()
        .find(|i| i.incoming.file_id == file_id)
        .ok_or_else(|| AppError::Forbidden("这个文件不在你的档案里".into()))?;
    let local_path = item
        .incoming
        .media_url
        .as_deref()
        .and_then(|url| crate::keep::resolve_local(&state.config.data_dir, url));
    Ok(FileAccess {
        token,
        unique: item.incoming.file_unique_id.clone(),
        caption: item.incoming.caption.clone(),
        local_path,
        keep_files: body.settings.keep_files,
        kind: item.incoming.kind.clone(),
    })
}

pub async fn remember_local(
    state: &AppState,
    file_id: &str,
    media_url: String,
    preview: Option<String>,
) -> Result<(), AppError> {
    let _g = state.lock.lock().await;
    with_body(state, VAULT_ID, |body| {
        let mut unique = String::new();
        for item in &mut body.items {
            if item.incoming.file_id == file_id {
                item.incoming.media_url = Some(media_url.clone());
                if let Some(p) = &preview {
                    if !p.is_empty() {
                        item.incoming.preview = p.clone();
                    }
                }
                unique = item.incoming.file_unique_id.clone();
            }
        }
        if !unique.is_empty() {
            if let Some(p) = &preview {
                for row in &mut body.history {
                    if row.file_unique_id == unique && (row.preview.is_empty() || row.preview.starts_with("data:")) {
                        row.preview = p.clone();
                    }
                }
            }
        }
        Ok(())
    })
    .await?;
    Ok(())
}

fn own_sender(id: &str, admin_id: &str, bot_id: &str) -> bool {
    let id = id.trim();
    if id.is_empty() {
        return false;
    }
    (!admin_id.trim().is_empty() && id == admin_id.trim()) || (!bot_id.trim().is_empty() && id == bot_id.trim())
}

pub async fn delete_item(state: &AppState, id: &str) -> Result<(), AppError> {
    let id = id.trim();
    if id.is_empty() {
        return Err(AppError::BadRequest("没有这条".into()));
    }
    let mut unique = String::new();
    let mut media_url = None;
    let mut had_file = false;
    {
        let _g = state.lock.lock().await;
        with_body(state, VAULT_ID, |body| {
            let Some(item) = body.items.iter().find(|i| i.id == id) else {
                return Err(AppError::BadRequest("档案里没有这条".into()));
            };
            unique = item.incoming.file_unique_id.clone();
            media_url = item.incoming.media_url.clone();
            had_file = media_url.as_deref().map(|u| !u.is_empty()).unwrap_or(false) || !item.incoming.file_id.is_empty();
            let archive_id = item.id.clone();
            body.items.retain(|i| i.id != id);
            body.history.retain(|row| row.archive_id != archive_id && (unique.is_empty() || row.file_unique_id != unique));
            let still = !unique.is_empty() && body.items.iter().any(|i| i.incoming.file_unique_id == unique);
            if still {
                unique.clear();
                media_url = None;
                had_file = false;
            }
            Ok(())
        })
        .await?;
    }
    let disk = if unique.is_empty() && media_url.is_none() {
        false
    } else {
        crate::keep::remove_kept(&state.config.data_dir, &unique, media_url.as_deref()).await
    };
    {
        let _g = state.lock.lock().await;
        let _ = with_body(state, VAULT_ID, |body| {
            body.logs.insert(
                0,
                LogEntry {
                    id: uid("log"),
                    at: chrono::Utc::now().timestamp_millis(),
                    level: LogLevel::Info,
                    title: "从档案拿掉一条".into(),
                    detail: if disk || had_file {
                        "档案条目和这台机器上的原件都去掉了。".into()
                    } else {
                        "档案条目已去掉。".into()
                    },
                    chat_title: String::new(),
                },
            );
            body.logs.truncate(300);
            Ok(())
        })
        .await;
    }
    tracing::info!(id, disk, "从档案拿掉");
    Ok(())
}

pub async fn find_user_by_webhook(state: &AppState, secret: &str) -> Result<Option<String>, AppError> {
    if secret.len() < 16 {
        return Ok(None);
    }
    let row = sqlx::query("select user_id from secretary_vault where webhook_hash = ?1")
        .bind(secret_hash(secret))
        .fetch_optional(&state.pool)
        .await?;
    Ok(row.map(|r| r.get("user_id")))
}

pub async fn accept_update(state: &AppState, user_id: &str, update: &Value) -> Result<(), AppError> {
    let (body0, _) = match read_row(state, user_id).await? {
        Some(row) => (parse_body(state, &row.cipher)?, row.version),
        None => return Ok(()),
    };
    let token = body0.settings.token.trim().to_string();
    let now = chrono::Utc::now().timestamp_millis();
    let observed = observe_update(update);
    let login = login_attempt(update);
    let command = command_from_update(update);
    let Some(uid_val) = update_id(update) else {
        tracing::info!(what = %summarize_update(update), "收到一条更新（没有 update_id）");
        return Ok(());
    };
    tracing::info!(update_id = uid_val, what = %summarize_update(update), "收到");
    let skip_store = observed
        .media
        .as_ref()
        .map(|m| own_sender(&m.sender_id, &body0.settings.admin_id, &body0.bot_id))
        .unwrap_or(false)
        || observed
            .speakers
            .iter()
            .any(|s| own_sender(&s.hidden_id, &body0.settings.admin_id, &body0.bot_id));
    if skip_store {
        tracing::info!(update_id = uid_val, "自己发的，不存");
    }
    let mut preview = String::new();
    let mut media_url = None;
    if !skip_store {
    if let Some(media) = &observed.media {
        if !token.is_empty() {
            let mut original: Option<Vec<u8>> = None;
            if body0.settings.keep_files && !media.file_id.is_empty() {
                if let Some(existing) = crate::keep::existing(&state.config.data_dir, &media.file_unique_id).await {
                    media_url = Some(existing);
                } else {
                    match telegram::download_file(&state.http, &token, &media.file_id, crate::keep::MAX_BYTES).await {
                        Ok((mime, bytes)) => match crate::keep::persist(
                            &state.config.data_dir,
                            &media.file_unique_id,
                            &media.caption,
                            &mime,
                            &bytes,
                            &media.kind,
                        )
                        .await
                        {
                            Ok(url) => {
                                tracing::info!(unique = %media.file_unique_id, "原件已保存");
                                media_url = Some(url);
                                original = Some(bytes);
                            }
                            Err(err) => tracing::warn!(error = %err, "原件没写下盘"),
                        },
                        Err(err) => tracing::warn!(error = %err, "原件没从 Telegram 拉下来"),
                    }
                }
            }
            if let Some(bytes) = original.as_ref() {
                preview = crate::keep::persist_thumb(&state.config.data_dir, &media.file_unique_id, bytes)
                    .await
                    .unwrap_or_default();
            }
            if preview.is_empty() {
                if crate::keep::ensure_thumb(&state.config.data_dir, &media.file_unique_id)
                    .await
                    .is_some()
                {
                    preview = crate::keep::thumb_url(&media.file_unique_id);
                }
            }
            if preview.is_empty() {
                if let Some(fid) = &media.preview_file_id {
                    match telegram::download_file(&state.http, &token, fid, crate::keep::THUMB_SOURCE_MAX).await {
                        Ok((_, bytes)) => {
                            preview = crate::keep::persist_thumb(&state.config.data_dir, &media.file_unique_id, &bytes)
                                .await
                                .unwrap_or_default();
                        }
                        Err(_) => {
                            preview = telegram::thumb_data_url(&state.http, &token, fid)
                                .await
                                .ok()
                                .flatten()
                                .unwrap_or_default();
                        }
                    }
                }
            }
        }
    }
    }
    let mut login_reply = None;
    let mut command_reply = None;
    {
        let _g = state.lock.lock().await;
        with_body(state, user_id, |body| {
            if uid_val <= body.last_update_id {
                tracing::info!(update_id = uid_val, "这条已经记过，跳过");
                return Ok(());
            }
            body.last_update_id = uid_val;
            if let Some((code, user, chat_id, conn)) = login.clone() {
                let fresh = body
                    .login_challenge
                    .as_ref()
                    .map(|c| c.code == code && c.exp > now)
                    .unwrap_or(false);
                if fresh {
                    let ok = body.settings.admin_id.trim() == user;
                    body.login_grant = Some(LoginGrant {
                        code,
                        user_id: user,
                        ok,
                        exp: now + 5 * 60 * 1000,
                    });
                    body.login_challenge = None;
                    login_reply = Some((
                        chat_id,
                        if ok {
                            "是管理员。回到网页就会进入笺匣。"
                        } else {
                            "不是管理员，不返回档案。"
                        }
                        .to_string(),
                        conn,
                    ));
                }
                return Ok(());
            }
            if let Some((user, chat_id, text, conn)) = command.clone() {
                if let Some(reply) = crate::commands::answer_command(
                    &text,
                    &user,
                    &body.settings.admin_id,
                    &body.people,
                    &body.history,
                    now,
                ) {
                    command_reply = Some((chat_id, reply, conn));
                }
            }
            if skip_store {
                return Ok(());
            }
            let mut fold = FoldState::from(&*body);
            for speaker in &observed.speakers {
                if observed.media.as_ref().map(|m| m.sender_id != speaker.hidden_id).unwrap_or(true) {
                    fold = apply_talk(speaker, fold);
                }
            }
            if let Some(media) = observed.media.clone() {
                let incoming = Incoming {
                    file_unique_id: media.file_unique_id,
                    file_id: media.file_id,
                    kind: media.kind,
                    chat_id: media.chat_id,
                    chat_title: media.chat_title,
                    chat_username: media.chat_username,
                    chat_type: media.chat_type,
                    message_id: media.message_id,
                    caption: media.caption,
                    occurred_at: media.occurred_at,
                    width: media.width,
                    height: media.height,
                    duration: media.duration,
                    bytes: media.bytes,
                    preview: preview.clone(),
                    media_url: media_url.clone(),
                    visual_hash: String::new(),
                    origin: if update.get("business_message").is_some()
                        || update.get("edited_business_message").is_some()
                    {
                        "business".into()
                    } else {
                        "live".into()
                    },
                    sender_id: media.sender_id,
                    sender_name: media.sender_name,
                    sender_username: media.sender_username,
                    reveal: media.reveal,
                };
                fold = apply_incoming(incoming, fold, &body.settings, now);
            }
            if observed.media.is_some() {
                if media_url.is_some() {
                    if let Some(log) = fold.logs.first_mut() {
                        if !log.detail.contains("原件已保存") {
                            log.detail.push_str(" · 原件已保存");
                        }
                    }
                }
                if let Some(log) = fold.logs.first() {
                    tracing::info!(title = %log.title, detail = %log.detail, "入档");
                }
            }
            fold.apply_to(body);
            Ok(())
        })
        .await?;
    }
    if !token.is_empty() {
        if let Some((chat, text, conn)) = login_reply {
            let _ = telegram::send_message(&state.http, &token, &chat, &text, conn.as_deref()).await;
        }
        if let Some((chat, text, conn)) = command_reply {
            let _ = telegram::send_message(&state.http, &token, &chat, &text, conn.as_deref()).await;
        }
    }
    Ok(())
}

pub async fn poll_once(state: &AppState) -> Result<i64, AppError> {
    let (body, _) = match read_row(state, VAULT_ID).await? {
        Some(row) => (parse_body(state, &row.cipher)?, row.version),
        None => return Ok(0),
    };
    if !body.server_listening {
        return Ok(0);
    }
    if !body.webhook_secret.is_empty() {
        return Ok(0);
    }
    let token = body.settings.token.trim().to_string();
    if !token_ok(&token) {
        return Ok(0);
    }
    let mut payload = json!({
        "limit": 25,
        "timeout": 0,
        "allowed_updates": telegram::ALLOWED_UPDATES
    });
    if body.update_offset > 0 {
        payload["offset"] = json!(body.update_offset);
    }
    let result = telegram::call(&state.http, &token, "getUpdates", payload).await?;
    let updates = result.as_array().cloned().unwrap_or_default();
    let mut offset = body.update_offset;
    let mut n = 0i64;
    for update in &updates {
        if let Some(id) = update_id(update) {
            accept_update(state, VAULT_ID, update).await?;
            offset = id + 1;
            n += 1;
        }
    }
    if offset != body.update_offset {
        let _g = state.lock.lock().await;
        let _ = with_body(state, VAULT_ID, |body| {
            body.update_offset = offset;
            Ok(())
        })
        .await;
    }
    Ok(n)
}

pub async fn bot_loop(state: AppState) {
    let mut tick = tokio::time::interval(std::time::Duration::from_millis(state.config.poll_ms));
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        tick.tick().await;
        match poll_once(&state).await {
            Ok(n) if n > 0 => tracing::info!(count = n, "这一轮收进了几条"),
            Ok(_) => {}
            Err(err) => tracing::warn!(error = %err, "向 Telegram 拉取失败"),
        }
    }
}
