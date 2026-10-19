"use client";

import { useEffect, useRef } from "react";
import { useAppData } from "@/hooks/expense-tracker/useAppData";
import { useNav } from "@/lib/store/nav";
import { Onboarding } from "./screens/Onboarding";
import { Home } from "./screens/Home";
import { QuickAddExpense } from "./screens/QuickAddExpense";
import { ConfirmPeriod } from "./screens/ConfirmPeriod";
import { Savings } from "./screens/Savings";
import { PeriodHistory } from "./screens/PeriodHistory";
import { SettingsScreen } from "./screens/Settings";
import { BottomNav } from "./shared/BottomNav";
import { registerServiceWorker, attachInstallPrompt, navigatorStoragePersist } from "@/lib/budget/persistence";
import { Toaster } from "@/components/ui/sonner";
import { Loader2 } from "lucide-react";

export function App() {
  const data = useAppData();
  const { screen, go } = useNav();
  const routedRef = useRef(false);

  useEffect(() => {
    void navigatorStoragePersist();
    void registerServiceWorker();
    const cleanup = attachInstallPrompt();
    return () => cleanup();
  }, []);

  useEffect(() => {
    if (!data.ready || data.needsOnboarding) return;
    // Default-routing logic: if no active period and there's a pending one,
    // route the user to confirmation on first load.
    if (routedRef.current) return;
    if (!data.activePeriod && data.pendingPeriods.length > 0 && screen === "home") {
      routedRef.current = true;
      go("confirm-period", { start: data.pendingPeriods[0].start_date });
    }
  }, [data.ready, data.needsOnboarding, data.activePeriod, data.pendingPeriods, screen, go]);

  if (!data.ready) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (data.needsOnboarding) {
    return (
      <>
        <Onboarding onComplete={() => void data.refresh()} />
        <Toaster richColors position="top-center" />
      </>
    );
  }

  // Render the active screen.
  let content: React.ReactNode = null;
  const showNav = screen !== "quick-add" && screen !== "confirm-period" && screen !== "onboarding";

  switch (screen) {
    case "onboarding":
      content = <Onboarding onComplete={() => void data.refresh()} />;
      break;
    case "home":
      content = <Home data={data} />;
      break;
    case "quick-add":
      content = <QuickAddExpense data={data} />;
      break;
    case "confirm-period":
      content = <ConfirmPeriod data={data} />;
      break;
    case "savings":
      content = <Savings data={data} />;
      break;
    case "period-history":
      content = <PeriodHistory data={data} />;
      break;
    case "settings":
      content = <SettingsScreen data={data} />;
      break;
    default:
      content = <Home data={data} />;
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <div className="flex flex-1 flex-col">{content}</div>
      {showNav && <BottomNav />}
      <Toaster richColors position="top-center" />
    </div>
  );
}
