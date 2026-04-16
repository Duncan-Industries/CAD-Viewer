import type { ViewMode } from "../types/cad";

interface ToolbarProps {
  viewMode: ViewMode;
  onViewMode: (m: ViewMode) => void;
  onReset: () => void;
  filename: string | null;
}

const VIEW_MODES: { mode: ViewMode; label: string }[] = [
  { mode: "solid", label: "Solid" },
  { mode: "wireframe", label: "Wire" },
  { mode: "transparent", label: "X-Ray" },
];

export function Toolbar({ viewMode, onViewMode, onReset, filename }: ToolbarProps) {
  return (
    <header className="flex items-center justify-between gap-4 px-4 py-2.5 bg-slate-900 border-b border-slate-800 shrink-0">
      {/* Left: logo + filename */}
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex items-center gap-1.5 text-blue-400 shrink-0">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9" />
          </svg>
          <span className="font-semibold text-white text-sm tracking-wide">CADViewer</span>
        </div>
        {filename && (
          <>
            <span className="text-slate-700">/</span>
            <span className="text-slate-400 text-sm truncate">{filename}</span>
          </>
        )}
      </div>

      {/* Right: controls */}
      <div className="flex items-center gap-2 shrink-0">
        {/* View mode pills */}
        <div className="flex rounded-lg overflow-hidden border border-slate-700">
          {VIEW_MODES.map(({ mode, label }) => (
            <button
              key={mode}
              onClick={() => onViewMode(mode)}
              className={[
                "px-3 py-1 text-xs font-medium transition-colors",
                viewMode === mode
                  ? "bg-blue-600 text-white"
                  : "bg-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-700",
              ].join(" ")}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Reset / open new file */}
        <button
          onClick={onReset}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white border border-slate-700 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
          </svg>
          Open file
        </button>
      </div>
    </header>
  );
}
