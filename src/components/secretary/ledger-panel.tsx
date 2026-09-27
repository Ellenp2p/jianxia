import { formatStamp } from "@/lib/secretary/logic";
import { useSecretary } from "@/lib/secretary/store";
import type { LogLevel } from "@/lib/secretary/types";

const LEVEL: Record<LogLevel, string> = {
  kept: "收下",
  duplicate: "去重",
  skip: "跳过",
  info: "备注",
  error: "出错",
};

export function LedgerPanel() {
  const logs = useSecretary((s) => s.logs);
  return (
    <div>
      <p className="mb-5 max-w-2xl text-sm text-pretty text-muted">
        每一条进来的图片或视频都会留在这里：收下、判定重复，或因为来源和类型被跳过。
      </p>
      {logs.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-line bg-sheet px-6 py-16 text-center">
          <p className="font-serif text-2xl">流水是空的</p>
          <p className="mt-2 text-sm text-muted">跑一轮演练，或开始监听之后，决定会写在这里。</p>
        </div>
      ) : (
        <ol className="divide-y divide-line overflow-hidden rounded-3xl border border-line bg-sheet">
          {logs.map((log) => (
            <li key={log.id} className="flex flex-col gap-1 px-4 py-4 sm:flex-row sm:items-baseline sm:gap-4">
              <time className="shrink-0 text-sm text-muted tabular-nums sm:w-36">{formatStamp(log.at)}</time>
              <span
                className={
                  log.level === "duplicate" || log.level === "error"
                    ? "shrink-0 text-sm text-seal sm:w-12"
                    : "shrink-0 text-sm sm:w-12"
                }
              >
                {LEVEL[log.level]}
              </span>
              <div className="min-w-0 sm:flex-1">
                <p className="font-medium">{log.title}</p>
                <p className="mt-1 text-sm text-pretty text-muted">{log.detail}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
