use std::collections::HashSet;
use std::fs::File;
use std::io::{Write, copy};
use std::path::{Path, PathBuf};

use zip::CompressionMethod;
use zip::ZipWriter;
use zip::write::SimpleFileOptions;

use crate::error::AppError;
use crate::logic::{display_kind, format_file_stamp, format_stamp, is_packable_media};
use crate::types::{ArchiveItem, MediaKind, SecretBody};

pub struct PackJob {
    pub dest: PathBuf,
    pub count: usize,
    pub filename: String,
}

fn sanitize_part(value: &str, max: usize) -> String {
    let mut out = String::new();
    for ch in value.chars() {
        if out.chars().count() >= max {
            break;
        }
        if ch.is_control() || matches!(ch, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
            continue;
        }
        if ch == ' ' || ch == '　' {
            if !out.ends_with('_') {
                out.push('_');
            }
            continue;
        }
        out.push(ch);
    }
    let out = out.trim_matches('_').to_string();
    if out.is_empty() { "未命名".into() } else { out }
}

fn entry_ext(item: &ArchiveItem, path: &Path) -> String {
    if let Some(ext) = crate::keep::sniff_path(path) {
        return ext.to_string();
    }
    let from_path = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !from_path.is_empty() && from_path != "bin" {
        return from_path;
    }
    crate::keep::ext_for("", &item.incoming.caption, Some(&item.incoming.kind))
}

fn entry_name(item: &ArchiveItem, path: &Path, used: &mut HashSet<String>) -> String {
    let ext = entry_ext(item, path);
    let stamp = format_file_stamp(item.incoming.occurred_at);
    let kind = display_kind(&item.incoming.kind, &item.incoming.caption);
    let who = sanitize_part(&item.incoming.sender_name, 16);
    let cap = sanitize_part(&item.incoming.caption, 24);
    let stem = crate::keep::safe_stem(&item.incoming.file_unique_id);
    let mut name = format!("{stamp}_{kind}_{who}_{cap}_{stem}.{ext}");
    if used.contains(&name) {
        name = format!("{stamp}_{kind}_{who}_{stem}_{}.{ext}", used.len());
    }
    used.insert(name.clone());
    name
}

fn write_zip(dest: &Path, listing: &str, files: &[(String, PathBuf)]) -> Result<(), AppError> {
    if let Some(dir) = dest.parent() {
        std::fs::create_dir_all(dir).map_err(|err| AppError::Internal(format!("无法创建打包目录: {err}")))?;
    }
    let file = File::create(dest).map_err(|err| AppError::Internal(format!("无法写打包文件: {err}")))?;
    let mut zip = ZipWriter::new(file);
    let text_opts = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    zip.start_file("清单.txt", text_opts)
        .map_err(|err| AppError::Internal(format!("打包失败: {err}")))?;
    zip.write_all(listing.as_bytes())
        .map_err(|err| AppError::Internal(format!("打包失败: {err}")))?;
    let file_opts = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
    for (name, path) in files {
        zip.start_file(name, file_opts.clone())
            .map_err(|err| AppError::Internal(format!("打包失败: {err}")))?;
        let mut src = File::open(path).map_err(|err| AppError::Internal(format!("读不出原件: {err}")))?;
        copy(&mut src, &mut zip).map_err(|err| AppError::Internal(format!("打包失败: {err}")))?;
    }
    zip.finish()
        .map_err(|err| AppError::Internal(format!("打包失败: {err}")))?;
    Ok(())
}

pub async fn build_selected(data_dir: &Path, body: &SecretBody, ids: &[String]) -> Result<PackJob, AppError> {
    let mut want = HashSet::new();
    for id in ids {
        let id = id.trim();
        if !id.is_empty() {
            want.insert(id.to_string());
        }
        if want.len() >= 200 {
            break;
        }
    }
    if want.is_empty() {
        return Err(AppError::BadRequest("先勾选要打包的原件。".into()));
    }
    let mut used_names = HashSet::new();
    let mut used_unique = HashSet::new();
    let mut files = Vec::new();
    let mut lines = vec!["笺匣原件打包".to_string(), "按勾选".to_string(), String::new()];
    for item in &body.items {
        if !want.contains(&item.id) {
            continue;
        }
        if item.incoming.kind == MediaKind::Text
            || !is_packable_media(&item.incoming.kind, &item.incoming.caption)
        {
            continue;
        }
        let unique = item.incoming.file_unique_id.as_str();
        if !unique.is_empty() && !used_unique.insert(unique.to_string()) {
            continue;
        }
        let Some(path) = crate::keep::original_path(data_dir, unique, item.incoming.media_url.as_deref()).await else {
            continue;
        };
        let name = entry_name(item, &path, &mut used_names);
        lines.push(format!(
            "{} · {} · {} · {} · {}",
            format_stamp(item.incoming.occurred_at),
            display_kind(&item.incoming.kind, &item.incoming.caption),
            item.incoming.sender_name,
            if item.incoming.caption.is_empty() {
                "无标题"
            } else {
                item.incoming.caption.as_str()
            },
            name
        ));
        files.push((name, path));
    }
    if files.is_empty() {
        return Err(AppError::BadRequest(
            "勾选的条目里没有可打包的图片或视频。文字目前不支持导出。".into(),
        ));
    }
    lines.push(String::new());
    lines.push(format!("共 {} 个文件。", files.len()));
    let listing = lines.join("\n");
    let filename = format!("jianxia-{}.zip", format_file_stamp(chrono::Utc::now().timestamp_millis()));
    let dest = data_dir.join("packs").join(&filename);
    let listing_clone = listing.clone();
    let dest_clone = dest.clone();
    tokio::task::spawn_blocking(move || write_zip(&dest_clone, &listing_clone, &files))
        .await
        .map_err(|err| AppError::Internal(format!("打包中断: {err}")))??;
    Ok(PackJob {
        dest,
        count: used_names.len(),
        filename,
    })
}
