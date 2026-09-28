use chrono::{Datelike, Timelike};

use crate::crypto::random_alnum;
use crate::types::*;

pub fn default_settings() -> Settings {
    Settings {
        token: String::new(),
        photos: true,
        videos: true,
        animations: false,
        documents: true,
        watch_new_private: true,
        watch_new_groups: false,
        visual_dedupe: true,
        visual_threshold: 8,
        flashes: true,
        admin_id: String::new(),
        sources: vec![],
        keep_files: true,
    }
}

pub fn empty_body() -> SecretBody {
    SecretBody {
        settings: default_settings(),
        items: vec![],
        logs: vec![],
        enrolled_private: vec![],
        enrolled_group: vec![],
        people: vec![],
        history: vec![],
        update_offset: 0,
        bot_name: String::new(),
        bot_username: String::new(),
        bot_id: String::new(),
        webhook_secret: String::new(),
        server_listening: false,
        last_update_id: 0,
        login_challenge: None,
        login_grant: None,
    }
}

pub fn uid(prefix: &str) -> String {
    format!("{prefix}-{}", random_alnum(8))
}

pub fn format_stamp(ts: i64) -> String {
    let shifted = ts + 8 * 60 * 60 * 1000;
    let dt = chrono::DateTime::from_timestamp(shifted.div_euclid(1000), 0)
        .unwrap_or(chrono::DateTime::UNIX_EPOCH);
    format!("{}月{}日 {:02}:{:02}", dt.month(), dt.day(), dt.hour(), dt.minute())
}

pub fn format_file_stamp(ts: i64) -> String {
    let shifted = ts + 8 * 60 * 60 * 1000;
    let dt = chrono::DateTime::from_timestamp(shifted.div_euclid(1000), 0)
        .unwrap_or(chrono::DateTime::UNIX_EPOCH);
    format!(
        "{:04}{:02}{:02}-{:02}{:02}",
        dt.year(),
        dt.month(),
        dt.day(),
        dt.hour(),
        dt.minute()
    )
}

pub fn item_in_filter(item: &ArchiveItem, filter: &str, query: &str) -> bool {
    let ok = match filter {
        "kept" => item.status == ItemStatus::Kept,
        "duplicate" => item.status == ItemStatus::Duplicate,
        "photo" => media_is_image(&item.incoming.kind, &item.incoming.caption),
        "video" => media_is_video(&item.incoming.kind, &item.incoming.caption),
        "text" => item.incoming.kind == MediaKind::Text,
        _ => true,
    };
    if !ok {
        return false;
    }
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return true;
    }
    format!(
        "{} {} {} {}",
        item.incoming.caption,
        item.incoming.chat_title,
        item.incoming.chat_username.clone().unwrap_or_default(),
        item.incoming.file_unique_id
    )
    .to_lowercase()
    .contains(&q)
}

fn ext_of(name: &str) -> &str {
    name.rsplit(['/', '\\']).next().unwrap_or(name)
        .rsplit_once('.')
        .map(|(_, ext)| ext)
        .unwrap_or("")
}

fn name_is_image(name: &str) -> bool {
    matches!(
        ext_of(name).to_ascii_lowercase().as_str(),
        "jpg" | "jpeg" | "png" | "webp" | "gif" | "bmp" | "heic" | "heif" | "tif" | "tiff" | "avif"
    )
}

fn name_is_video(name: &str) -> bool {
    matches!(
        ext_of(name).to_ascii_lowercase().as_str(),
        "mp4" | "mov" | "webm" | "mkv" | "avi" | "m4v" | "mpeg" | "mpg" | "3gp"
    )
}

pub fn kind_label(kind: &MediaKind) -> &'static str {
    match kind {
        MediaKind::Photo => "图片",
        MediaKind::Video => "视频",
        MediaKind::Animation => "动图",
        MediaKind::Document => "文件",
        MediaKind::Text => "文字",
        MediaKind::Other => "消息",
    }
}

/// Label for the webpage: a Telegram "file" that is actually an image/video says so.
pub fn display_kind(kind: &MediaKind, caption: &str) -> &'static str {
    match kind {
        MediaKind::Document if name_is_video(caption) => "视频",
        MediaKind::Document if name_is_image(caption) => "图片",
        other => kind_label(other),
    }
}

pub fn media_is_image(kind: &MediaKind, caption: &str) -> bool {
    matches!(kind, MediaKind::Photo) || (*kind == MediaKind::Document && name_is_image(caption))
}

pub fn media_is_video(kind: &MediaKind, caption: &str) -> bool {
    matches!(kind, MediaKind::Video) || (*kind == MediaKind::Document && name_is_video(caption))
}

pub fn is_packable_media(kind: &MediaKind, caption: &str) -> bool {
    match kind {
        MediaKind::Text | MediaKind::Other => false,
        MediaKind::Photo | MediaKind::Video | MediaKind::Animation => true,
        MediaKind::Document => name_is_image(caption) || name_is_video(caption),
    }
}

/// Telegram `file_unique_id` for real files; empty for plain text.
pub fn file_fingerprint(kind: &MediaKind, file_id: &str, unique: &str) -> String {
    if unique.is_empty() {
        return String::new();
    }
    if file_id.is_empty()
        && !matches!(
            kind,
            MediaKind::Photo | MediaKind::Video | MediaKind::Animation | MediaKind::Document
        )
    {
        return String::new();
    }
    unique.to_string()
}

pub fn reveal_label(reveal: &Reveal) -> &'static str {
    match reveal {
        Reveal::Flash => "闪照",
        Reveal::Spoiler => "遮罩",
        Reveal::Open => "普通",
    }
}

pub fn via_label(via: &Option<Via>) -> &'static str {
    match via {
        Some(Via::List) => "来源名单",
        Some(Via::NewPrivate) => "新的私聊",
        Some(Via::NewGroup) => "新的群",
        Some(Via::Other) => "其它",
        None => "其它",
    }
}

pub fn chat_type_label(t: &ChatType) -> &'static str {
    match t {
        ChatType::Channel => "频道",
        ChatType::Private => "私聊",
        ChatType::Supergroup => "超级群",
        ChatType::Group => "群",
    }
}

pub fn format_duration(seconds: i64) -> String {
    format!("{}:{:02}", seconds / 60, seconds % 60)
}

pub fn format_bytes(bytes: i64) -> String {
    if bytes < 1024 {
        format!("{bytes} B")
    } else if bytes < 1024 * 1024 {
        format!("{} KB", bytes / 1024)
    } else {
        format!("{:.1} MB", bytes as f64 / 1024.0 / 1024.0)
    }
}

pub fn log_level_label(level: &LogLevel) -> &'static str {
    match level {
        LogLevel::Kept => "收下",
        LogLevel::Duplicate => "去重",
        LogLevel::Skip => "跳过",
        LogLevel::Info => "备注",
        LogLevel::Error => "出错",
    }
}

fn norm(value: &str) -> String {
    value.trim().trim_start_matches('@').to_lowercase()
}

pub fn source_matches(incoming: &Incoming, sources: &[Source]) -> bool {
    sources.iter().any(|src| {
        let query = src.query.trim();
        let n = norm(query);
        if !query.is_empty() && (query == incoming.chat_id || n == incoming.chat_id.to_lowercase()) {
            return true;
        }
        if src.resolved_id.as_deref() == Some(incoming.chat_id.as_str()) {
            return true;
        }
        if let Some(user) = incoming.chat_username.as_deref() {
            let user = norm(user);
            if !n.is_empty() && n == user {
                return true;
            }
            if src.resolved_username.as_deref().map(norm).is_some_and(|u| u == user) {
                return true;
            }
        }
        let title = incoming.chat_title.trim().to_lowercase();
        if !n.is_empty() && n == title {
            return true;
        }
        src.resolved_title
            .as_deref()
            .map(|t| t.trim().to_lowercase())
            .is_some_and(|t| t == title)
    })
}

struct Decision {
    skip: bool,
    level: ItemStatus,
    via: Option<Via>,
    enroll: Option<&'static str>,
    duplicate_of_id: Option<String>,
    duplicate_reason: Option<DuplicateReason>,
    title: String,
    detail: String,
}

fn classify(incoming: &Incoming, state: &FoldState, settings: &Settings) -> Decision {
    let where_ = &incoming.chat_title;
    let listed = source_matches(incoming, &settings.sources);
    let mut via = None;
    let mut enroll = None;
    if listed {
        via = Some(Via::List);
    } else if incoming.chat_type == ChatType::Private && settings.watch_new_private {
        via = Some(Via::NewPrivate);
        if !state.enrolled_private.contains(&incoming.chat_id) {
            enroll = Some("private");
        }
    } else if matches!(incoming.chat_type, ChatType::Group | ChatType::Supergroup) && settings.watch_new_groups {
        via = Some(Via::NewGroup);
        if !state.enrolled_group.contains(&incoming.chat_id) {
            enroll = Some("group");
        }
    }
    if via.is_none() {
        via = Some(Via::Other);
    }
    let kept: Vec<&ArchiveItem> = state.items.iter().filter(|i| i.status == ItemStatus::Kept).collect();
    if let Some(hit) = kept.iter().find(|i| i.incoming.file_unique_id == incoming.file_unique_id) {
        return Decision {
            skip: false,
            level: ItemStatus::Duplicate,
            via,
            enroll,
            duplicate_of_id: Some(hit.id.clone()),
            duplicate_reason: Some(DuplicateReason::File),
            title: format!("重复文件 · {}", if incoming.caption.is_empty() { where_.as_str() } else { incoming.caption.as_str() }),
            detail: format!(
                "和「{}」是同一个 Telegram 文件，没有再次放进主档。{} · 指纹 {}",
                if hit.incoming.caption.is_empty() { hit.incoming.chat_title.as_str() } else { hit.incoming.caption.as_str() },
                display_kind(&incoming.kind, &incoming.caption),
                incoming.file_unique_id
            ),
        };
    }
    Decision {
        skip: false,
        level: ItemStatus::Kept,
        via: via.clone(),
        enroll,
        duplicate_of_id: None,
        duplicate_reason: None,
        title: format!(
            "收下{} · {}",
            display_kind(&incoming.kind, &incoming.caption),
            if incoming.caption.is_empty() { where_.as_str() } else { incoming.caption.as_str() }
        ),
        detail: {
            let kind = display_kind(&incoming.kind, &incoming.caption);
            let hash = file_fingerprint(&incoming.kind, &incoming.file_id, &incoming.file_unique_id);
            if hash.is_empty() {
                format!("从{where_}进来。{kind}")
            } else {
                format!("从{where_}进来。{kind} · 指纹 {hash}")
            }
        },
    }
}

pub fn note_speaker(people: &[Person], speaker: &Speaker) -> Vec<Person> {
    if let Some(current) = people.iter().find(|p| p.hidden_id == speaker.hidden_id) {
        let changed = current.display_name != speaker.display_name || current.username != speaker.username;
        let mut names = current.names.clone();
        if changed {
            names.push(NameSnap {
                at: speaker.at,
                display_name: speaker.display_name.clone(),
                username: speaker.username.clone(),
            });
        }
        let mut places = current.places.clone();
        if let Some(w) = &speaker.where_at {
            if !places.iter().any(|p| p == w) {
                places.push(w.clone());
            }
        }
        let next = Person {
            hidden_id: current.hidden_id.clone(),
            display_name: speaker.display_name.clone(),
            username: speaker.username.clone(),
            last_seen: current.last_seen.max(speaker.at),
            first_seen: current.first_seen.min(speaker.at),
            speak_count: current.speak_count + 1,
            names,
            places,
        };
        let mut out = vec![next];
        out.extend(people.iter().filter(|p| p.hidden_id != speaker.hidden_id).cloned());
        out.truncate(400);
        out
    } else {
        let mut places = vec![];
        if let Some(w) = &speaker.where_at {
            places.push(w.clone());
        }
        let created = Person {
            hidden_id: speaker.hidden_id.clone(),
            display_name: speaker.display_name.clone(),
            username: speaker.username.clone(),
            first_seen: speaker.at,
            last_seen: speaker.at,
            speak_count: 1,
            names: vec![NameSnap {
                at: speaker.at,
                display_name: speaker.display_name.clone(),
                username: speaker.username.clone(),
            }],
            places,
        };
        let mut out = vec![created];
        out.extend(people.iter().cloned());
        out.truncate(400);
        out
    }
}

pub fn apply_talk(speaker: &Speaker, mut state: FoldState) -> FoldState {
    state.people = note_speaker(&state.people, speaker);
    state
}

pub fn apply_incoming(incoming: Incoming, mut state: FoldState, settings: &Settings, saved_at: i64) -> FoldState {
    let speaker = Speaker {
        hidden_id: incoming.sender_id.clone(),
        display_name: incoming.sender_name.clone(),
        username: incoming.sender_username.clone(),
        at: incoming.occurred_at,
        where_at: Some(incoming.chat_type.clone()),
    };
    state.people = note_speaker(&state.people, &speaker);
    let decision = classify(&incoming, &state, settings);
    let log = LogEntry {
        id: uid("log"),
        at: incoming.occurred_at,
        level: if decision.skip {
            LogLevel::Skip
        } else if decision.level == ItemStatus::Duplicate {
            LogLevel::Duplicate
        } else {
            LogLevel::Kept
        },
        title: decision.title,
        detail: decision.detail,
        chat_title: incoming.chat_title.clone(),
    };
    if decision.enroll == Some("private") {
        state.enrolled_private.push(incoming.chat_id.clone());
    }
    if decision.enroll == Some("group") {
        state.enrolled_group.push(incoming.chat_id.clone());
    }
    state.logs.insert(0, log);
    state.logs.truncate(300);
    if decision.skip {
        return state;
    }
    let mut incoming = incoming;
    if decision.duplicate_of_id.is_some() && incoming.preview.is_empty() {
        if let Some(orig) = state.items.iter().find(|i| Some(&i.id) == decision.duplicate_of_id.as_ref()) {
            incoming.preview = orig.incoming.preview.clone();
            if incoming.media_url.is_none() {
                incoming.media_url = orig.incoming.media_url.clone();
            }
        }
    }
    let preview = incoming.preview.clone();
    let item = ArchiveItem {
        incoming: incoming.clone(),
        id: uid("rec"),
        saved_at,
        status: decision.level.clone(),
        duplicate_of_id: decision.duplicate_of_id,
        duplicate_reason: decision.duplicate_reason,
        via: decision.via,
    };
    let row = HistoryRow {
        id: uid("rec"),
        at: incoming.occurred_at,
        hidden_id: incoming.sender_id,
        display_name: incoming.sender_name,
        username: incoming.sender_username,
        kind: incoming.kind,
        reveal: incoming.reveal,
        caption: incoming.caption,
        chat_title: incoming.chat_title,
        chat_id: incoming.chat_id,
        chat_type: incoming.chat_type,
        status: item.status.clone(),
        file_unique_id: incoming.file_unique_id,
        preview,
        archive_id: item.id.clone(),
    };
    state.items.insert(0, item);
    state.items.truncate(400);
    state.history.insert(0, row);
    state.history.truncate(500);
    state
}
