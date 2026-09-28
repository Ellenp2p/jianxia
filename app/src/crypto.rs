use aes_gcm::aead::{Aead, Payload};
use aes_gcm::Aes256Gcm;
use aes_gcm::Nonce;
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine;
use hmac::{Hmac, KeyInit, Mac};
use rand::Rng;
use scrypt::{scrypt, Params};
use sha2::{Digest, Sha256};

use crate::error::AppError;

type HmacSha256 = Hmac<Sha256>;
const PREFIX: &str = "v1";
const SALT: &[u8] = b"jianxia-vault-v1";

pub fn derive_key(secret: &str) -> [u8; 32] {
    let params = Params::new(14, 8, 1).expect("scrypt params");
    let mut key = [0u8; 32];
    scrypt(secret.as_bytes(), SALT, &params, &mut key).expect("scrypt");
    key
}

pub fn random_hex(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    rand::rng().fill_bytes(&mut buf);
    hex::encode(buf)
}

pub fn random_alnum(len: usize) -> String {
    const CHARS: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789";
    let mut rng = rand::rng();
    (0..len)
        .map(|_| CHARS[(rng.next_u32() as usize) % CHARS.len()] as char)
        .collect()
}

pub fn secret_hash(secret: &str) -> String {
    hex::encode(Sha256::digest(secret.as_bytes()))
}

pub fn seal(cipher: &Aes256Gcm, plain: &str) -> Result<String, AppError> {
    let mut iv = [0u8; 12];
    rand::rng().fill_bytes(&mut iv);
    let packed = cipher
        .encrypt(&Nonce::from(iv), Payload { msg: plain.as_bytes(), aad: b"" })
        .map_err(|_| AppError::Internal("档案加密失败".into()))?;
    let split = packed.len().saturating_sub(16);
    let (enc, tag) = packed.split_at(split);
    Ok(format!("{PREFIX}:{}:{}:{}", STANDARD.encode(iv), STANDARD.encode(tag), STANDARD.encode(enc)))
}

pub fn open_seal(cipher: &Aes256Gcm, payload: &str) -> Result<String, AppError> {
    let parts: Vec<&str> = payload.split(':').collect();
    if parts.len() != 4 || parts[0] != PREFIX {
        return Err(AppError::Internal("档案密文无法识别".into()));
    }
    let iv = STANDARD.decode(parts[1]).map_err(|_| AppError::Internal("档案密文无法识别".into()))?;
    let tag = STANDARD.decode(parts[2]).map_err(|_| AppError::Internal("档案密文无法识别".into()))?;
    let data = STANDARD.decode(parts[3]).map_err(|_| AppError::Internal("档案密文无法识别".into()))?;
    let mut packed = data;
    packed.extend_from_slice(&tag);
    let plain = cipher
        .decrypt(
            &Nonce::try_from(iv.as_slice()).map_err(|_| AppError::Internal("档案密文无法识别".into()))?,
            Payload { msg: &packed, aad: b"" },
        )
        .map_err(|_| AppError::Internal("档案打不开，密钥可能换过".into()))?;
    String::from_utf8(plain).map_err(|_| AppError::Internal("档案内容不是文字".into()))
}

pub fn sign_admin_session(secret: &str, telegram_id: &str, now: i64) -> String {
    let exp = now + 12 * 60 * 60 * 1000;
    let json = format!(r#"{{"id":"{telegram_id}","exp":{exp}}}"#);
    let body = URL_SAFE_NO_PAD.encode(json.as_bytes());
    format!("{body}.{}", hmac_b64url(secret.as_bytes(), body.as_bytes()))
}

pub fn admin_id_from_session(secret: &str, token: &str, now: i64) -> Option<String> {
    let (body, sig) = token.split_once('.')?;
    let expected = hmac_b64url(secret.as_bytes(), body.as_bytes());
    if !secrets_match(sig, &expected) {
        return None;
    }
    let json = URL_SAFE_NO_PAD.decode(body).ok()?;
    let parsed: serde_json::Value = serde_json::from_slice(&json).ok()?;
    let id = parsed.get("id")?.as_str()?;
    if !is_admin_id(id) {
        return None;
    }
    let exp = parsed.get("exp")?.as_i64()?;
    (exp >= now).then(|| id.to_string())
}

pub fn widget_hash_ok(token: &str, fields: &[(String, String)], hash: &str) -> bool {
    let mut pairs: Vec<&(String, String)> = fields.iter().filter(|(k, v)| k != "hash" && !v.is_empty()).collect();
    pairs.sort_by(|a, b| a.0.cmp(&b.0));
    let data = pairs.iter().map(|(k, v)| format!("{k}={v}")).collect::<Vec<_>>().join("\n");
    let secret = Sha256::digest(token.as_bytes());
    let mut mac = HmacSha256::new_from_slice(&secret).expect("hmac");
    mac.update(data.as_bytes());
    secrets_match(&hex::encode(mac.finalize().into_bytes()), hash)
}

pub fn is_admin_id(value: &str) -> bool {
    let n = value.len();
    n >= 4 && n <= 16 && value.bytes().all(|b| b.is_ascii_digit())
}

pub fn token_ok(value: &str) -> bool {
    let value = value.trim();
    let Some((id, rest)) = value.split_once(':') else {
        return false;
    };
    (6..=12).contains(&id.len())
        && id.bytes().all(|b| b.is_ascii_digit())
        && rest.len() >= 20
        && rest.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

pub fn secrets_match(left: &str, right: &str) -> bool {
    let a = left.as_bytes();
    let b = right.as_bytes();
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

fn hmac_b64url(key: &[u8], data: &[u8]) -> String {
    let mut mac = HmacSha256::new_from_slice(key).expect("hmac");
    mac.update(data);
    URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes())
}
