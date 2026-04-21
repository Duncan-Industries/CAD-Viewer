import type { PanelTab } from "../types/cad";

export interface AppSettings {
  defaultPanelTab: PanelTab;
  confirmBeforeOpen: boolean;
  keyboardShortcuts: boolean;
  showStatusBar: boolean;
}

const SETTINGS_KEY = "cadviewer:settings";

export const DEFAULT_SETTINGS: AppSettings = {
  defaultPanelTab: "assembly",
  confirmBeforeOpen: false,
  keyboardShortcuts: true,
  showStatusBar: true,
};

export function loadSettings(): AppSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      defaultPanelTab: parsed.defaultPanelTab ?? DEFAULT_SETTINGS.defaultPanelTab,
      confirmBeforeOpen: parsed.confirmBeforeOpen ?? DEFAULT_SETTINGS.confirmBeforeOpen,
      keyboardShortcuts: parsed.keyboardShortcuts ?? DEFAULT_SETTINGS.keyboardShortcuts,
      showStatusBar: parsed.showStatusBar ?? DEFAULT_SETTINGS.showStatusBar,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: AppSettings): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
