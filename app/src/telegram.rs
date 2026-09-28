use reqwest::Client;
use serde_json::{json, Value};

use crate::error::AppError;

pub const ALLOWED_UPDATES: &[&str] = &[
    "message",
    "edited_message",
    "channel_post",
    "edited_channel_post",
    "business_connection",
    "business_message",
    "edited_business_message",
    "deleted_business_messages",
];

pub fn scrub(message: &str, token: &str) -> String {
    if token.is_empty() {
        message.to_string()
    } else {
        message.replace(token, "***")
    }
}

pub async fn call(http: &Client, token: &str, method: &str, payload: Value) -> Result<Value, AppError> {
    let url = format!("https://api.telegram.org/bot{token}/{method}");
    let response = http
        .post(url)
        .json(&payload)
        .send()
        .await
        .map_err(|err| AppError::Telegram(scrub(&err.to_string(), token)))?;
    let json: Value = response.json().await.map_err(|_| AppError::Telegram("Telegram 没有返回可识别的结果".into()))?;
    if json.get("ok").and_then(Value::as_bool) != Some(true) {
        let desc = json.get("description").and_then(Value::as_str).unwrap_or("Telegram 拒绝了这次请求");
        return Err(AppError::Telegram(scrub(desc, token)));
    }
    Ok(json.get("result").cloned().unwrap_or(Value::Null))
}

pub async fn send_message(
    http: &Client,
    token: &str,
    chat_id: &str,
    text: &str,
    business_connection_id: Option<&str>,
) -> Result<(), AppError> {
    let chat_id: i64 = chat_id.parse().map_err(|_| AppError::BadRequest("聊天编号不对".into()))?;
    let mut payload = json!({
        "chat_id": chat_id,
        "text": text.chars().take(4000).collect::<String>(),
        "disable_web_page_preview": true
    });
    if let Some(id) = business_connection_id.filter(|s| !s.is_empty()) {
        payload["business_connection_id"] = json!(id);
    }
    call(http, token, "sendMessage", payload).await?;
    Ok(())
}

pub async fn thumb_data_url(http: &Client, token: &str, file_id: &str) -> Result<Option<String>, AppError> {
    let meta = call(http, token, "getFile", json!({ "file_id": file_id })).await?;
    let file_path = meta.get("file_path").and_then(Value::as_str).unwrap_or("");
    let file_size = meta.get("file_size").and_then(Value::as_i64).unwrap_or(0);
    if file_path.is_empty() || file_size > 180_000 {
        return Ok(None);
    }
    let url = format!("https://api.telegram.org/file/bot{token}/{file_path}");
    let file_res = http.get(url).send().await?;
    if !file_res.status().is_success() {
        return Ok(None);
    }
    let mime = file_res
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/jpeg")
        .to_string();
    if !mime.starts_with("image/") {
        return Ok(None);
    }
    let bytes = file_res.bytes().await?;
    if bytes.len() > 180_000 {
        return Ok(None);
    }
    Ok(Some(format!(
        "data:{mime};base64,{}",
        base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &bytes)
    )))
}

pub async fn download_file(http: &Client, token: &str, file_id: &str, max_bytes: i64) -> Result<(String, Vec<u8>), AppError> {
    let meta = call(http, token, "getFile", json!({ "file_id": file_id })).await?;
    let file_path = meta
        .get("file_path")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::BadRequest("取不到这个文件".into()))?;
    let file_size = meta.get("file_size").and_then(Value::as_i64).unwrap_or(0);
    if file_size > max_bytes {
        return Err(AppError::BadRequest(format!(
            "文件超过 {} MB",
            (max_bytes / (1024 * 1024)).max(1)
        )));
    }
    let url = format!("https://api.telegram.org/file/bot{token}/{file_path}");
    let file_res = http
        .get(url)
        .timeout(std::time::Duration::from_secs(300))
        .send()
        .await?;
    if !file_res.status().is_success() {
        return Err(AppError::Telegram("Telegram 没有把文件传过来".into()));
    }
    let mime = file_res
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();
    Ok((mime, file_res.bytes().await?.to_vec()))
}
