import type { AppSettings } from "../services/settings";
import type { PanelTab } from "../types/cad";
import { Button } from "./ui/button";

interface SettingsModalProps {
  open: boolean;
  settings: AppSettings;
  onChange: (next: AppSettings) => void;
  onClose: () => void;
  onReset: () => void;
}

export function SettingsModal({
  open,
  settings,
  onChange,
  onClose,
  onReset,
}: SettingsModalProps) {
  if (!open) return null;

  const setTab = (value: string) => {
    onChange({
      ...settings,
      defaultPanelTab: value as PanelTab,
    });
  };

  const setFlag = (key: keyof Omit<AppSettings, "defaultPanelTab">, value: boolean) => {
    onChange({
      ...settings,
      [key]: value,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
      <div className="w-full max-w-lg rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3">
          <h2 className="text-sm font-semibold text-slate-100">Settings</h2>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-300">Default right panel tab</span>
            <select
              value={settings.defaultPanelTab}
              onChange={(e) => setTab(e.target.value)}
              className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <option value="assembly">Assembly</option>
              <option value="annotations">Notes</option>
              <option value="metadata">Info</option>
            </select>
          </label>

          <label className="flex items-center justify-between rounded-md border border-slate-800 bg-slate-950/40 px-3 py-2">
            <span className="text-sm text-slate-200">Enable keyboard shortcuts</span>
            <input
              type="checkbox"
              checked={settings.keyboardShortcuts}
              onChange={(e) => setFlag("keyboardShortcuts", e.target.checked)}
            />
          </label>

          <label className="flex items-center justify-between rounded-md border border-slate-800 bg-slate-950/40 px-3 py-2">
            <span className="text-sm text-slate-200">Ask before opening another file</span>
            <input
              type="checkbox"
              checked={settings.confirmBeforeOpen}
              onChange={(e) => setFlag("confirmBeforeOpen", e.target.checked)}
            />
          </label>

          <label className="flex items-center justify-between rounded-md border border-slate-800 bg-slate-950/40 px-3 py-2">
            <span className="text-sm text-slate-200">Show status bar</span>
            <input
              type="checkbox"
              checked={settings.showStatusBar}
              onChange={(e) => setFlag("showStatusBar", e.target.checked)}
            />
          </label>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-800 px-5 py-3">
          <Button variant="outline" size="sm" onClick={onReset}>
            Reset defaults
          </Button>
          <Button variant="primary" size="sm" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}
