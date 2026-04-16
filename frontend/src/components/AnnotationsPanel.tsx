import type { Annotation, FileMetadata } from "../types/cad";

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

// ---------------------------------------------------------------------------
// Annotation card
// ---------------------------------------------------------------------------

function AnnotationCard({ ann }: { ann: Annotation }) {
  return (
    <div className="rounded-lg bg-slate-800/60 border border-slate-700/50 px-3 py-2.5 space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <TypeBadge type={ann.type} />
        {ann.component && (
          <span className="text-xs text-slate-500 truncate">{ann.component}</span>
        )}
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

export function AnnotationsPanel({ annotations }: { annotations: Annotation[] }) {
  if (annotations.length === 0) {
    return (
      <p className="text-slate-500 text-sm px-3 py-4">
        No annotations found in this file.
      </p>
    );
  }

  return (
    <div className="overflow-y-auto h-full p-3 space-y-2">
      {annotations.map((ann) => (
        <AnnotationCard key={ann.id} ann={ann} />
      ))}
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
