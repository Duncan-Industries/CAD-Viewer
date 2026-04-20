import { useEffect, useReducer, useRef } from "react";
import type { CADViewerBridge } from "../types/cad";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Stage =
  | "checking"
  | "ready"           // Python found, starting backend
  | "backend_starting"
  | "backend_ready"
  | "needs_download"  // Python not found, must download zip first
  | "needs_install"   // Zip already bundled/downloaded, just need to install deps
  | "downloading"
  | "download_done"
  | "installing"
  | "install_done"
  | "error";

interface State {
  stage: Stage;
  message: string;
  percent: number;
  errorDetail: string | null;
  pythonVersion: string | null;
  installerPath: string | null;
}

type Action =
  | { type: "SET_STAGE"; stage: Stage; message?: string }
  | { type: "SET_PROGRESS"; percent: number; message: string }
  | { type: "SET_ERROR"; detail: string }
  | { type: "SET_PYTHON_VERSION"; version: string }
  | { type: "SET_INSTALLER_PATH"; path: string };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "SET_STAGE":
      return { ...state, stage: action.stage, message: action.message ?? state.message };
    case "SET_PROGRESS":
      return { ...state, percent: action.percent, message: action.message };
    case "SET_ERROR":
      return { ...state, stage: "error", errorDetail: action.detail };
    case "SET_PYTHON_VERSION":
      return { ...state, pythonVersion: action.version };
    case "SET_INSTALLER_PATH":
      return { ...state, installerPath: action.path };
    default:
      return state;
  }
}

const INITIAL: State = {
  stage: "checking",
  message: "Checking for Python…",
  percent: 0,
  errorDetail: null,
  pythonVersion: null,
  installerPath: null,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const api = window.cadviewer as Required<CADViewerBridge>;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  onReady: () => void;
}

export function PythonSetup({ onReady }: Props) {
  const [state, dispatch] = useReducer(reducer, INITIAL);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  // Subscribe to progress events from main process
  useEffect(() => {
    if (!api?.onSetupProgress) return;
    const unsub = api.onSetupProgress(({ stage, percent, message }) => {
      dispatch({ type: "SET_PROGRESS", percent, message });
      if (stage === "backend" && percent === 100) {
        dispatch({ type: "SET_STAGE", stage: "backend_ready" });
        setTimeout(() => onReadyRef.current(), 600);
      }
    });
    return unsub;
  }, []);

  // Auto-check Python on mount
  useEffect(() => {
    checkPython();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function checkPython() {
    dispatch({ type: "SET_STAGE", stage: "checking", message: "Checking for Python…" });
    try {
      const result = await api.checkPython();
      if (result.found && result.version) {
        dispatch({ type: "SET_PYTHON_VERSION", version: result.version });
        dispatch({ type: "SET_STAGE", stage: "ready", message: `Found ${result.version}` });
        await startBackend();
      } else if (result.bundled) {
        // Zip is shipped in the installer — skip download, go straight to install
        dispatch({ type: "SET_STAGE", stage: "needs_install", message: "Python runtime is bundled. Ready to set up." });
      } else {
        dispatch({ type: "SET_STAGE", stage: "needs_download", message: "Python 3 not found on this system." });
      }
    } catch (e) {
      dispatch({ type: "SET_ERROR", detail: String(e) });
    }
  }

  async function startBackend() {
    dispatch({ type: "SET_STAGE", stage: "backend_starting", message: "Starting backend…" });
    try {
      const result = await api.startBackend();
      if (result.ok) {
        dispatch({ type: "SET_STAGE", stage: "backend_ready", message: "Backend ready!" });
        setTimeout(() => onReadyRef.current(), 600);
      } else {
        dispatch({ type: "SET_ERROR", detail: result.reason ?? "Backend failed to start." });
      }
    } catch (e) {
      dispatch({ type: "SET_ERROR", detail: String(e) });
    }
  }

  async function handleDownload() {
    dispatch({ type: "SET_STAGE", stage: "downloading", message: "Starting download…" });
    try {
      const zipPath = await api.downloadPython();
      dispatch({ type: "SET_INSTALLER_PATH", path: zipPath });
      dispatch({ type: "SET_STAGE", stage: "download_done", message: "Download complete." });
    } catch (e) {
      dispatch({ type: "SET_ERROR", detail: String(e) });
    }
  }

  async function handleInstall(zipPath?: string | null) {
    dispatch({ type: "SET_STAGE", stage: "installing", message: "Setting up Python environment…" });
    try {
      await api.installPython(zipPath ?? state.installerPath ?? "");
      dispatch({ type: "SET_STAGE", stage: "install_done", message: "Environment ready! Verifying…" });
      await checkPython();
    } catch (e) {
      dispatch({ type: "SET_ERROR", detail: String(e) });
    }
  }

  async function handleBundledInstall() {
    // Bundled zip: call download (returns path immediately) then install
    dispatch({ type: "SET_STAGE", stage: "downloading", message: "Preparing bundled Python…" });
    try {
      const zipPath = await api.downloadPython();
      await handleInstall(zipPath);
    } catch (e) {
      dispatch({ type: "SET_ERROR", detail: String(e) });
    }
  }

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const isBusy =
    state.stage === "checking" ||
    state.stage === "ready" ||
    state.stage === "backend_starting" ||
    state.stage === "downloading" ||
    state.stage === "installing" ||
    state.stage === "install_done";

  const showDownloadButton = state.stage === "needs_download";
  const showInstallButton = state.stage === "download_done";
  const showBundledInstallButton = state.stage === "needs_install";
  const showRetry = state.stage === "error";
  const isDone = state.stage === "backend_ready";

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center bg-slate-950 z-50 p-8">
      {/* Logo / title */}
      <div className="mb-10 flex flex-col items-center gap-3">
        <div className="w-14 h-14 rounded-2xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center">
          <svg className="w-7 h-7 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" />
          </svg>
        </div>
        <h1 className="text-2xl font-semibold text-white tracking-tight">CADViewer</h1>
        <p className="text-sm text-slate-400">First-time setup — takes a few minutes</p>
      </div>

      {/* Card */}
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col gap-5 shadow-xl">

        {/* Steps indicator */}
        <Steps currentStage={state.stage} />

        {/* Status message */}
        <div className="flex items-center gap-3 min-h-[2rem]">
          {isBusy && !isDone && (
            <div className="w-4 h-4 rounded-full border-2 border-blue-500 border-t-transparent animate-spin shrink-0" />
          )}
          {isDone && (
            <svg className="w-5 h-5 text-emerald-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          )}
          {state.stage === "error" && (
            <svg className="w-5 h-5 text-red-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
          )}
          <p className="text-sm text-slate-300 leading-snug">{state.message}</p>
        </div>

        {/* Progress bar */}
        {(state.stage === "downloading" || state.stage === "installing" || state.stage === "backend_starting") && (
          <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-300"
              style={{ width: `${state.percent}%` }}
            />
          </div>
        )}

        {/* Error detail */}
        {state.stage === "error" && state.errorDetail && (
          <pre className="text-xs text-red-300 bg-red-950/30 border border-red-900/40 rounded-lg p-3 overflow-auto max-h-32 whitespace-pre-wrap">
            {state.errorDetail}
          </pre>
        )}

        {/* Info box for needs_download (zip not bundled) */}
        {state.stage === "needs_download" && (
          <div className="rounded-lg bg-amber-950/30 border border-amber-700/30 p-4 flex gap-3">
            <svg className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            <div className="text-xs text-amber-200/80 leading-relaxed">
              <p className="font-semibold text-amber-300 mb-1">Python runtime not set up</p>
              <p>CADViewer needs a Python 3.11 runtime to process CAD files. It will be downloaded and installed <strong>only for this app</strong> — your system is not modified.</p>
            </div>
          </div>
        )}

        {/* Info box for needs_install (zip is bundled) */}
        {state.stage === "needs_install" && (
          <div className="rounded-lg bg-blue-950/30 border border-blue-700/30 p-4 flex gap-3">
            <svg className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div className="text-xs text-blue-200/80 leading-relaxed">
              <p className="font-semibold text-blue-300 mb-1">Python runtime is included</p>
              <p>One-time setup: install backend dependencies (~500 MB). Only for this app — your system is not modified.</p>
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex flex-col gap-2">
          {showDownloadButton && (
            <button
              onClick={handleDownload}
              className="w-full py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors"
            >
              Download Python 3.11 for CADViewer
            </button>
          )}

          {showInstallButton && (
            <button
              onClick={() => handleInstall()}
              className="w-full py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium transition-colors"
            >
              Set Up Python Environment
            </button>
          )}

          {showBundledInstallButton && (
            <button
              onClick={handleBundledInstall}
              className="w-full py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors"
            >
              Set Up Python Environment
            </button>
          )}

          {showRetry && (
            <button
              onClick={checkPython}
              className="w-full py-2.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm font-medium transition-colors"
            >
              Retry
            </button>
          )}

          {/* Always show re-check option when stuck at needs_download or error */}
          {(state.stage === "needs_download" || state.stage === "needs_install" || state.stage === "error") && (
            <button
              onClick={checkPython}
              className="w-full py-2 rounded-lg border border-slate-700 hover:border-slate-600 text-slate-400 hover:text-slate-300 text-xs transition-colors"
            >
              I already installed Python — re-check
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Steps indicator
// ---------------------------------------------------------------------------

const STEPS: { key: Stage[]; label: string }[] = [
  { key: ["checking"], label: "Detect Python" },
  { key: ["needs_download", "downloading", "download_done"], label: "Download" },
  { key: ["installing", "install_done"], label: "Install" },
  { key: ["ready", "backend_starting", "backend_ready"], label: "Start Backend" },
];

function Steps({ currentStage }: { currentStage: Stage }) {
  return (
    <div className="flex items-center gap-1">
      {STEPS.map((step, i) => {
        const stepIndex = STEPS.findIndex((s) => s.key.includes(currentStage));
        const isDone = i < stepIndex;
        const isCurrent = step.key.includes(currentStage);

        return (
          <div key={step.label} className="flex items-center flex-1 gap-1 min-w-0">
            <div className="flex flex-col items-center gap-1 flex-1 min-w-0">
              <div
                className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 transition-colors ${
                  isDone
                    ? "bg-emerald-500 text-white"
                    : isCurrent
                    ? "bg-blue-500 text-white"
                    : "bg-slate-800 text-slate-500"
                }`}
              >
                {isDone ? (
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                ) : (
                  i + 1
                )}
              </div>
              <span
                className={`text-[10px] font-medium text-center leading-tight ${
                  isDone ? "text-emerald-400" : isCurrent ? "text-blue-400" : "text-slate-600"
                }`}
              >
                {step.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={`flex-1 h-px mb-4 transition-colors ${
                  i < stepIndex ? "bg-emerald-700" : "bg-slate-800"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
