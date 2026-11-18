import type { Annotation, FileMetadata } from "../types/cad";
import { Button } from "./ui/button";

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------

const TYPE_STYLES: Record<string, string> = {
  note: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  dimension: "bg-green-500/15 text-green-300 border-green-500/30",
  gdt: "bg-purple-500/15 text-purple-300 border-purple-500/30",
  surface_finish: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  weld: "bg-orange-500/15 text-orange-300 border-orange-500/30",
};

function TypeBadge({ type }: { type: string }) {
  const style = TYPE_STYLES[type] ?? "bg-slate-500/15 text-slate-300 border-slate-500/30";
  return (
    <span className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border ${style}`}>
      {type.replace("_", " ")}
    </span>
  );
}

function EyeIcon({ hidden }: { hidden: boolean }) {
  if (hidden) {
    return (
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228L3 3m13.772 13.772L21 21m-3.228-3.228L21 21" />
      </svg>
    );
  }
  return (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Annotation card
// ---------------------------------------------------------------------------

function AnnotationCard({
  ann,
  hidden,
  onToggleHidden,
}: {
  ann: Annotation;
  hidden: boolean;
  onToggleHidden: (id: string) => void;
}) {
  return (
    <div
      className={[
        "rounded-lg bg-slate-800/60 border border-slate-700/50 px-3 py-2.5 space-y-1.5",
        hidden ? "opacity-50" : "",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <TypeBadge type={ann.type} />
          {ann.component && (
            <span className="text-xs text-slate-500 truncate">{ann.component}</span>
          )}
        </div>
        <button
          type="button"
          title={hidden ? "Show in 3D view" : "Hide in 3D view"}
          className="shrink-0 p-1 rounded text-slate-500 hover:text-slate-200 hover:bg-slate-700"
          onClick={() => onToggleHidden(ann.id)}
        >
          <EyeIcon hidden={hidden} />
        </button>
      </div>
      <p className="text-sm text-slate-200 leading-snug whitespace-pre-wrap break-words">
        {ann.text}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Metadata section
// ---------------------------------------------------------------------------

function MetaRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex gap-2 text-sm">
      <span className="w-28 shrink-0 text-slate-500">{label}</span>
      <span className="text-slate-200 break-all">{value}</span>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Public components
// ---------------------------------------------------------------------------

interface AnnotationsPanelProps {
  annotations: Annotation[];
  hiddenAnnotationIds?: Set<string>;
  showAnnotations?: boolean;
  onToggleAnnotation?: (id: string) => void;
  onShowAllAnnotations?: () => void;
  onHideAllAnnotations?: () => void;
  onToggleShowAnnotations?: () => void;
}

export function AnnotationsPanel({
  annotations,
  hiddenAnnotationIds,
  showAnnotations = false,
  onToggleAnnotation,
  onShowAllAnnotations,
  onHideAllAnnotations,
  onToggleShowAnnotations,
}: AnnotationsPanelProps) {
  const hidden = hiddenAnnotationIds ?? new Set<string>();

  if (annotations.length === 0) {
    return (
      <p className="text-slate-500 text-sm px-3 py-4">
        No annotations found in this file.
      </p>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex flex-col gap-1.5 px-2 py-2 border-b border-slate-800">
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant={showAnnotations ? "primary" : "secondary"}
            size="sm"
            className="text-xs"
            onClick={onToggleShowAnnotations}
            title="Show or hide text notes and dimension labels in 3D"
          >
            {showAnnotations ? "Notes on" : "Notes off"}
          </Button>
          <Button type="button" variant="secondary" size="sm" className="text-xs" onClick={onShowAllAnnotations}>
            Show all
          </Button>
          <Button type="button" variant="secondary" size="sm" className="text-xs" onClick={onHideAllAnnotations}>
            Hide labels
          </Button>
        </div>
        <p className="px-1 text-[11px] text-slate-500">
          Notes are text only. Toggle controls 3D text labels (and dimension leaders).
        </p>
      </div>

      <div className="overflow-y-auto flex-1 min-h-0 p-3 space-y-2">
        {annotations.map((ann) => (
          <AnnotationCard
            key={ann.id}
            ann={ann}
            hidden={!showAnnotations || hidden.has(ann.id)}
            onToggleHidden={onToggleAnnotation ?? (() => undefined)}
          />
        ))}
      </div>
    </div>
  );
}

export function MetadataPanel({ metadata }: { metadata: FileMetadata }) {
  return (
    <div className="overflow-y-auto h-full p-3 space-y-1.5">
      <MetaRow label="File" value={metadata.filename} />
      <MetaRow label="Format" value={metadata.format} />
      <MetaRow label="Size" value={formatBytes(metadata.file_size)} />
      <MetaRow label="Standard" value={metadata.ap_standard} />
      <MetaRow label="Unit" value={metadata.unit} />
      <MetaRow label="Author" value={metadata.author} />
      <MetaRow label="Organization" value={metadata.organization} />
      <MetaRow label="Created" value={metadata.created} />
      <MetaRow label="Description" value={metadata.description} />
    </div>
  );
}
