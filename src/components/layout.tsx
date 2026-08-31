import { Link, useRouterState } from "@tanstack/react-router";
import { Calendar, FileText, Radio, ScrollText, Terminal } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Board", icon: Radio },
  { to: "/feed", label: "Feed", icon: Calendar },
  { to: "/command", label: "Command", icon: Terminal },
  { to: "/log", label: "Log", icon: ScrollText },
  { to: "/notes", label: "Notes", icon: FileText },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="min-h-dvh bg-bg text-fg">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-56 flex-col border-r border-border bg-bg px-4 py-6 md:flex">
        <Brand />
        <nav className="mt-10 flex flex-col gap-1">
          {NAV.map((item) => (
            <NavLink key={item.to} {...item} active={pathname === item.to} />
          ))}
        </nav>
        <p className="mt-auto text-xs leading-relaxed text-subtle">
          Calendar notes become YouTube Live. Live Shows air in Asia/Qatar. Covers follow the programme.
        </p>
      </aside>

      <div className="md:pl-56">
        <header className="flex items-center justify-between border-b border-border px-4 py-3 md:hidden">
          <Brand compact />
        </header>
        <main className="mx-auto w-full max-w-6xl px-4 py-6 pb-28 md:px-8 md:py-8 md:pb-12">
          {children}
        </main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-bg/95 backdrop-blur md:hidden">
        <ul className="grid grid-cols-5 px-1 pb-[env(safe-area-inset-bottom)]">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.to;
            return (
              <li key={item.to}>
                <Link
                  to={item.to}
                  className={cn(
                    "flex min-h-14 flex-col items-center justify-center gap-1 text-[11px] font-medium",
                    active ? "text-fg" : "text-subtle",
                  )}
                >
                  <Icon className={cn("size-5", active && "text-accent")} />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link to="/" className="flex items-center gap-2.5">
      <img
        src="/brand/channel.jpg"
        alt="Radio Bahrain"
        className="size-7 rounded-sm object-cover outline outline-1 -outline-offset-1 outline-fg/15"
      />
      <span className="font-display text-lg font-semibold tracking-tight">Cuecast</span>
      {!compact && (
        <span className="ml-1 hidden text-[10px] tracking-[0.18em] text-subtle uppercase lg:inline">
          Radio Bahrain
        </span>
      )}
    </Link>
  );
}

function NavLink({
  to,
  label,
  icon: Icon,
  active,
}: {
  to: "/" | "/feed" | "/command" | "/log" | "/notes";
  label: string;
  icon: typeof Radio;
  active: boolean;
}) {
  return (
    <Link
      to={to}
      className={cn(
        "flex h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors",
        active ? "bg-elevated text-fg" : "text-muted hover:bg-elevated/60 hover:text-fg",
      )}
    >
      <Icon className={cn("size-4", active ? "text-accent" : "text-subtle")} />
      {label}
    </Link>
  );
}
