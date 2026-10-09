import { cn } from "@/lib/utils";

/** The Scholario crest — a small shield monogram. */
export function Crest({ className, letter = "S" }: { className?: string; letter?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "crest-grad relative flex items-center justify-center rounded-[28%] text-white shadow-sm",
        className,
      )}
    >
      <svg viewBox="0 0 24 24" className="absolute inset-0 h-full w-full opacity-20" fill="none">
        <path d="M12 2L21 5.5V12c0 4.5-3.8 8.4-9 10-5.2-1.6-9-5.5-9-10V5.5L12 2z" stroke="currentColor" strokeWidth="1.2" />
        <path d="M12 2L21 5.5V12c0 4.5-3.8 8.4-9 10-5.2-1.6-9-5.5-9-10V5.5L12 2z" fill="currentColor" opacity="0.12" />
      </svg>
      <span className="font-display relative font-semibold leading-none tracking-tight">{letter}</span>
    </div>
  );
}

/** School wordmark used in headers. */
export function Wordmark({ short, className }: { short: string; className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <Crest className="h-8 w-8 text-[13px]" letter={short.slice(0, 1).toUpperCase()} />
      <div className="leading-tight">
        <div className="font-display text-[15px] font-semibold tracking-tight">{short}</div>
        <div className="text-[11px] text-muted-foreground">School OS</div>
      </div>
    </div>
  );
}
