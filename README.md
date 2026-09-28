# 笺匣

纯 Rust：Axum + Askama SSR 页面，同一个进程跑 Telegram Bot。

**Bot Token 和管理员数字 ID 只在启动时配置，网页里不会出现、也不能改。**

## 配置（三选一）

环境变量（或 `.env`）：

```
JIANXIA_BOT_TOKEN=123456789:AAH...
JIANXIA_ADMIN_ID=你的Telegram数字ID
BETTER_AUTH_SECRET=一串随机密钥
```

或 `jianxia.toml`（可参考 `jianxia.toml.example`）：

```toml
bot_token = "123456789:AAH..."
admin_id = "123456789"
```

或启动参数：

```bash
cargo run --manifest-path app/Cargo.toml -- --token '123:AAH...' --admin-id 123456789
```

优先级：命令行 > 环境变量 > 配置文件。

## 日志

默认就是 `info`。终端里会看到启动、开始收，以及**每一条**从 Telegram 进来的消息。

```bash
# 默认（info 及以上）
cargo run --manifest-path app/Cargo.toml

# 更细
RUST_LOG=jianxia=debug cargo run --manifest-path app/Cargo.toml

# 或
cargo run --manifest-path app/Cargo.toml -- --log info
```

也可用环境变量 `JIANXIA_LOG` / `RUST_LOG`。等级：`error` < `warn` < `info` < `debug`。`info` 及以上时，收到文字、图片、视频、命令都会打一行。

## 启动

```bash
cargo run --manifest-path app/Cargo.toml
```

打开 http://localhost:8080 ，用 Telegram 登录（必须是配置里的那个管理员 ID）。点「开始收」后，关页面也会继续收。
