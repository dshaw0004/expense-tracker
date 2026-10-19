// App navigation state. The whole app is a single route; we use a UI state
// machine for screens. Settings keeps an explicit "needsOnboarding" flag.

import { create } from "zustand";

export type Screen =
  | "home"
  | "onboarding"
  | "quick-add"
  | "confirm-period"
  | "borrow"
  | "period-history"
  | "savings"
  | "settings"
  | "category-edit";

interface NavState {
  screen: Screen;
  previousScreen: Screen;
  // Optional payload for the current screen (e.g. which period to confirm).
  payload: Record<string, unknown> | null;
  go: (screen: Screen, payload?: Record<string, unknown>) => void;
  back: () => void;
}

export const useNav = create<NavState>((set, get) => ({
  screen: "home",
  previousScreen: "home",
  payload: null,
  go: (screen, payload) => set({ previousScreen: get().screen, screen, payload: payload ?? null }),
  back: () => set({ previousScreen: get().screen, screen: get().previousScreen, payload: null }),
}));

// Reset to home on first load.
export function resetNav(): void {
  useNav.setState({ screen: "home", previousScreen: "home", payload: null });
}
