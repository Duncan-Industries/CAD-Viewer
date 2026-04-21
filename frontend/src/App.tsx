import { useEffect, useRef, useState, type ChangeEvent } from "react";

import { Toolbar } from "./components/Toolbar";
import { FileUpload } from "./components/FileUpload";
import { Viewer3D } from "./components/Viewer3D";
import { SettingsModal } from "./components/SettingsModal";
import { AssemblyTree } from "./components/AssemblyTree";
import { AnnotationsPanel, MetadataPanel } from "./components/AnnotationsPanel";
import { useCADFile } from "./hooks/useCADFile";
import { CAD_FILE_ACCEPT, clearFileInput, openFileInputPicker, pickFirstFile } from "./services/filePicker";
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type AppSettings } from "./services/settings";
import type { PanelTab, ViewMode } from "./types/cad";
import { Button } from "./components/ui/button";
import { Spinner } from "./components/ui/spinner";
import { UiTabs, UiTabsList, UiTabsPanel, UiTabsTrigger } from "./components/ui/tabs";

// ---------------------------------------------------------------------------
// Status overlay shown while processing
// ---------------------------------------------------------------------------

function StatusOverlay({ message, isError }: { message: string; isError?: boolean }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-950/80 z-10 pointer-events-none">
      {!isError && (
        <Spinner size="lg" />
      )}
      {isError && (
        <svg className="w-10 h-10 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
        </svg>
      )}
      <p className={`text-sm font-medium ${isError ? "text-red-400" : "text-slate-300"}`}>
        {message}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel counter badge
// ---------------------------------------------------------------------------

function Badge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-blue-600/30 text-blue-300">
      {count > 99 ? "99+" : count}
    </span>
  );
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export default function App() {
  const { status, cadFile, error, load, reset } = useCADFile();
  const [viewMode, setViewMode] = useState<ViewMode>("solid");
  const [tab, setTab] = useState<PanelTab>("assembly");
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // No Electron IPC (browser/web dev) → skip backend wait
  const hasIpc = !!window.cadviewer?.onSetupProgress;
  const [backendReady, setBackendReady] = useState(!hasIpc);
  const [backendError, setBackendError] = useState<string | null>(null);

  useEffect(() => {
    if (!hasIpc) return;
    // Check if backend already ready before we subscribed
    window.cadviewer!.getBackendStatus().then((s) => {
      if (s === "ready") setBackendReady(true);
      else if (s === "error") setBackendError("Backend failed to start. Please restart the app.");
    });
    const off = window.cadviewer!.onSetupProgress((ev) => {
      if (ev.stage === "backend" && ev.percent === 100 && ev.message === "ready") {
        setBackendReady(true);
      } else if (ev.stage === "backend" && ev.percent === 0 && ev.message !== "") {
        setBackendError(ev.message);
      }
    });
    return off;
  }, [hasIpc]);

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  useEffect(() => {
    if (!cadFile) return;
    setTab(settings.defaultPanelTab);
  }, [cadFile, settings.defaultPanelTab]);

  const isLoading = status === "uploading" || status === "processing";
  const hasFile = cadFile !== null;

  const handlePickerChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = pickFirstFile(e.target.files);
    if (!file || isLoading) return;
    load(file);
    clearFileInput(e.target);
  };

  const openFilePicker = () => {
    if (isLoading) return;
    if (settings.confirmBeforeOpen && hasFile) {
      const proceed = window.confirm("Open a new file and clear the current model?");
      if (!proceed) return;
    }
    reset();
    openFileInputPicker(inputRef.current);
  };

  useEffect(() => {
    if (!settings.keyboardShortcuts) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        openFilePicker();
      } else if (e.ctrlKey && e.key === ",") {
        e.preventDefault();
        setSettingsOpen(true);
      } else if (e.key === "Escape") {
        setSettingsOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [settings.keyboardShortcuts, openFilePicker]);

  // Backend starting — show a minimal fullscreen loading screen
  if (!backendReady && !backendError) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-slate-950 text-slate-100 gap-4">
        <Spinner size="lg" />
        <p className="text-sm text-slate-400">Starting up…</p>
      </div>
    );
  }

  // Backend failed
  if (backendError) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-slate-950 text-slate-100 gap-4 p-8">
        <svg className="w-10 h-10 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
        </svg>
        <p className="text-sm font-medium text-red-400">Failed to start</p>
        <pre className="text-xs text-slate-400 bg-slate-900 rounded-lg p-4 max-w-lg w-full overflow-auto whitespace-pre-wrap">{backendError}</pre>
        <Button
          onClick={() => window.location.reload()}
          variant="secondary"
          size="lg"
        >
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-slate-950 text-slate-100">
      <input
        ref={inputRef}
        type="file"
        accept={CAD_FILE_ACCEPT}
        className="sr-only"
        onChange={handlePickerChange}
      />

      {/* ── Top bar ── */}
      <Toolbar
        viewMode={viewMode}
        onViewMode={setViewMode}
        onOpenFile={openFilePicker}
        activeTab={tab}
        onNavigate={setTab}
        onOpenSettings={() => setSettingsOpen(true)}
        hasFile={hasFile}
        filename={cadFile?.metadata.filename ?? null}
      />

      {/* ── Main area ── */}
      <div className="flex flex-1 min-h-0">

        {/* ── 3D Viewport ── */}
        <main className="relative flex-1 min-w-0">
          {!hasFile && !isLoading && (
            <div className="absolute inset-0 flex items-center justify-center p-12">
              <div className="w-full max-w-md">
                <FileUpload onFile={load} disabled={isLoading} />
              </div>
            </div>
          )}

          {isLoading && (
            <StatusOverlay
              message={status === "uploading" ? "Uploading…" : "Processing CAD file…"}
            />
          )}

          {status === "error" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-8">
              <StatusOverlay message={error ?? "Processing failed"} isError />
              <Button
                onClick={reset}
                className="mt-20 pointer-events-auto"
                variant="secondary"
                size="lg"
              >
                Try another file
              </Button>
            </div>
          )}

          <Viewer3D
            modelUrl={cadFile ? cadFile.gltf_url : null}
            viewMode={viewMode}
          />
        </main>

        {/* ── Right panel (only when file is loaded) ── */}
        {hasFile && (
          <aside className="w-72 shrink-0 flex flex-col border-l border-slate-800 bg-slate-900">
            <UiTabs
              value={tab}
              onValueChange={(value) => setTab(value as PanelTab)}
              className="flex flex-col h-full"
            >
              <UiTabsList>
                <UiTabsTrigger value="assembly">Assembly</UiTabsTrigger>
                <UiTabsTrigger value="annotations">
                  Notes
                  <Badge count={cadFile.annotations.length} />
                </UiTabsTrigger>
                <UiTabsTrigger value="metadata">Info</UiTabsTrigger>
              </UiTabsList>

              <UiTabsPanel value="assembly" className="flex-1 min-h-0">
                <AssemblyTree nodes={cadFile.assembly} />
              </UiTabsPanel>
              <UiTabsPanel value="annotations" className="flex-1 min-h-0">
                <AnnotationsPanel annotations={cadFile.annotations} />
              </UiTabsPanel>
              <UiTabsPanel value="metadata" className="flex-1 min-h-0">
                <MetadataPanel metadata={cadFile.metadata} />
              </UiTabsPanel>
            </UiTabs>
          </aside>
        )}
      </div>

      {settings.showStatusBar && (
        <footer className="flex items-center justify-between border-t border-slate-800 bg-slate-900 px-3 py-1.5 text-xs text-slate-400">
          <span>
            {cadFile ? `Loaded: ${cadFile.metadata.filename}` : "No file loaded"}
          </span>
          <span>
            Ctrl+O Open file · Ctrl+, Settings
          </span>
        </footer>
      )}

      <SettingsModal
        open={settingsOpen}
        settings={settings}
        onChange={setSettings}
        onClose={() => setSettingsOpen(false)}
        onReset={() => setSettings(DEFAULT_SETTINGS)}
      />
    </div>
  );
}
