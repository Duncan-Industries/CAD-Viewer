import { useMemo, useState } from "react";
import type { AssemblyNode } from "../types/cad";
import type { ScenePart } from "./Viewer3D";
import { Button } from "./ui/button";

interface NodeProps {
  node: AssemblyNode;
  depth: number;
  selected: string | null;
  hiddenNames: Set<string>;
  onSelect: (id: string) => void;
  onToggleHidden: (name: string) => void;
}

function colorSwatch(node: AssemblyNode) {
  if (!node.color) return null;
  const { r, g, b } = node.color;
  const hex = `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
  return (
    <span
      className="inline-block w-2.5 h-2.5 rounded-sm shrink-0 border border-slate-600"
      style={{ backgroundColor: hex }}
    />
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

function TreeNode({ node, depth, selected, hiddenNames, onSelect, onToggleHidden }: NodeProps) {
  const [open, setOpen] = useState(depth < 2);
  const hasChildren = node.children.length > 0;
  const isSelected = selected === node.id;
  const isHidden = hiddenNames.has(node.name);

  return (
    <div>
      <div
        className={[
          "group flex items-center gap-0.5 pr-1 rounded",
          isSelected ? "bg-blue-600/20" : "hover:bg-slate-700/60",
          isHidden ? "opacity-50" : "",
        ].join(" ")}
        style={{ paddingLeft: `${0.35 + depth * 0.85}rem` }}
      >
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={[
            "flex-1 min-w-0 justify-start gap-1.5 px-1.5 py-1 rounded text-left text-sm",
            isSelected ? "text-blue-300" : "text-slate-300",
          ].join(" ")}
          onClick={() => {
            if (hasChildren) setOpen((o) => !o);
            onSelect(node.id);
          }}
        >
          {hasChildren ? (
            <svg
              className={`w-3 h-3 shrink-0 transition-transform text-slate-500 ${open ? "rotate-90" : ""}`}
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M7.293 4.293a1 1 0 011.414 0l5 5a1 1 0 010 1.414l-5 5a1 1 0 01-1.414-1.414L11.586 10 7.293 5.707a1 1 0 010-1.414z"
              />
            </svg>
          ) : (
            <span className="w-3 h-3 shrink-0" />
          )}

          {colorSwatch(node)}

          {node.type === "assembly" ? (
            <svg className="w-3.5 h-3.5 shrink-0 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5 shrink-0 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 6.878V6a2.25 2.25 0 012.25-2.25h7.5A2.25 2.25 0 0118 6v.878m-12 0c.235-.083.487-.128.75-.128h10.5c.263 0 .515.045.75.128m-12 0A2.25 2.25 0 004.5 9v.878m13.5-3A2.25 2.25 0 0119.5 9v.878m0 0a2.246 2.246 0 00-.75-.128H5.25c-.263 0-.515.045-.75.128m15 0A2.25 2.25 0 0121 12v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6a2.25 2.25 0 012.25-2.25" />
            </svg>
          )}

          <span className="truncate">{node.name}</span>
        </Button>

        <button
          type="button"
          title={isHidden ? "Show part" : "Hide part"}
          className="shrink-0 p-1 rounded text-slate-500 hover:text-slate-200 hover:bg-slate-700"
          onClick={(e) => {
            e.stopPropagation();
            onToggleHidden(node.name);
          }}
        >
          <EyeIcon hidden={isHidden} />
        </button>
      </div>

      {hasChildren && open && (
        <div>
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              selected={selected}
              hiddenNames={hiddenNames}
              onSelect={onSelect}
              onToggleHidden={onToggleHidden}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface AssemblyTreeProps {
  nodes: AssemblyNode[];
  sceneParts?: ScenePart[];
  hiddenPartIds: Set<string>;
  onTogglePartId: (id: string) => void;
  onToggleAssemblyName: (name: string) => void;
  onShowAll: () => void;
  onHideAllBodies: () => void;
  hiddenAssemblyNames: Set<string>;
}

export function AssemblyTree({
  nodes,
  sceneParts = [],
  hiddenPartIds,
  onTogglePartId,
  onToggleAssemblyName,
  onShowAll,
  onHideAllBodies,
  hiddenAssemblyNames,
}: AssemblyTreeProps) {
  const [selected, setSelected] = useState<string | null>(null);

  const bodyParts = useMemo(
    () => sceneParts.filter((p) => p.kind === "body"),
    [sceneParts],
  );

  const hasAssembly = nodes.length > 0;
  const hasBodies = bodyParts.length > 0;

  if (!hasAssembly && !hasBodies) {
    return (
      <p className="text-slate-500 text-sm px-3 py-4">
        No assembly data available for this format.
      </p>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-1.5 px-2 py-2 border-b border-slate-800">
        <Button type="button" variant="secondary" size="sm" className="text-xs" onClick={onShowAll}>
          Show all bodies
        </Button>
        <Button type="button" variant="secondary" size="sm" className="text-xs" onClick={onHideAllBodies}>
          Hide bodies
        </Button>
      </div>

      <div className="overflow-y-auto flex-1 min-h-0 py-1">
        {hasAssembly && (
          <>
            <p className="px-3 pt-1 pb-1 text-[10px] uppercase tracking-wide text-slate-500">Assembly</p>
            {nodes.map((node) => (
              <TreeNode
                key={node.id}
                node={node}
                depth={0}
                selected={selected}
                hiddenNames={hiddenAssemblyNames}
                onSelect={setSelected}
                onToggleHidden={onToggleAssemblyName}
              />
            ))}
          </>
        )}

        {hasBodies && (
          <>
            <p className="px-3 pt-3 pb-1 text-[10px] uppercase tracking-wide text-slate-500">
              Bodies ({bodyParts.length})
            </p>
            {bodyParts.map((part) => {
              const hidden = hiddenPartIds.has(part.id);
              return (
                <div
                  key={part.id}
                  className={[
                    "flex items-center gap-1 pr-1 pl-2 rounded",
                    hidden ? "opacity-50" : "hover:bg-slate-700/60",
                  ].join(" ")}
                >
                  <span className="flex-1 truncate text-sm text-slate-300 py-1">{part.name}</span>
                  <button
                    type="button"
                    title={hidden ? "Show body" : "Hide body"}
                    className="shrink-0 p-1 rounded text-slate-500 hover:text-slate-200 hover:bg-slate-700"
                    onClick={() => onTogglePartId(part.id)}
                  >
                    <EyeIcon hidden={hidden} />
                  </button>
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
