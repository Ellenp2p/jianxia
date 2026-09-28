mod commands;
mod config;
mod crypto;
mod error;
mod keep;
mod logic;
mod pack;
mod parse;
mod telegram;
mod types;
mod vault;
mod web;

use anyhow::Context;
use axum::routing::get_service;
use tower_http::services::ServeDir;
use tracing_subscriber::EnvFilter;

use crate::config::{open_state, Config};
use crate::vault::bot_loop;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let _ = dotenvy::dotenv();
    tracing_subscriber::fmt()
        .with_env_filter(log_filter())
        .with_target(false)
        .init();

    let config = Config::load()?;
    let bind = config.bind.clone();
    let ready = config.operator_ready();
    let state = open_state(config).await?;
    if ready {
        let username = vault::apply_boot_identity(&state, &state.config.bot_token, &state.config.admin_id)
            .await
            .context("启动时核对 Bot Token 失败")?;
        tracing::info!(bot = %username, "Bot 已接入，开始轮询");
        tokio::spawn(bot_loop(state.clone()));
    } else {
        tracing::error!(
            "还没接上机器人。启动时带 JIANXIA_BOT_TOKEN 和 JIANXIA_ADMIN_ID，或 --token / --admin-id，或 jianxia.toml。"
        );
    }

    let static_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("static");
    let app = web::router(state)
        .nest_service("/static", get_service(ServeDir::new(static_dir)))
        .into_make_service_with_connect_info::<std::net::SocketAddr>();

    let listener = tokio::net::TcpListener::bind(&bind)
        .await
        .with_context(|| format!("无法监听 {bind}"))?;
    tracing::info!(bind, "笺匣（Rust SSR + Bot）已启动");
    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    Ok(())
}

fn log_filter() -> EnvFilter {
    let mut spec = None;
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        if arg == "--log" {
            spec = args.next();
            break;
        }
        if let Some(v) = arg.strip_prefix("--log=") {
            spec = Some(v.to_string());
            break;
        }
    }
    let spec = spec
        .or_else(|| std::env::var("JIANXIA_LOG").ok().filter(|s| !s.trim().is_empty()))
        .or_else(|| std::env::var("RUST_LOG").ok().filter(|s| !s.trim().is_empty()))
        .unwrap_or_else(|| "jianxia=info".into());
    EnvFilter::try_new(spec).unwrap_or_else(|_| EnvFilter::new("jianxia=info"))
}
