import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { Archive, Cpu, Download, LayoutDashboard, Plus, Server, Settings } from "lucide-react";
import { useEffect } from "react";
import { cn } from "@/lib/utils";
import { useCraft } from "@/lib/mc/store";

const NAV = [
  { to: "/", label: "Home", icon: LayoutDashboard },
  { to: "/create", label: "Install", icon: Plus },
  { to: "/servers", label: "Servers", icon: Server },
  { to: "/downloads", label: "Downloads", icon: Download },
  { to: "/java", label: "Java", icon: Cpu },
  { to: "/backups", label: "Backups", icon: Archive },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

export function Shell() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const theme = useCraft((s) => s.theme);

  useEffect(() => {
    if (!useCraft.persist.hasHydrated()) void useCraft.persist.rehydrate();
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <div className="min-h-screen md:grid md:grid-cols-[232px_1fr]">
      <aside className="border-b border-border md:min-h-screen md:border-b-0 md:border-r">
        <div className="flex items-center justify-between px-4 py-4 md:block md:px-5 md:pt-6">
          <Link to="/" className="flex items-center gap-3">
            <img src="/mark.jpg" alt="" className="size-9 rounded-md object-cover" />
            <span>
              <span className="block text-sm font-medium tracking-tight">CraftServer</span>
              <span className="block text-xs text-muted">One-click servers</span>
            </span>
          </Link>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:mt-4 md:block md:px-3 md:pb-8">
          {NAV.map((item) => {
            const active = item.to === "/" ? pathname === "/" : pathname === item.to || pathname.startsWith(`${item.to}/`);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex h-11 shrink-0 items-center gap-2 rounded-md px-3 text-sm transition-colors duration-150",
                  active ? "bg-secondary text-foreground" : "text-muted hover:bg-secondary hover:text-foreground",
                )}
              >
                <Icon className="size-4" aria-hidden />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>
      <main className="min-w-0 px-4 py-6 md:px-10 md:py-10">
        <Outlet />
      </main>
    </div>
  );
}
