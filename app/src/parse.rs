use serde_json::Value;

use crate::types::*;

pub struct Observation {
    pub speakers: Vec<Speaker>,
    pub media: Option<Parsed>,
}

#[derive(Clone)]
pub struct Parsed {
    pub file_unique_id: String,
    pub file_id: String,
    pub preview_file_id: Option<String>,
    pub kind: MediaKind,
    pub chat_id: String,
    pub chat_title: String,
    pub chat_username: Option<String>,
    pub chat_type: ChatType,
    pub message_id: i64,
    pub caption: String,
    pub occurred_at: i64,
    pub width: i64,
    pub height: i64,
    pub duration: Option<i64>,
    pub bytes: Option<i64>,
    pub sender_id: String,
    pub sender_name: String,
    pub sender_username: Option<String>,
    pub reveal: Reveal,
}

fn obj(value: &Value) -> Option<&serde_json::Map<String, Value>> {
    value.as_object()
}

fn nonempty<'a>(value: &'a Value) -> Option<&'a str> {
    value.as_str().filter(|s| !s.is_empty())
}

fn num(value: &Value) -> Option<f64> {
    value.as_f64().or_else(|| value.as_i64().map(|n| n as f64))
}

fn id_text(value: &Value) -> Option<String> {
    value
        .as_i64()
        .map(|n| n.to_string())
        .or_else(|| value.as_u64().map(|n| n.to_string()))
        .or_else(|| nonempty(value).map(|s| s.to_string()))
}

struct Size {
    file_id: String,
    unique: String,
    width: i64,
    height: i64,
    bytes: Option<i64>,
}

fn looks_like_image(mime: &str, name: &str) -> bool {
    let mime = mime.to_ascii_lowercase();
    let name = name.to_ascii_lowercase();
    mime.starts_with("image/")
        || name.ends_with(".jpg")
        || name.ends_with(".jpeg")
        || name.ends_with(".png")
        || name.ends_with(".webp")
        || name.ends_with(".gif")
        || name.ends_with(".bmp")
        || name.ends_with(".heic")
        || name.ends_with(".heif")
        || name.ends_with(".tif")
        || name.ends_with(".tiff")
        || name.ends_with(".avif")
}

fn looks_like_video(mime: &str, name: &str) -> bool {
    let mime = mime.to_ascii_lowercase();
    let name = name.to_ascii_lowercase();
    mime.starts_with("video/")
        || name.ends_with(".mp4")
        || name.ends_with(".mov")
        || name.ends_with(".webm")
        || name.ends_with(".mkv")
        || name.ends_with(".avi")
        || name.ends_with(".m4v")
        || name.ends_with(".mpeg")
        || name.ends_with(".mpg")
        || name.ends_with(".3gp")
}

fn kind_of_document(doc: &serde_json::Map<String, Value>) -> MediaKind {
    let mime = nonempty(doc.get("mime_type").unwrap_or(&Value::Null)).unwrap_or("");
    let name = nonempty(doc.get("file_name").unwrap_or(&Value::Null)).unwrap_or("");
    if looks_like_video(mime, name) {
        MediaKind::Video
    } else if mime.eq_ignore_ascii_case("image/gif") || name.to_ascii_lowercase().ends_with(".gif") {
        MediaKind::Animation
    } else if looks_like_image(mime, name) {
        MediaKind::Photo
    } else {
        MediaKind::Document
    }
}

fn read_size(value: &Value) -> Option<Size> {
    let row = obj(value)?;
    Some(Size {
        file_id: nonempty(row.get("file_id")?)?.to_string(),
        unique: nonempty(row.get("file_unique_id")?)?.to_string(),
        width: num(row.get("width").unwrap_or(&Value::Null)).unwrap_or(0.0) as i64,
        height: num(row.get("height").unwrap_or(&Value::Null)).unwrap_or(0.0) as i64,
        bytes: num(row.get("file_size").unwrap_or(&Value::Null)).map(|n| n as i64),
    })
}

fn person_of(value: Option<&Value>, at: i64) -> Option<Speaker> {
    let row = obj(value?)?;
    let hidden_id = id_text(row.get("id")?)?;
    let first = nonempty(row.get("first_name").unwrap_or(&Value::Null));
    let last = nonempty(row.get("last_name").unwrap_or(&Value::Null));
    let joined = [first, last].into_iter().flatten().collect::<Vec<_>>().join(" ");
    let display_name = if !joined.is_empty() {
        joined
    } else {
        nonempty(row.get("title").unwrap_or(&Value::Null))
            .or_else(|| nonempty(row.get("username").unwrap_or(&Value::Null)))
            .unwrap_or("未命名")
            .to_string()
    };
    Some(Speaker {
        hidden_id,
        display_name,
        username: nonempty(row.get("username").unwrap_or(&Value::Null)).map(|s| s.to_string()),
        at,
        where_at: None,
    })
}

fn chat_of(message: &serde_json::Map<String, Value>) -> Option<(String, String, Option<String>, ChatType)> {
    let chat = obj(message.get("chat")?)?;
    let id = id_text(chat.get("id")?)?;
    let ty = match chat.get("type").and_then(Value::as_str).unwrap_or("private") {
        "channel" => ChatType::Channel,
        "group" => ChatType::Group,
        "supergroup" => ChatType::Supergroup,
        _ => ChatType::Private,
    };
    let title = nonempty(chat.get("title").unwrap_or(&Value::Null))
        .map(|s| s.to_string())
        .or_else(|| {
            let n = [nonempty(chat.get("first_name").unwrap_or(&Value::Null)), nonempty(chat.get("last_name").unwrap_or(&Value::Null))]
                .into_iter()
                .flatten()
                .collect::<Vec<_>>()
                .join(" ");
            (!n.is_empty()).then_some(n)
        })
        .unwrap_or_else(|| "未命名聊天".into());
    Some((
        id,
        title,
        nonempty(chat.get("username").unwrap_or(&Value::Null)).map(|s| s.to_string()),
        ty,
    ))
}

fn reveal_of(message: &serde_json::Map<String, Value>, media: Option<&serde_json::Map<String, Value>>) -> Reveal {
    let ttl = num(message.get("ttl_seconds").unwrap_or(&Value::Null))
        .or_else(|| media.and_then(|m| num(m.get("ttl_seconds").unwrap_or(&Value::Null))));
    if message.get("view_once").and_then(Value::as_bool) == Some(true)
        || message.get("is_view_once").and_then(Value::as_bool) == Some(true)
        || ttl.map(|n| n > 0.0).unwrap_or(false)
    {
        return Reveal::Flash;
    }
    if message.get("has_media_spoiler").and_then(Value::as_bool) == Some(true) {
        return Reveal::Spoiler;
    }
    Reveal::Open
}

/// Message payload from a regular, channel, or Telegram Business update.
pub fn message_from_update(update: &Value) -> Option<&serde_json::Map<String, Value>> {
    let row = obj(update)?;
    obj(row.get("message").unwrap_or(&Value::Null))
        .or_else(|| obj(row.get("channel_post").unwrap_or(&Value::Null)))
        .or_else(|| obj(row.get("edited_message").unwrap_or(&Value::Null)))
        .or_else(|| obj(row.get("edited_channel_post").unwrap_or(&Value::Null)))
        .or_else(|| obj(row.get("business_message").unwrap_or(&Value::Null)))
        .or_else(|| obj(row.get("edited_business_message").unwrap_or(&Value::Null)))
}

fn private_command_message(update: &Value) -> Option<&serde_json::Map<String, Value>> {
    let row = obj(update)?;
    obj(row.get("message").unwrap_or(&Value::Null))
        .or_else(|| obj(row.get("business_message").unwrap_or(&Value::Null)))
}

pub fn business_connection_id(message: &serde_json::Map<String, Value>) -> Option<String> {
    nonempty(message.get("business_connection_id").unwrap_or(&Value::Null)).map(|s| s.to_string())
}

pub fn observe_update(update: &Value) -> Observation {
    let Some(message) = message_from_update(update) else {
        return Observation { speakers: vec![], media: None };
    };
    let Some((chat_id, chat_title, chat_username, chat_type)) = chat_of(message) else {
        return Observation { speakers: vec![], media: None };
    };
    let Some(message_id) = num(message.get("message_id").unwrap_or(&Value::Null)) else {
        return Observation { speakers: vec![], media: None };
    };
    let Some(date) = num(message.get("date").unwrap_or(&Value::Null)) else {
        return Observation { speakers: vec![], media: None };
    };
    let occurred_at = date as i64 * 1000;
    let caption = nonempty(message.get("caption").unwrap_or(&Value::Null)).unwrap_or("").to_string();
    let from = person_of(message.get("from"), occurred_at);
    let mut primary = from.unwrap_or(Speaker {
        hidden_id: chat_id.clone(),
        display_name: chat_title.clone(),
        username: chat_username.clone(),
        at: occurred_at,
        where_at: Some(chat_type.clone()),
    });
    primary.where_at = Some(chat_type.clone());
    let speakers = vec![primary.clone()];

    let photos: Vec<Size> = message
        .get("photo")
        .and_then(Value::as_array)
        .map(|arr| arr.iter().filter_map(read_size).collect())
        .unwrap_or_default();
    if let Some(file) = photos.iter().max_by_key(|s| s.width * s.height) {
        let preview = photos
            .iter()
            .min_by_key(|s| (s.width - 360).abs())
            .unwrap_or(file);
        return Observation {
            speakers,
            media: Some(Parsed {
                file_unique_id: file.unique.clone(),
                file_id: file.file_id.clone(),
                preview_file_id: Some(preview.file_id.clone()),
                kind: MediaKind::Photo,
                chat_id,
                chat_title,
                chat_username,
                chat_type,
                message_id: message_id as i64,
                caption,
                occurred_at,
                width: file.width,
                height: file.height,
                duration: None,
                bytes: file.bytes,
                sender_id: primary.hidden_id,
                sender_name: primary.display_name,
                sender_username: primary.username,
                reveal: reveal_of(message, None),
            }),
        };
    }

    let video = obj(message.get("video").unwrap_or(&Value::Null))
        .or_else(|| obj(message.get("video_note").unwrap_or(&Value::Null)))
        .or_else(|| obj(message.get("animation").unwrap_or(&Value::Null)));
    if let Some(video) = video {
        if let Some(file) = read_size(&Value::Object(video.clone())) {
            let thumb = video.get("thumbnail").and_then(read_size).or_else(|| video.get("thumb").and_then(read_size));
            let kind = if message.get("animation").is_some() {
                MediaKind::Animation
            } else {
                MediaKind::Video
            };
            return Observation {
                speakers,
                media: Some(Parsed {
                    file_unique_id: file.unique,
                    file_id: file.file_id,
                    preview_file_id: thumb.map(|t| t.file_id),
                    kind,
                    chat_id,
                    chat_title,
                    chat_username,
                    chat_type,
                    message_id: message_id as i64,
                    caption,
                    occurred_at,
                    width: file.width,
                    height: file.height,
                    duration: num(video.get("duration").unwrap_or(&Value::Null)).map(|n| n as i64),
                    bytes: file.bytes,
                    sender_id: primary.hidden_id,
                    sender_name: primary.display_name,
                    sender_username: primary.username,
                    reveal: reveal_of(message, Some(video)),
                }),
            };
        }
    }

    if let Some(doc) = obj(message.get("document").unwrap_or(&Value::Null)) {
        if let Some(file) = read_size(&Value::Object(doc.clone())) {
            let thumb = doc.get("thumbnail").and_then(read_size).or_else(|| doc.get("thumb").and_then(read_size));
            let kind = kind_of_document(doc);
            let preview_file_id = thumb.map(|t| t.file_id).or_else(|| {
                matches!(kind, MediaKind::Photo | MediaKind::Animation).then_some(file.file_id.clone())
            });
            return Observation {
                speakers,
                media: Some(Parsed {
                    file_unique_id: file.unique,
                    file_id: file.file_id,
                    preview_file_id,
                    kind,
                    chat_id,
                    chat_title,
                    chat_username,
                    chat_type,
                    message_id: message_id as i64,
                    caption: if caption.is_empty() {
                        nonempty(doc.get("file_name").unwrap_or(&Value::Null)).unwrap_or("文件").to_string()
                    } else {
                        caption
                    },
                    occurred_at,
                    width: file.width,
                    height: file.height,
                    duration: num(doc.get("duration").unwrap_or(&Value::Null)).map(|n| n as i64),
                    bytes: file.bytes,
                    sender_id: primary.hidden_id,
                    sender_name: primary.display_name,
                    sender_username: primary.username,
                    reveal: reveal_of(message, Some(doc)),
                }),
            };
        }
    }

    let text = nonempty(message.get("text").unwrap_or(&Value::Null)).unwrap_or("");
    let (kind, caption, unique, file_id) = if !text.is_empty() {
        (
            MediaKind::Text,
            text.to_string(),
            format!("msg-{chat_id}-{message_id}"),
            String::new(),
        )
    } else if message.get("sticker").is_some() {
        let st = obj(message.get("sticker").unwrap_or(&Value::Null));
        let emoji = st.and_then(|s| nonempty(s.get("emoji").unwrap_or(&Value::Null))).unwrap_or("贴纸");
        let file = st.and_then(|s| read_size(&Value::Object(s.clone())));
        (
            MediaKind::Other,
            emoji.to_string(),
            file.as_ref().map(|f| f.unique.clone()).unwrap_or_else(|| format!("sticker-{chat_id}-{message_id}")),
            file.map(|f| f.file_id).unwrap_or_default(),
        )
    } else if message.get("voice").is_some() || message.get("audio").is_some() {
        (
            MediaKind::Other,
            if caption.is_empty() { "语音".into() } else { caption },
            format!("audio-{chat_id}-{message_id}"),
            String::new(),
        )
    } else {
        (
            MediaKind::Other,
            if caption.is_empty() { "消息".into() } else { caption },
            format!("msg-{chat_id}-{message_id}"),
            String::new(),
        )
    };

    Observation {
        speakers,
        media: Some(Parsed {
            file_unique_id: unique,
            file_id,
            preview_file_id: None,
            kind,
            chat_id,
            chat_title,
            chat_username,
            chat_type,
            message_id: message_id as i64,
            caption,
            occurred_at,
            width: 0,
            height: 0,
            duration: None,
            bytes: None,
            sender_id: primary.hidden_id,
            sender_name: primary.display_name,
            sender_username: primary.username,
            reveal: reveal_of(message, None),
        }),
    }
}

/// `(user_id, chat_id, text, business_connection_id)`
pub fn command_from_update(update: &Value) -> Option<(String, String, String, Option<String>)> {
    let message = private_command_message(update)?;
    let text = nonempty(message.get("text")?)?;
    if !crate::commands::is_command(text) {
        return None;
    }
    let (chat_id, _, _, ty) = chat_of(message)?;
    if ty != ChatType::Private {
        return None;
    }
    let user_id = person_of(message.get("from"), 0)
        .map(|s| s.hidden_id)
        .unwrap_or_else(|| chat_id.clone());
    if user_id != chat_id {
        return None;
    }
    Some((user_id, chat_id, text.trim().to_string(), business_connection_id(message)))
}

/// `(code, user_id, chat_id, business_connection_id)`
pub fn login_attempt(update: &Value) -> Option<(String, String, String, Option<String>)> {
    let message = private_command_message(update)?;
    let text = nonempty(message.get("text")?)?;
    let code = crate::commands::login_code_of(text)?;
    let chat = obj(message.get("chat")?)?;
    let from = obj(message.get("from")?)?;
    if chat.get("type").and_then(Value::as_str) != Some("private") {
        return None;
    }
    let user_id = id_text(from.get("id")?)?;
    let chat_id = id_text(chat.get("id")?)?;
    (user_id == chat_id).then_some((code, user_id, chat_id, business_connection_id(message)))
}

pub fn update_id(update: &Value) -> Option<i64> {
    obj(update)?.get("update_id").and_then(Value::as_i64)
}

/// One-line description of whatever Telegram just pushed.
pub fn summarize_update(update: &Value) -> String {
    let row = match obj(update) {
        Some(r) => r,
        None => return "无法识别的更新".into(),
    };
    if let Some(conn) = obj(row.get("business_connection").unwrap_or(&Value::Null)) {
        let enabled = conn.get("is_enabled").and_then(Value::as_bool).unwrap_or(false);
        let user = person_of(conn.get("user"), 0)
            .map(|s| s.display_name)
            .unwrap_or_else(|| "未知账号".into());
        let id = nonempty(conn.get("id").unwrap_or(&Value::Null)).unwrap_or("?");
        return if enabled {
            format!("商务账号已连接 · {user} · {id}")
        } else {
            format!("商务账号已断开 · {user} · {id}")
        };
    }
    if let Some(deleted) = obj(row.get("deleted_business_messages").unwrap_or(&Value::Null)) {
        let chat = obj(deleted.get("chat").unwrap_or(&Value::Null))
            .and_then(|c| nonempty(c.get("title").unwrap_or(&Value::Null)).or_else(|| nonempty(c.get("first_name").unwrap_or(&Value::Null))))
            .unwrap_or("未知聊天");
        let n = deleted
            .get("message_ids")
            .and_then(Value::as_array)
            .map(|a| a.len())
            .unwrap_or(0);
        return format!("商务消息已删除 · {chat} · {n} 条");
    }
    let Some(message) = message_from_update(update) else {
        let keys: Vec<&str> = row.keys().map(|s| s.as_str()).collect();
        return format!("其它更新 ({})", keys.join(","));
    };
    let business = row.get("business_message").is_some() || row.get("edited_business_message").is_some();
    let chat = chat_of(message)
        .map(|(_, title, _, ty)| format!("{} {}", crate::logic::chat_type_label(&ty), title))
        .unwrap_or_else(|| "未知聊天".into());
    let from = person_of(message.get("from"), 0)
        .map(|s| s.display_name)
        .unwrap_or_else(|| "未知发送者".into());
    let text = nonempty(message.get("text").unwrap_or(&Value::Null)).unwrap_or("");
    let caption = nonempty(message.get("caption").unwrap_or(&Value::Null)).unwrap_or("");
    let kind = if message.get("photo").is_some() {
        "图片"
    } else if message.get("animation").is_some() {
        "动图"
    } else if message.get("video").is_some() || message.get("video_note").is_some() {
        "视频"
    } else if let Some(doc) = obj(message.get("document").unwrap_or(&Value::Null)) {
        crate::logic::kind_label(&kind_of_document(doc))
    } else if !text.is_empty() {
        "文字"
    } else {
        "消息"
    };
    let kind = if business { format!("商务{kind}") } else { kind.to_string() };
    let body = if !text.is_empty() {
        text
    } else if !caption.is_empty() {
        caption
    } else {
        ""
    };
    let hash = message
        .get("photo")
        .and_then(Value::as_array)
        .and_then(|a| a.last())
        .and_then(|p| obj(p).and_then(|m| nonempty(m.get("file_unique_id").unwrap_or(&Value::Null))))
        .or_else(|| {
            ["video", "animation", "video_note", "document", "sticker"]
                .iter()
                .find_map(|k| obj(message.get(*k).unwrap_or(&Value::Null)).and_then(|m| nonempty(m.get("file_unique_id").unwrap_or(&Value::Null))))
        })
        .unwrap_or("");
    let line = if body.is_empty() {
        format!("{kind} · {chat} · {from}")
    } else {
        format!("{kind} · {chat} · {from} · {body}")
    };
    if hash.is_empty() {
        line
    } else {
        format!("{line} · 指纹 {hash}")
    }
}
