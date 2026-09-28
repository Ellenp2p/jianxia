use std::net::{IpAddr, SocketAddr};

use axum::http::HeaderMap;

use crate::config::AppState;
use crate::crypto::secrets_match;
use crate::error::AppError;

pub fn is_loopback(ip: IpAddr) -> bool {
    canonical(ip).is_loopback()
}

fn canonical(ip: IpAddr) -> IpAddr {
    match ip {
        IpAddr::V6(v6) => v6.to_ipv4_mapped().map(IpAddr::from).unwrap_or(IpAddr::V6(v6)),
        other => other,
    }
}

pub fn client_ip(peer: SocketAddr, headers: &HeaderMap) -> IpAddr {
    let peer_ip = canonical(peer.ip());
    if is_loopback(peer_ip) {
        if let Some(raw) = headers.get("x-real-ip").and_then(|v| v.to_str().ok()) {
            if let Ok(ip) = raw.trim().parse::<IpAddr>() {
                return canonical(ip);
            }
        }
    }
    peer_ip
}

pub fn assert_first_claim(
    state: &AppState,
    claimed: bool,
    client_ip: IpAddr,
    provided_secret: &str,
) -> Result<(), AppError> {
    if claimed || is_loopback(client_ip) {
        return Ok(());
    }
    if secrets_match(state.config.setup_secret.trim(), provided_secret.trim())
        && !state.config.setup_secret.trim().is_empty()
    {
        return Ok(());
    }
    Err(AppError::Forbidden(
        "第一次设置不能从外网直接认领。请在这台电脑打开，或填写 data/setup.lock / JIANXIA_SETUP_SECRET。"
            .into(),
    ))
}
