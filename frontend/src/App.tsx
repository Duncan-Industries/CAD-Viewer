import { useState, useEffect } from "react";

import { Toolbar } from "./components/Toolbar";
import { FileUpload } from "./components/FileUpload";
import { Viewer3D } from "./components/Viewer3D";
import { AssemblyTree } from "./components/AssemblyTree";
import { AnnotationsPanel, MetadataPanel } from "./components/AnnotationsPanel";
import { useCADFile } from "./hooks/useCADFile";
import type { PanelTab, ViewMode } from "./types/cad";

// ---------------------------------------------------------------------------
// Status overlay shown while processing
// ---------------------------------------------------------------------------

function StatusOverlay({ message, isError }: { message: string; isError?: boolean }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-950/80 z-10 pointer-events-none">
      {!isError && (
        <div className="w-10 h-10 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
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

  const isLoading = status === "uploading" || status === "processing";
  const hasFile = cadFile !== null;

  // Backend starting — show a minimal fullscreen loading screen
  if (!backendReady && !backendError) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-slate-950 text-slate-100 gap-4">
        <div className="w-10 h-10 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
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
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm border border-slate-700 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-slate-950 text-slate-100">
      {/* ── Top bar ── */}
      <Toolbar
        viewMode={viewMode}
        onViewMode={setViewMode}
        onReset={reset}
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
              <button
                onClick={reset}
                className="mt-20 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm border border-slate-700 transition-colors pointer-events-auto"
              >
                Try another file
              </button>
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
            <div className="flex flex-col h-full">
              {/* Tab bar */}
              <div className="flex border-b border-slate-800 shrink-0">
                {(
                  [
                    { value: "assembly", label: "Assembly" },
                    { value: "annotations", label: "Notes", count: cadFile.annotations.length },
                    { value: "metadata", label: "Info" },
                  ] as { value: PanelTab; label: string; count?: number }[]
                ).map(({ value, label, count }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setTab(value)}
                    className={`flex-1 flex items-center justify-center gap-0.5 px-2 py-2.5 text-xs font-medium transition-colors border-b-2 cursor-pointer ${
                      tab === value
                        ? "text-blue-400 border-blue-400 bg-slate-800/40"
                        : "text-slate-400 hover:text-slate-200 border-transparent"
                    }`}
                    aria-pressed={tab === value}
                  >
                    {label}
                    {count !== undefined && <Badge count={count} />}
                  </button>
                ))}
              </div>

              {/* Panels */}
              <div className="flex-1 min-h-0">
                {tab === "assembly" && (
                  <AssemblyTree nodes={cadFile.assembly} />
                )}
                {tab === "annotations" && (
                  <AnnotationsPanel annotations={cadFile.annotations} />
                )}
                {tab === "metadata" && (
                  <MetadataPanel metadata={cadFile.metadata} />
                )}
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
