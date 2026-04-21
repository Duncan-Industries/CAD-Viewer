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

export function FileUpload({ onFile, disabled }: Props) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;
      onFile(files[0]!);
    },
    [onFile],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      if (!disabled) handleFiles(e.dataTransfer.files);
    },
    [disabled, handleFiles],
  );

  const openPicker = useCallback(() => {
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
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
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
