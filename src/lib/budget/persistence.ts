// Storage persistence helpers — ask the browser to keep our data, prompt for
// PWA install, and track the last-export date for backup nudges.

import { getSettings, putSettings } from "../db/db";
import { nowTimestamp } from "./dates";

// Ask for persistent storage. This is best-effort: Chrome/Edge typically grant
// it when the PWA is installed, while Firefox may prompt the user.
export async function navigatorStoragePersist(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.storage || !navigator.storage.persist) {
    return false;
  }
  try {
    const persisted = await navigator.storage.persist();
    return persisted;
  } catch {
    return false;
  }
}

export async function isStoragePersisted(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.storage || !navigator.storage.persisted) {
    return false;
  }
  try {
    return await navigator.storage.persisted();
  } catch {
    return false;
  }
}

// Hook the install prompt event so we can surface the install button when
// the user is in flow. We keep this in a module-level variable to allow the
// Settings screen to read it without reattaching the listener.
let deferredPrompt: BeforeInstallPromptEvent | null = null;

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  prompt: () => Promise<void>;
}

export function attachInstallPrompt(): (() => void) {
  const onBeforeInstall = (e: Event) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
  };
  const onInstalled = () => {
    deferredPrompt = null;
  };
  window.addEventListener("beforeinstallprompt", onBeforeInstall as EventListener);
  window.addEventListener("appinstalled", onInstalled);
  return () => {
    window.removeEventListener("beforeinstallprompt", onBeforeInstall as EventListener);
    window.removeEventListener("appinstalled", onInstalled);
  };
}

export function getDeferredPrompt(): BeforeInstallPromptEvent | null {
  return deferredPrompt;
}

export async function triggerInstallPrompt(): Promise<"accepted" | "dismissed" | "unavailable"> {
  const p = deferredPrompt;
  if (!p) return "unavailable";
  await p.prompt();
  const choice = await p.userChoice;
  deferredPrompt = null;
  return choice.outcome;
}

// Track when the user last exported their data, for backup nudges.
export async function markExportedAt(): Promise<void> {
  const settings = await getSettings();
  if (!settings) return;
  await putSettings({ ...settings, last_exported_at: nowTimestamp() });
}

// Days since last export (null = never exported).
export function daysSinceExport(lastExportedAt: string | null): number | null {
  if (!lastExportedAt) return null;
  const ts = Date.parse(lastExportedAt);
  if (isNaN(ts)) return null;
  return Math.max(0, Math.floor((Date.now() - ts) / 86400000));
}

// Register the service worker. No-op in unsupported environments.
export async function registerServiceWorker(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("/sw.js");
  } catch {
    // Silent — offline support is best-effort.
  }
}
