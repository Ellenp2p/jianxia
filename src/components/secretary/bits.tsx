import * as Switch from "@radix-ui/react-switch";
import { cn } from "@/lib/cn";
import type { ButtonHTMLAttributes } from "react";

type ButtonTone = "seal" | "ink" | "sheet" | "ghost";

const tones: Record<ButtonTone, string> = {
  seal: "bg-seal text-seal-ink",
  ink: "bg-ink text-paper",
  sheet: "border border-line bg-sheet text-ink",
  ghost: "text-ink",
};

export function Button({
  tone = "sheet",
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: ButtonTone }) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-4 text-sm font-medium transition-opacity",
        "disabled:cursor-not-allowed disabled:opacity-50",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}

export function Toggle({
  checked,
  onChange,
  labelledBy,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  labelledBy: string;
}) {
  return (
    <Switch.Root
      checked={checked}
      onCheckedChange={onChange}
      aria-labelledby={labelledBy}
      className="relative h-7 w-12 shrink-0 rounded-full bg-line transition-colors data-[state=checked]:bg-seal"
    >
      <Switch.Thumb className="block size-5 translate-x-1 rounded-full bg-sheet transition-transform data-[state=checked]:translate-x-6" />
    </Switch.Root>
  );
}

export function RuleRow({
  id,
  title,
  detail,
  checked,
  onChange,
}: {
  id: string;
  title: string;
  detail: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line py-4">
      <div className="min-w-0">
        <p id={id} className="font-medium">
          {title}
        </p>
        <p className="mt-1 text-sm text-pretty text-muted">{detail}</p>
      </div>
      <Toggle checked={checked} onChange={onChange} labelledBy={id} />
    </div>
  );
}
