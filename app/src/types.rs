use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum MediaKind {
    Photo,
    Video,
    Animation,
    Document,
    Text,
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ChatType {
    Private,
    Group,
    Supergroup,
    Channel,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum Via {
    #[serde(rename = "list")]
    List,
    #[serde(rename = "new-private")]
    NewPrivate,
    #[serde(rename = "new-group")]
    NewGroup,
    #[serde(rename = "other")]
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Reveal {
    Open,
    Flash,
    Spoiler,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ItemStatus {
    Kept,
    Duplicate,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DuplicateReason {
    File,
    Visual,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum LogLevel {
    Kept,
    Duplicate,
    Skip,
    Info,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub id: String,
    pub query: String,
    pub resolved_id: Option<String>,
    pub resolved_title: Option<String>,
    pub resolved_username: Option<String>,
    pub status: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub token: String,
    pub photos: bool,
    pub videos: bool,
    pub animations: bool,
    pub documents: bool,
    pub watch_new_private: bool,
    pub watch_new_groups: bool,
    pub visual_dedupe: bool,
    pub visual_threshold: i32,
    pub flashes: bool,
    pub admin_id: String,
    pub sources: Vec<Source>,
    /// Download originals to disk when a file arrives.
    #[serde(default = "keep_files_default")]
    pub keep_files: bool,
}

fn keep_files_default() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Incoming {
    pub file_unique_id: String,
    pub file_id: String,
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
    pub preview: String,
    pub media_url: Option<String>,
    pub visual_hash: String,
    pub origin: String,
    pub sender_id: String,
    pub sender_name: String,
    pub sender_username: Option<String>,
    pub reveal: Reveal,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveItem {
    #[serde(flatten)]
    pub incoming: Incoming,
    pub id: String,
    pub saved_at: i64,
    pub status: ItemStatus,
    pub duplicate_of_id: Option<String>,
    pub duplicate_reason: Option<DuplicateReason>,
    pub via: Option<Via>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub id: String,
    pub at: i64,
    pub level: LogLevel,
    pub title: String,
    pub detail: String,
    pub chat_title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Speaker {
    pub hidden_id: String,
    pub display_name: String,
    pub username: Option<String>,
    pub at: i64,
    #[serde(rename = "where", skip_serializing_if = "Option::is_none")]
    pub where_at: Option<ChatType>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NameSnap {
    pub at: i64,
    pub display_name: String,
    pub username: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Person {
    pub hidden_id: String,
    pub display_name: String,
    pub username: Option<String>,
    pub first_seen: i64,
    pub last_seen: i64,
    pub speak_count: i64,
    pub names: Vec<NameSnap>,
    #[serde(default)]
    pub places: Vec<ChatType>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryRow {
    pub id: String,
    pub at: i64,
    pub hidden_id: String,
    pub display_name: String,
    pub username: Option<String>,
    pub kind: MediaKind,
    pub reveal: Reveal,
    pub caption: String,
    pub chat_title: String,
    pub chat_id: String,
    pub chat_type: ChatType,
    pub status: ItemStatus,
    pub file_unique_id: String,
    pub preview: String,
    pub archive_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginChallenge {
    pub code: String,
    pub exp: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginGrant {
    pub code: String,
    pub user_id: String,
    pub ok: bool,
    pub exp: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretBody {
    pub settings: Settings,
    pub items: Vec<ArchiveItem>,
    pub logs: Vec<LogEntry>,
    pub enrolled_private: Vec<String>,
    pub enrolled_group: Vec<String>,
    pub people: Vec<Person>,
    pub history: Vec<HistoryRow>,
    pub update_offset: i64,
    pub bot_name: String,
    pub bot_username: String,
    #[serde(default)]
    pub bot_id: String,
    #[serde(default)]
    pub webhook_secret: String,
    #[serde(default)]
    pub server_listening: bool,
    #[serde(default)]
    pub last_update_id: i64,
    #[serde(default)]
    pub login_challenge: Option<LoginChallenge>,
    #[serde(default)]
    pub login_grant: Option<LoginGrant>,
}

#[derive(Debug, Clone, Default)]
pub struct FoldState {
    pub items: Vec<ArchiveItem>,
    pub logs: Vec<LogEntry>,
    pub enrolled_private: Vec<String>,
    pub enrolled_group: Vec<String>,
    pub people: Vec<Person>,
    pub history: Vec<HistoryRow>,
}

impl From<&SecretBody> for FoldState {
    fn from(body: &SecretBody) -> Self {
        Self {
            items: body.items.clone(),
            logs: body.logs.clone(),
            enrolled_private: body.enrolled_private.clone(),
            enrolled_group: body.enrolled_group.clone(),
            people: body.people.clone(),
            history: body.history.clone(),
        }
    }
}

impl FoldState {
    pub fn apply_to(self, body: &mut SecretBody) {
        body.items = self.items;
        body.logs = self.logs;
        body.enrolled_private = self.enrolled_private;
        body.enrolled_group = self.enrolled_group;
        body.people = self.people;
        body.history = self.history;
    }
}

pub fn shrink_preview(value: &str) -> String {
    if value.starts_with("data:") && value.len() > 48_000 {
        String::new()
    } else {
        value.to_string()
    }
}
