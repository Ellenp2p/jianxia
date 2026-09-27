import { useState } from "react";
import { Button, RuleRow } from "@/components/secretary/bits";
import { checkBot, resolveSource, uid } from "@/lib/secretary/live";
import { DEFAULT_SETTINGS } from "@/lib/secretary/logic";
import { useSecretary } from "@/lib/secretary/store";

export function RulesPanel() {
  const settings = useSecretary((s) => s.settings);
  const tokenOnFile = useSecretary((s) => s.tokenOnFile);
  const botUsername = useSecretary((s) => s.botUsername);
  const botName = useSecretary((s) => s.botName);
  const updateOffset = useSecretary((s) => s.updateOffset);
  const patch = useSecretary((s) => s.patchSettings);
  const [draft, setDraft] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [checking, setChecking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);

  async function onCheck() {
    setChecking(true);
    setNotice(null);
    try {
      await checkBot();
      setNotice("连接成功。把机器人加进要收的频道，并设成管理员。");
    } catch (error) {
      const message = error instanceof Error ? error.message : "连接失败";
      setNotice(message);
      useSecretary.setState({ lastError: message });
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <p className="mb-6 text-sm text-pretty text-muted">
        指定频道，或自动收下新的私聊。记录按登录的人分开，锁在服务器上，正文是密文。Token 不会再发回这个浏览器。
      </p>

      <section className="rounded-3xl border border-line bg-sheet px-5">
        <SectionTitle index="壹" title="机器人" />
        <label className="block pb-2 text-sm" htmlFor="bot-token">
          Bot Token
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="bot-token"
            type={showToken ? "text" : "password"}
            autoComplete="off"
            spellCheck={false}
            value={settings.token}
            onChange={(event) => patch({ token: event.target.value })}
            placeholder={tokenOnFile ? "已锁在服务器，留空表示不更换" : "123456789:AAH..."}
            className="h-11 min-w-0 flex-1 rounded-2xl border border-line bg-paper px-3 text-sm outline-none focus:border-ink"
          />
          <Button onClick={() => setShowToken((v) => !v)}>{showToken ? "隐藏" : "显示"}</Button>
        </div>
        <div className="flex flex-wrap items-center gap-2 py-4">
          <Button tone="ink" onClick={() => void onCheck()} disabled={checking}>
            {checking ? "正在核对" : "测试连接"}
          </Button>
          {botUsername && (
            <span className="text-sm text-muted">
              已连接 {botName} · @{botUsername}
            </span>
          )}
        </div>
        {notice && <p className="pb-4 text-sm text-pretty text-muted">{notice}</p>}
        <ol className="space-y-2 border-t border-line py-4 text-sm text-pretty text-muted">
          <li>1. 在 Telegram 找 @BotFather，发送 /newbot，复制 Token 贴到上面。</li>
          <li>2. 频道要收的话，把机器人加为管理员，再把 @用户名 填进来源。</li>
          <li>3. 新的私聊打开后，别人直接把图片或视频发给机器人就会入档。</li>
          <li>4. 预览里点「开始监听」，这个页面开着才会拉。部署到正式站点后点「交给服务器」，关掉页面也会记。</li>
          <li>5. 私聊机器人发「我的id」，把数字填到下面。没填、或不是这个数字，私聊命令不回任何档案。</li>
        </ol>
      </section>

      <section className="mt-4 rounded-3xl border border-line bg-sheet px-5">
        <SectionTitle index="贰" title="收什么" />
        <RuleRow
          id="rule-flash"
          title="闪照"
          detail="阅后即焚，以及要点开才看得见的遮罩图。打开后，就算关掉普通图片，闪照仍会写进人物历史。"
          checked={settings.flashes}
          onChange={(flashes) => patch({ flashes })}
        />
        <RuleRow
          id="rule-photos"
          title="图片"
          detail="普通照片。同一张被转发时，用文件指纹认出来。"
          checked={settings.photos}
          onChange={(photos) => patch({ photos })}
        />
        <RuleRow
          id="rule-videos"
          title="视频"
          detail="视频和视频留言。预览用封面，原件可在档案里再取。"
          checked={settings.videos}
          onChange={(videos) => patch({ videos })}
        />
        <RuleRow
          id="rule-docs"
          title="文件里的图片和视频"
          detail="有人用「文件」而不是「照片」发来时也收下。"
          checked={settings.documents}
          onChange={(documents) => patch({ documents })}
        />
        <RuleRow
          id="rule-anim"
          title="动图"
          detail="GIF 和动画贴纸以外的 animation 消息。默认关掉。"
          checked={settings.animations}
          onChange={(animations) => patch({ animations })}
        />
      </section>

      <section className="mt-4 rounded-3xl border border-line bg-sheet px-5">
        <SectionTitle index="叁" title="从哪里收" />
        <RuleRow
          id="rule-private"
          title="新的私聊"
          detail="第一次给你的机器人发图片或视频的人，会自动记下来并继续收。"
          checked={settings.watchNewPrivate}
          onChange={(watchNewPrivate) => patch({ watchNewPrivate })}
        />
        <RuleRow
          id="rule-groups"
          title="新的群"
          detail="机器人新加入的群。频道不会自动收，必须写进来源。"
          checked={settings.watchNewGroups}
          onChange={(watchNewGroups) => patch({ watchNewGroups })}
        />
        <ul className="mt-2 divide-y divide-line">
          {settings.sources.map((src) => (
            <li key={src.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{src.resolvedTitle || src.query}</p>
                <p className="truncate text-sm text-muted">
                  {src.query}
                  {src.resolvedId ? ` · ${src.resolvedId}` : ""}
                  {src.status === "ok" ? " · 已核对" : ""}
                </p>
                {src.error && <p className="mt-1 text-sm text-pretty text-seal">{src.error}</p>}
              </div>
              <div className="flex gap-2">
                <Button onClick={() => void resolveSource(src.id)}>核对</Button>
                <Button onClick={() => useSecretary.getState().removeSource(src.id)}>移除</Button>
              </div>
            </li>
          ))}
        </ul>
        <form
          className="flex flex-col gap-2 py-4 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            useSecretary.getState().addSource(draft);
            setDraft("");
          }}
        >
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="@频道用户名 或聊天编号"
            className="h-11 min-w-0 flex-1 rounded-2xl border border-line bg-paper px-3 text-sm outline-none focus:border-ink"
          />
          <Button tone="ink" type="submit">
            添加来源
          </Button>
        </form>
      </section>

      <section className="mt-4 rounded-3xl border border-line bg-sheet px-5">
        <SectionTitle index="肆" title="去重" />
        <div className="border-b border-line py-4">
          <p className="font-medium">文件指纹</p>
          <p className="mt-1 text-sm text-pretty text-muted">
            始终打开。Telegram 的 file_unique_id 相同，就视为同一个文件，只留第一份。
          </p>
        </div>
        <RuleRow
          id="rule-visual"
          title="画面近似"
          detail="缩略图做成感知指纹。压缩后再发一次，也能认出来。"
          checked={settings.visualDedupe}
          onChange={(visualDedupe) => patch({ visualDedupe })}
        />
        <div className="py-4">
          <p className="text-sm text-muted">近似有多松</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {[
              { n: 4, label: "严格" },
              { n: 8, label: "标准" },
              { n: 12, label: "宽松" },
            ].map((item) => (
              <button
                key={item.n}
                type="button"
                disabled={!settings.visualDedupe}
                onClick={() => patch({ visualThreshold: item.n })}
                className={
                  settings.visualThreshold === item.n
                    ? "min-h-11 rounded-full bg-ink px-4 text-sm text-paper disabled:opacity-50"
                    : "min-h-11 rounded-full border border-line px-4 text-sm disabled:opacity-50"
                }
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="mt-4 rounded-3xl border border-line bg-sheet px-5">
        <SectionTitle index="伍" title="管理员命令" />
        <label className="block pb-2 text-sm" htmlFor="admin-id">
          你的隐藏 ID
        </label>
        <input
          id="admin-id"
          inputMode="numeric"
          value={settings.adminId ?? ""}
          onChange={(event) => patch({ adminId: event.target.value.replace(/[^\d]/g, "").slice(0, 16) })}
          placeholder="私聊机器人发「我的id」得到的数字"
          className="mb-3 h-11 w-full rounded-2xl border border-line bg-paper px-3 text-sm outline-none focus:border-ink"
        />
        <div className="space-y-2 pb-5 text-sm text-pretty text-muted">
          <p>网页必须用 Telegram 登录，而且登录的数字 ID 要和这里一样，才会返回档案。别的号只看到「不是管理员」。</p>
          <p>人 私聊 昨天</p>
          <p>历史 群 本月 闪照</p>
          <p>也可以写谁、记录、查看，频道、今天、近7天，或加上名字和页2。英文 /people、/history 同样认。</p>
        </div>
      </section>

      <section className="mt-4 rounded-3xl border border-line bg-sheet px-5 py-4">
        <p className="text-sm text-muted">
          已确认到更新 #{updateOffset || 0}。Telegram 只保留大约一天的未读更新。
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={() => useSecretary.getState().setOffset(0)}>重置拉取位置</Button>
          <Button
            onClick={() => {
              useSecretary.setState({
                settings: { ...DEFAULT_SETTINGS, token: settings.token, adminId: settings.adminId ?? "" },
              });
              useSecretary.getState().addLog({
                id: uid("log"),
                at: Date.now(),
                level: "info",
                title: "规则已恢复默认",
                detail: "Token 还在。来源回到演练用的三个频道。",
                chatTitle: "",
              });
            }}
          >
            恢复默认规则
          </Button>
          <Button
            tone="seal"
            onClick={() => {
              if (!armed) {
                setArmed(true);
                window.setTimeout(() => setArmed(false), 4000);
                return;
              }
              useSecretary.getState().clearRecords();
              setArmed(false);
            }}
          >
            {armed ? "确认清空档案" : "清空档案和流水"}
          </Button>
        </div>
      </section>
    </div>
  );
}

function SectionTitle({ index, title }: { index: string; title: string }) {
  return (
    <h3 className="flex items-baseline gap-3 pt-5 pb-2">
      <span className="font-serif text-seal">{index}</span>
      <span className="font-serif text-2xl">{title}</span>
    </h3>
  );
}
