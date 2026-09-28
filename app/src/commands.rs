use chrono::{Datelike, TimeZone, Utc};
use regex::Regex;
use std::sync::OnceLock;

use crate::logic::{format_stamp, kind_label, reveal_label};
use crate::types::*;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Scope {
    All,
    Private,
    Group,
    Channel,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum When {
    All,
    Today,
    Yesterday,
    Week,
    Month,
}

#[derive(Clone)]
pub struct ViewQuery {
    pub scope: Scope,
    pub when: When,
    pub flash_only: bool,
    pub text: String,
}

impl Default for ViewQuery {
    fn default() -> Self {
        Self {
            scope: Scope::All,
            when: When::All,
            flash_only: false,
            text: String::new(),
        }
    }
}

impl Scope {
    pub fn parse(s: &str) -> Self {
        match s {
            "private" | "私聊" | "pm" => Scope::Private,
            "group" | "群" | "群聊" => Scope::Group,
            "channel" | "频道" => Scope::Channel,
            _ => Scope::All,
        }
    }
    pub fn as_str(self) -> &'static str {
        match self {
            Scope::All => "all",
            Scope::Private => "private",
            Scope::Group => "group",
            Scope::Channel => "channel",
        }
    }
    pub fn label(self) -> &'static str {
        match self {
            Scope::All => "全部",
            Scope::Private => "私聊",
            Scope::Group => "群聊",
            Scope::Channel => "频道",
        }
    }
}

impl When {
    pub fn parse(s: &str) -> Self {
        match s {
            "today" | "今天" => When::Today,
            "yesterday" | "昨天" => When::Yesterday,
            "week" | "近7天" | "7天" | "本周" => When::Week,
            "month" | "本月" => When::Month,
            _ => When::All,
        }
    }
    pub fn as_str(self) -> &'static str {
        match self {
            When::All => "all",
            When::Today => "today",
            When::Yesterday => "yesterday",
            When::Week => "week",
            When::Month => "month",
        }
    }
    pub fn label(self) -> &'static str {
        match self {
            When::All => "全部时间",
            When::Today => "今天",
            When::Yesterday => "昨天",
            When::Week => "近7天",
            When::Month => "本月",
        }
    }
}

const SHIFT: i64 = 8 * 60 * 60 * 1000;

fn start_of_day(now: i64) -> i64 {
    let shifted = now + SHIFT;
    let dt = Utc.timestamp_opt(shifted.div_euclid(1000), 0).single().unwrap_or(Utc.timestamp_opt(0, 0).unwrap());
    Utc.with_ymd_and_hms(dt.year(), dt.month(), dt.day(), 0, 0, 0)
        .single()
        .unwrap_or(dt)
        .timestamp()
        * 1000
        - SHIFT
}

fn time_window(when: When, now: i64) -> Option<(i64, i64)> {
    let start = start_of_day(now);
    match when {
        When::All => None,
        When::Today => Some((start, start + 86_400_000)),
        When::Yesterday => Some((start - 86_400_000, start)),
        When::Week => Some((now - 7 * 86_400_000, i64::MAX)),
        When::Month => {
            let shifted = now + SHIFT;
            let dt = Utc.timestamp_opt(shifted.div_euclid(1000), 0).single()?;
            let from = Utc.with_ymd_and_hms(dt.year(), dt.month(), 1, 0, 0, 0).single()?.timestamp() * 1000 - SHIFT;
            let to_dt = if dt.month() == 12 {
                Utc.with_ymd_and_hms(dt.year() + 1, 1, 1, 0, 0, 0).single()?
            } else {
                Utc.with_ymd_and_hms(dt.year(), dt.month() + 1, 1, 0, 0, 0).single()?
            };
            Some((from, to_dt.timestamp() * 1000 - SHIFT))
        }
    }
}

fn in_window(at: i64, when: When, now: i64) -> bool {
    time_window(when, now).map(|(from, to)| at >= from && at < to).unwrap_or(true)
}

fn overlaps(start: i64, end: i64, when: When, now: i64) -> bool {
    time_window(when, now).map(|(from, to)| end >= from && start < to).unwrap_or(true)
}

pub fn history_scope(row: &HistoryRow) -> Scope {
    match row.chat_type {
        ChatType::Private => Scope::Private,
        ChatType::Group | ChatType::Supergroup => Scope::Group,
        ChatType::Channel => Scope::Channel,
    }
}

fn person_scopes(person: &Person, history: &[HistoryRow]) -> Vec<Scope> {
    let mut set = vec![];
    let mut add = |s: Scope| {
        if !set.contains(&s) {
            set.push(s);
        }
    };
    for place in &person.places {
        match place {
            ChatType::Private => add(Scope::Private),
            ChatType::Channel => add(Scope::Channel),
            _ => add(Scope::Group),
        }
    }
    for row in history {
        if row.hidden_id == person.hidden_id {
            add(history_scope(row));
        }
    }
    set
}

fn blob(parts: &[Option<&str>]) -> String {
    parts.iter().flatten().copied().collect::<Vec<_>>().join(" ").to_lowercase()
}

pub fn match_history(row: &HistoryRow, query: &ViewQuery, now: i64) -> bool {
    if query.flash_only && row.reveal == Reveal::Open {
        return false;
    }
    if query.scope != Scope::All && history_scope(row) != query.scope {
        return false;
    }
    if !in_window(row.at, query.when, now) {
        return false;
    }
    let needle = query.text.trim().to_lowercase();
    if needle.is_empty() {
        return true;
    }
    blob(&[
        Some(row.caption.as_str()),
        Some(row.display_name.as_str()),
        row.username.as_deref(),
        Some(row.hidden_id.as_str()),
        Some(row.chat_title.as_str()),
        Some(row.chat_id.as_str()),
    ])
    .contains(&needle)
}

pub fn match_person(person: &Person, history: &[HistoryRow], query: &ViewQuery, now: i64) -> bool {
    if query.flash_only {
        return history
            .iter()
            .any(|row| row.hidden_id == person.hidden_id && match_history(row, query, now));
    }
    if !overlaps(person.first_seen, person.last_seen, query.when, now) {
        return false;
    }
    if query.scope != Scope::All && !person_scopes(person, history).contains(&query.scope) {
        return false;
    }
    let needle = query.text.trim().to_lowercase();
    if needle.is_empty() {
        return true;
    }
    let mut parts: Vec<Option<&str>> = vec![
        Some(person.display_name.as_str()),
        person.username.as_deref(),
        Some(person.hidden_id.as_str()),
    ];
    for snap in &person.names {
        parts.push(Some(snap.display_name.as_str()));
        parts.push(snap.username.as_deref());
    }
    blob(&parts).contains(&needle)
}

pub fn describe_query(query: &ViewQuery) -> String {
    let mut bits = vec![query.scope.label().to_string(), query.when.label().to_string()];
    if query.flash_only {
        bits.push("闪照".into());
    }
    if !query.text.trim().is_empty() {
        bits.push(query.text.trim().to_string());
    }
    bits.join(" · ")
}

#[derive(Clone, Copy)]
pub enum CommandName {
    Id,
    Help,
    People,
    History,
}

pub fn login_code_of(text: &str) -> Option<String> {
    static START: OnceLock<Regex> = OnceLock::new();
    static WORD: OnceLock<Regex> = OnceLock::new();
    let trimmed = text.trim();
    let start = START.get_or_init(|| {
        Regex::new(r"(?i)^/start(?:@[A-Za-z0-9_]+)?\s+login_([A-Za-z0-9]{6,12})$").unwrap()
    });
    if let Some(caps) = start.captures(trimmed) {
        return Some(caps[1].to_lowercase());
    }
    WORD.get_or_init(|| Regex::new(r"^(?:登录|登陆)\s+([A-Za-z0-9]{6,12})$").unwrap())
        .captures(trimmed)
        .map(|c| c[1].to_lowercase())
}

fn command_name(word: &str) -> Option<CommandName> {
    match word {
        "id" | "我的id" | "编号" => Some(CommandName::Id),
        "help" | "start" | "帮助" | "命令" | "怎么用" => Some(CommandName::Help),
        "人" | "谁" | "people" | "人物" => Some(CommandName::People),
        "史" | "history" | "记录" | "历史" | "查看" => Some(CommandName::History),
        _ => None,
    }
}

pub fn parse_command(text: &str) -> Option<(CommandName, ViewQuery)> {
    let mut parts = text.trim().split_whitespace();
    let mut word = parts.next()?.to_string();
    if word.starts_with('/') {
        word = word[1..].split('@').next().unwrap_or("").to_string();
    }
    let name = command_name(&word.to_lowercase())?;
    let mut query = ViewQuery::default();
    let mut leftover = vec![];
    for token in parts {
        match token {
            "私聊" | "private" | "pm" => query.scope = Scope::Private,
            "群" | "群聊" | "group" => query.scope = Scope::Group,
            "频道" | "channel" => query.scope = Scope::Channel,
            "全部" => query.scope = Scope::All,
            "今天" | "today" => query.when = When::Today,
            "昨天" | "yesterday" => query.when = When::Yesterday,
            "7天" | "近7天" | "本周" | "week" => query.when = When::Week,
            "本月" | "month" => query.when = When::Month,
            "全部时间" => query.when = When::All,
            "闪照" | "遮罩" | "flash" => query.flash_only = true,
            _ => leftover.push(token),
        }
    }
    query.text = leftover.join(" ");
    Some((name, query))
}

pub fn is_command(text: &str) -> bool {
    parse_command(text).is_some()
}

pub fn answer_command(
    text: &str,
    user_id: &str,
    admin_id: &str,
    people: &[Person],
    history: &[HistoryRow],
    now: i64,
) -> Option<String> {
    if login_code_of(text).is_some() {
        return None;
    }
    let (name, query) = parse_command(text)?;
    if matches!(name, CommandName::Id) {
        return Some(format!(
            "你的隐藏 ID 是 {user_id}。把它填进笺匣的管理员之后，再发「人」或「历史」。"
        ));
    }
    if admin_id.trim() != user_id {
        return None;
    }
    Some(match name {
        CommandName::Help => [
            "只回复你本人的私聊。",
            "",
            "人 私聊 昨天",
            "历史 频道 近7天 闪照",
            "我的id / 帮助",
        ]
        .join("\n"),
        CommandName::People => {
            let matched: Vec<&Person> = people
                .iter()
                .filter(|p| match_person(p, history, &query, now))
                .collect();
            let mut lines = vec![
                format!("人物 · {}", describe_query(&query)),
                format!("共 {} 人", matched.len()),
                String::new(),
            ];
            for p in matched.iter().take(8) {
                lines.push(format!(
                    "{} {} · {} · 最近 {}",
                    p.display_name,
                    p.username.as_deref().map(|u| format!("@{u}")).unwrap_or_else(|| "没有用户名".into()),
                    p.hidden_id,
                    format_stamp(p.last_seen)
                ));
            }
            lines.join("\n")
        }
        CommandName::History => {
            let matched: Vec<&HistoryRow> = history.iter().filter(|row| match_history(row, &query, now)).collect();
            let mut lines = vec![
                format!("媒体 · {}", describe_query(&query)),
                format!("共 {} 条", matched.len()),
                String::new(),
            ];
            for row in matched.iter().take(8) {
                lines.push(format!(
                    "{} · {} · {} · {}",
                    format_stamp(row.at),
                    kind_label(&row.kind),
                    reveal_label(&row.reveal),
                    if row.caption.is_empty() {
                        row.chat_title.as_str()
                    } else {
                        row.caption.as_str()
                    }
                ));
            }
            lines.join("\n")
        }
        CommandName::Id => unreachable!(),
    })
}
