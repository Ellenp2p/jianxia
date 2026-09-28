use std::io::Cursor;
use std::path::{Component, Path, PathBuf};

use crate::error::AppError;

pub const MAX_BYTES: i64 = 100 * 1024 * 1024;
pub const THUMB_SOURCE_MAX: i64 = 2 * 1024 * 1024;

pub fn files_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("files")
}

pub fn safe_stem(unique: &str) -> String {
    let s: String = unique
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
        .take(80)
        .collect();
    if s.is_empty() { "file".into() } else { s }
}

pub fn sniff_bytes(bytes: &[u8]) -> Option<&'static str> {
    if bytes.len() >= 3 && bytes[0] == 0xFF && bytes[1] == 0xD8 && bytes[2] == 0xFF {
        return Some("jpg");
    }
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Some("png");
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Some("gif");
    }
    if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return Some("webp");
    }
    if bytes.starts_with(b"BM") {
        return Some("bmp");
    }
    if bytes.len() >= 12 && &bytes[4..8] == b"ftyp" {
        return Some("mp4");
    }
    if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"AVI " {
        return Some("avi");
    }
    None
}

pub fn sniff_path(path: &Path) -> Option<&'static str> {
    let mut file = std::fs::File::open(path).ok()?;
    let mut buf = [0u8; 16];
    use std::io::Read;
    let n = file.read(&mut buf).ok()?;
    sniff_bytes(&buf[..n])
}

pub fn is_image_ext(ext: &str) -> bool {
    matches!(ext, "jpg" | "jpeg" | "png" | "webp" | "gif" | "bmp" | "heic" | "heif" | "tif" | "tiff" | "avif")
}

pub fn ext_for(mime: &str, caption: &str, kind: Option<&crate::types::MediaKind>) -> String {
    let mime = mime.to_ascii_lowercase();
    let from_mime = match mime.as_str() {
        "image/jpeg" | "image/jpg" => Some("jpg"),
        "image/png" => Some("png"),
        "image/webp" => Some("webp"),
        "image/gif" => Some("gif"),
        "image/bmp" => Some("bmp"),
        "image/heic" | "image/heif" => Some("heic"),
        "video/mp4" => Some("mp4"),
        "video/quicktime" => Some("mov"),
        "video/webm" => Some("webm"),
        "video/x-matroska" => Some("mkv"),
        "video/x-msvideo" => Some("avi"),
        "application/pdf" => Some("pdf"),
        _ if mime.starts_with("image/") => Some("jpg"),
        _ if mime.starts_with("video/") => Some("mp4"),
        _ => None,
    };
    if let Some(ext) = from_mime {
        return ext.into();
    }
    let name = caption.rsplit(['/', '\\']).next().unwrap_or(caption);
    if let Some((_, ext)) = name.rsplit_once('.') {
        let ext = ext.to_ascii_lowercase();
        if ext.chars().all(|c| c.is_ascii_alphanumeric()) && (1..8).contains(&ext.len()) {
            return ext;
        }
    }
    match kind {
        Some(crate::types::MediaKind::Photo) => "jpg".into(),
        Some(crate::types::MediaKind::Video) => "mp4".into(),
        Some(crate::types::MediaKind::Animation) => "mp4".into(),
        _ => "bin".into(),
    }
}

pub fn mime_from_ext(ext: &str) -> &'static str {
    match ext.to_ascii_lowercase().as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "heic" | "heif" => "image/heic",
        "mp4" | "m4v" => "video/mp4",
        "mov" => "video/quicktime",
        "webm" => "video/webm",
        "mkv" => "video/x-matroska",
        "avi" => "video/x-msvideo",
        "pdf" => "application/pdf",
        _ => "application/octet-stream",
    }
}

pub fn resolve_local(data_dir: &Path, media_url: &str) -> Option<PathBuf> {
    let rel = Path::new(media_url);
    if rel.is_absolute() {
        return None;
    }
    if rel.components().any(|c| matches!(c, Component::ParentDir | Component::Prefix(_))) {
        return None;
    }
    let mut comps = rel.components();
    match comps.next() {
        Some(Component::Normal(first)) if first == "files" => {}
        _ => return None,
    }
    Some(data_dir.join(rel))
}

pub async fn existing(data_dir: &Path, unique: &str) -> Option<String> {
    let stem = safe_stem(unique);
    let dir = files_dir(data_dir);
    let mut entries = tokio::fs::read_dir(&dir).await.ok()?;
    while let Ok(Some(entry)) = entries.next_entry().await {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name == stem || name.starts_with(&format!("{stem}.")) {
            return Some(format!("files/{name}"));
        }
    }
    None
}

pub async fn original_path(data_dir: &Path, unique: &str, media_url: Option<&str>) -> Option<PathBuf> {
    if let Some(url) = media_url {
        if let Some(path) = resolve_local(data_dir, url) {
            if path.is_file() {
                return Some(path);
            }
        }
    }
    if unique.is_empty() {
        return None;
    }
    let rel = existing(data_dir, unique).await?;
    let path = resolve_local(data_dir, &rel)?;
    path.is_file().then_some(path)
}

pub async fn persist(
    data_dir: &Path,
    unique: &str,
    caption: &str,
    mime: &str,
    bytes: &[u8],
    kind: &crate::types::MediaKind,
) -> Result<String, AppError> {
    let dir = files_dir(data_dir);
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|err| AppError::Internal(format!("无法创建原件目录: {err}")))?;
    let ext = sniff_bytes(bytes).map(|s| s.to_string()).unwrap_or_else(|| ext_for(mime, caption, Some(kind)));
    let name = format!("{}.{}", safe_stem(unique), ext);
    let path = dir.join(&name);
    if !path.exists() {
        tokio::fs::write(&path, bytes)
            .await
            .map_err(|err| AppError::Internal(format!("原件没写下盘: {err}")))?;
    }
    Ok(format!("files/{name}"))
}

pub fn thumb_url(unique: &str) -> String {
    format!("/thumb?u={}", urlencoding::encode(unique))
}

pub fn thumb_path(data_dir: &Path, unique: &str) -> PathBuf {
    data_dir.join("thumbs").join(format!("{}.jpg", safe_stem(unique)))
}

pub async fn remove_kept(data_dir: &Path, unique: &str, media_url: Option<&str>) -> bool {
    let mut gone = false;
    if !unique.is_empty() {
        let thumb = thumb_path(data_dir, unique);
        if thumb.is_file() {
            gone |= tokio::fs::remove_file(&thumb).await.is_ok();
        }
        if let Some(rel) = existing(data_dir, unique).await {
            if let Some(path) = resolve_local(data_dir, &rel) {
                if path.is_file() {
                    gone |= tokio::fs::remove_file(&path).await.is_ok();
                }
            }
        }
    }
    if let Some(url) = media_url {
        if let Some(path) = resolve_local(data_dir, url) {
            if path.is_file() {
                gone |= tokio::fs::remove_file(&path).await.is_ok();
            }
        }
    }
    gone
}

fn is_image_rel(rel: &str) -> bool {
    let ext = rel.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    matches!(ext.as_str(), "jpg" | "jpeg" | "png" | "webp" | "gif" | "bmp" | "tif" | "tiff" | "avif" | "heic" | "heif")
}

fn encode_thumb(bytes: &[u8]) -> Option<Vec<u8>> {
    let mut reader = image::ImageReader::new(Cursor::new(bytes)).with_guessed_format().ok()?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(12_000);
    limits.max_image_height = Some(12_000);
    reader.limits(limits);
    let img = reader.decode().ok()?;
    let img = img.thumbnail(480, 480).into_rgb8();
    let mut out = Cursor::new(Vec::new());
    let mut enc = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 72);
    enc.encode(img.as_raw(), img.width(), img.height(), image::ExtendedColorType::Rgb8)
        .ok()?;
    Some(out.into_inner())
}

pub async fn persist_thumb(data_dir: &Path, unique: &str, bytes: &[u8]) -> Option<String> {
    if unique.is_empty() || bytes.is_empty() {
        return None;
    }
    let dest = thumb_path(data_dir, unique);
    if dest.is_file() {
        return Some(thumb_url(unique));
    }
    let bytes = bytes.to_vec();
    let jpeg = tokio::task::spawn_blocking(move || encode_thumb(&bytes)).await.ok()??;
    if let Some(dir) = dest.parent() {
        tokio::fs::create_dir_all(dir).await.ok()?;
    }
    tokio::fs::write(&dest, jpeg).await.ok()?;
    Some(thumb_url(unique))
}

pub async fn ensure_thumb(data_dir: &Path, unique: &str) -> Option<PathBuf> {
    let dest = thumb_path(data_dir, unique);
    if dest.is_file() {
        return Some(dest);
    }
    let rel = existing(data_dir, unique).await?;
    if !is_image_rel(&rel) {
        return None;
    }
    let path = resolve_local(data_dir, &rel)?;
    let bytes = tokio::fs::read(&path).await.ok()?;
    persist_thumb(data_dir, unique, &bytes).await?;
    dest.is_file().then_some(dest)
}

pub fn page_preview(stored: &str, unique: &str, saved: bool, kind: &crate::types::MediaKind) -> String {
    if !stored.is_empty() {
        return stored.to_string();
    }
    if unique.is_empty() {
        return String::new();
    }
    match kind {
        crate::types::MediaKind::Photo | crate::types::MediaKind::Animation => thumb_url(unique),
        crate::types::MediaKind::Document if saved => thumb_url(unique),
        _ => String::new(),
    }
}
