# 笺匣

Telegram 私人归档。网页用 Telegram 登录，只有填进去的管理员数字 ID 能看到档案。别人打开页面，或者在机器人里查，都不会拿到记录。

## 本地

需要 Node.js 22。

```bash
npm install
npm run dev
```

Bot Token 只在网页里填写，不要写进这个仓库。

## 长期挂着

把仓库部署到带 https 的站点，数据库用 Postgres（例如 Neon）。加密密钥放在环境变量 `BETTER_AUTH_SECRET`，也不要提交。

页面开着时由网页去听。页面关掉还要继续收，在规则里交给服务器。站点必须是公网 https，Telegram 才能把消息推过来。

登录不用 `/setdomain`。用「打开 Telegram 登录」，到机器人私聊里确认。对上管理员数字 ID 才进笺匣。
