use std::path::PathBuf;
use std::sync::Arc;

use aes_gcm::Aes256Gcm;
use aes_gcm::KeyInit;
use anyhow::{Context, Result};
use reqwest::Client;
use serde::Deserialize;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use sqlx::SqlitePool;
use tokio::sync::Mutex;

use crate::crypto::{derive_key, is_admin_id, random_hex, token_ok};

#[derive(Clone)]
pub struct AppState {
    pub pool: SqlitePool,
    pub config: Arc<Config>,
    pub http: Client,
    pub cipher: Aes256Gcm,
    pub lock: Arc<Mutex<()>>,
}

pub struct Config {
    pub bind: String,
    pub data_dir: PathBuf,
    pub vault_secret: String,
    pub poll_ms: u64,
    pub bot_token: String,
    pub admin_id: String,
}

#[derive(Default, Deserialize)]
struct FileConfig {
    #[serde(default)]
    bot_token: String,
    #[serde(default, alias = "admin_id")]
    admin_id: String,
    #[serde(default)]
    bind: String,
    #[serde(default)]
    data_dir: String,
    #[serde(default)]
    vault_secret: String,
    #[serde(default, alias = "better_auth_secret")]
    better_auth_secret: String,
    #[serde(default)]
    poll_ms: Option<u64>,
}

struct Cli {
    token: Option<String>,
    admin_id: Option<String>,
    bind: Option<String>,
    data_dir: Option<String>,
    config_path: Option<PathBuf>,
}

fn parse_cli() -> Cli {
    let mut cli = Cli {
        token: None,
        admin_id: None,
        bind: None,
        data_dir: None,
        config_path: None,
    };
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--token" | "--bot-token" => cli.token = args.next(),
            "--admin-id" | "--admin" => cli.admin_id = args.next(),
            "--bind" => cli.bind = args.next(),
            "--data-dir" => cli.data_dir = args.next(),
            "--config" => cli.config_path = args.next().map(PathBuf::from),
            _ if let Some(v) = arg.strip_prefix("--token=") => cli.token = Some(v.into()),
            _ if let Some(v) = arg.strip_prefix("--admin-id=") => cli.admin_id = Some(v.into()),
            _ if let Some(v) = arg.strip_prefix("--config=") => cli.config_path = Some(PathBuf::from(v)),
            _ => {}
        }
    }
    cli
}

fn env_nonempty(keys: &[&str]) -> String {
    for key in keys {
        if let Ok(v) = std::env::var(key) {
            let t = v.trim().to_string();
            if !t.is_empty() {
                return t;
            }
        }
    }
    String::new()
}

fn pick(cli: Option<String>, env: String, file: String) -> String {
    if let Some(v) = cli {
        let t = v.trim().to_string();
        if !t.is_empty() {
            return t;
        }
    }
    if !env.trim().is_empty() {
        return env.trim().to_string();
    }
    file.trim().to_string()
}

impl Config {
    pub fn load() -> Result<Self> {
        let cli = parse_cli();
        let file_path = cli.config_path.clone().unwrap_or_else(|| {
            std::env::var("JIANXIA_CONFIG")
                .ok()
                .filter(|s| !s.trim().is_empty())
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("jianxia.toml"))
        });
        let file = if file_path.exists() {
            let text = std::fs::read_to_string(&file_path)
                .with_context(|| format!("无法读取 {}", file_path.display()))?;
            toml::from_str::<FileConfig>(&text).with_context(|| format!("{} 不是合法 TOML", file_path.display()))?
        } else {
            FileConfig::default()
        };

        let bot_token = pick(
            cli.token,
            env_nonempty(&["JIANXIA_BOT_TOKEN", "TELEGRAM_BOT_TOKEN"]),
            file.bot_token,
        );
        let admin_id: String = pick(
            cli.admin_id,
            env_nonempty(&["JIANXIA_ADMIN_ID", "TELEGRAM_ADMIN_ID"]),
            file.admin_id,
        )
        .chars()
        .filter(|c| c.is_ascii_digit())
        .take(16)
        .collect();
        let bind = pick(
            cli.bind,
            env_nonempty(&["JIANXIA_BIND"]),
            file.bind,
        );
        let bind = if bind.is_empty() {
            "0.0.0.0:8080".into()
        } else {
            bind
        };
        let data_dir = pick(
            cli.data_dir,
            env_nonempty(&["JIANXIA_DATA_DIR"]),
            file.data_dir,
        );
        let data_dir = PathBuf::from(if data_dir.is_empty() { "data".into() } else { data_dir });
        let vault_secret = pick(
            None,
            env_nonempty(&["BETTER_AUTH_SECRET", "JIANXIA_VAULT_SECRET"]),
            if file.vault_secret.trim().is_empty() {
                file.better_auth_secret
            } else {
                file.vault_secret
            },
        );
        let vault_secret = if vault_secret.len() >= 16 {
            vault_secret
        } else {
            tracing::warn!("未设置 BETTER_AUTH_SECRET / vault_secret，重启可能打不开档案");
            random_hex(32)
        };
        let poll_ms = std::env::var("JIANXIA_POLL_MS")
            .ok()
            .and_then(|v| v.parse().ok())
            .or(file.poll_ms)
            .unwrap_or(4000)
            .max(500);

        if !bot_token.is_empty() && !token_ok(&bot_token) {
            anyhow::bail!("Bot Token 格式不对（JIANXIA_BOT_TOKEN / --token / jianxia.toml）");
        }
        if !admin_id.is_empty() && !is_admin_id(&admin_id) {
            anyhow::bail!("管理员 ID 必须是 4–16 位数字（JIANXIA_ADMIN_ID / --admin-id / jianxia.toml）");
        }

        Ok(Self {
            bind,
            data_dir,
            vault_secret,
            poll_ms,
            bot_token,
            admin_id,
        })
    }

    pub fn operator_ready(&self) -> bool {
        token_ok(&self.bot_token) && is_admin_id(&self.admin_id)
    }
}

pub async fn open_state(config: Config) -> Result<AppState> {
    tokio::fs::create_dir_all(&config.data_dir)
        .await
        .with_context(|| format!("无法创建 {}", config.data_dir.display()))?;
    let db_path = config.data_dir.join("jianxia.sqlite");
    let options = SqliteConnectOptions::new()
        .filename(&db_path)
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .foreign_keys(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(4)
        .connect_with(options)
        .await
        .with_context(|| format!("无法打开 {}", db_path.display()))?;
    sqlx::query(
        "create table if not exists secretary_vault (
            user_id text primary key,
            cipher text not null,
            version integer not null default 1,
            webhook_hash text,
            updated_at text not null
        )",
    )
    .execute(&pool)
    .await?;
    let key = derive_key(&config.vault_secret);
    let cipher = Aes256Gcm::new_from_slice(&key).expect("aes key");
    let http = Client::builder()
        .user_agent("jianxia/0.1")
        .timeout(std::time::Duration::from_secs(25))
        .build()?;
    Ok(AppState {
        pool,
        config: Arc::new(config),
        http,
        cipher,
        lock: Arc::new(Mutex::new(())),
    })
}
