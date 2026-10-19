"use client";

import { useNav, type Screen } from "@/lib/store/nav";
import { cn } from "@/lib/utils";
import { Home, Plus, History, PiggyBank, Settings } from "lucide-react";

const items: { screen: Screen; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { screen: "home", label: "Home", icon: Home },
  { screen: "savings", label: "Savings", icon: PiggyBank },
  { screen: "quick-add", label: "Add", icon: Plus },
  { screen: "period-history", label: "History", icon: History },
  { screen: "settings", label: "Settings", icon: Settings },
];

export function BottomNav() {
  const { screen, go } = useNav();
  return (
    <nav className="sticky bottom-0 z-30 mt-auto border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom,0px)] backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex max-w-md items-stretch justify-around">
        {items.map(({ screen: target, label, icon: Icon }) => {
          const active = screen === target;
          const isAdd = target === "quick-add";
          return (
            <button
              key={target}
              type="button"
              onClick={() => go(target)}
              className={cn(
                "relative flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-xs",
                active ? "text-foreground" : "text-muted-foreground"
              )}
              aria-label={label}
              aria-pressed={active}
            >
              {isAdd ? (
                <span className="-mt-3 flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md">
                  <Icon className="h-5 w-5" />
                </span>
              ) : (
                <Icon className="h-5 w-5" />
              )}
              <span className={cn("text-[10px]", isAdd && "sr-only")}>{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
