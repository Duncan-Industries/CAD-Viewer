import { useCallback, useRef, useState } from "react";

const ACCEPT = [
  ".step", ".stp", ".iges", ".igs",
  ".stl", ".obj", ".glb", ".gltf",
  ".ply", ".off", ".3mf",
].join(",");

interface Props {
  onFile: (file: File) => void;
  disabled?: boolean;
}

function debugLog(
  location: string,
  message: string,
  hypothesisId: string,
  data: Record<string, unknown>,
) {
  // #region agent log
  fetch("http://127.0.0.1:7244/ingest/019b87a8-dab2-4a8b-85ca-71ef66cd7018", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "f20fb4",
    },
    body: JSON.stringify({
      sessionId: "f20fb4",
      runId: "initial",
      hypothesisId,
      location,
      message,
      data,
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
}

export function FileUpload({ onFile, disabled }: Props) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      debugLog(
        "FileUpload.tsx:handleFiles",
        "handleFiles invoked",
        "H3",
        { disabled: !!disabled, fileCount: files?.length ?? 0 },
      );
      if (!files || files.length === 0) return;
      onFile(files[0]!);
    },
    [disabled, onFile],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      debugLog(
        "FileUpload.tsx:onDrop",
        "drop event received on upload zone",
        "H2",
        { disabled: !!disabled, fileCount: e.dataTransfer.files?.length ?? 0 },
      );
      if (!disabled) handleFiles(e.dataTransfer.files);
    },
    [disabled, handleFiles],
  );

  const openPicker = useCallback(() => {
    debugLog(
      "FileUpload.tsx:openPicker",
      "upload zone click handler invoked",
      "H1",
      { disabled: !!disabled, hasInputRef: !!inputRef.current },
    );
    if (disabled) return;
    // Explicit programmatic click — works reliably across Chromium/Firefox
    // even when the hidden input is sr-only or behind other stacking contexts.
    inputRef.current?.click();
  }, [disabled]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (disabled) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openPicker();
      }
    },
    [disabled, openPicker],
  );

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      onClick={openPicker}
      onKeyDown={onKeyDown}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
        debugLog(
          "FileUpload.tsx:onDragOver",
          "dragover event received on upload zone",
          "H2",
          { disabled: !!disabled },
        );
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={[
        "flex flex-col items-center justify-center gap-3",
        "w-full h-full min-h-64 rounded-xl border-2 border-dashed",
        "cursor-pointer transition-colors select-none",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
        dragging
          ? "border-blue-400 bg-blue-400/10"
          : "border-slate-600 hover:border-blue-500 hover:bg-slate-800/50",
        disabled ? "opacity-50 pointer-events-none" : "",
      ].join(" ")}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        disabled={disabled}
        onChange={(e) => {
          debugLog(
            "FileUpload.tsx:inputOnChange",
            "file input onChange fired",
            "H3",
            { fileCount: e.target.files?.length ?? 0 },
          );
          handleFiles(e.target.files);
          // Reset so selecting the same file again still fires onChange
          e.target.value = "";
        }}
      />

      {/* Icon */}
      <svg
        className="w-14 h-14 text-slate-500"
        fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}
      >
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9" />
      </svg>

      <div className="text-center">
        <p className="text-slate-300 font-medium">
          Drop a CAD file here, or <span className="text-blue-400">click to browse</span>
        </p>
        <p className="text-slate-500 text-sm mt-1">
          STEP · IGES · STL · OBJ · GLTF · PLY · 3MF
        </p>
      </div>
    </div>
  );
}
