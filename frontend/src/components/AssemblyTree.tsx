import { useState } from "react";
import type { AssemblyNode } from "../types/cad";
import { Button } from "./ui/button";

interface NodeProps {
  node: AssemblyNode;
  depth: number;
  selected: string | null;
  onSelect: (id: string) => void;
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

function TreeNode({ node, depth, selected, onSelect }: NodeProps) {
  const [open, setOpen] = useState(depth < 2);
  const hasChildren = node.children.length > 0;
  const isSelected = selected === node.id;

  return (
    <div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={[
          "w-full justify-start gap-1.5 px-2 py-1 rounded text-left text-sm",
          "hover:bg-slate-700/60",
          isSelected ? "bg-blue-600/20 text-blue-300" : "text-slate-300",
        ].join(" ")}
        style={{ paddingLeft: `${0.5 + depth * 1}rem` }}
        onClick={() => {
          if (hasChildren) setOpen((o) => !o);
          onSelect(node.id);
        }}
      >
        {/* Expand/collapse arrow */}
        {hasChildren ? (
          <svg
            className={`w-3 h-3 shrink-0 transition-transform text-slate-500 ${open ? "rotate-90" : ""}`}
            fill="currentColor" viewBox="0 0 20 20"
          >
            <path fillRule="evenodd" clipRule="evenodd"
              d="M7.293 4.293a1 1 0 011.414 0l5 5a1 1 0 010 1.414l-5 5a1 1 0 01-1.414-1.414L11.586 10 7.293 5.707a1 1 0 010-1.414z" />
          </svg>
        ) : (
          <span className="w-3 h-3 shrink-0" />
        )}

        {colorSwatch(node)}

        {/* Type icon */}
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

      {hasChildren && open && (
        <div>
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              selected={selected}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface AssemblyTreeProps {
  nodes: AssemblyNode[];
}

export function AssemblyTree({ nodes }: AssemblyTreeProps) {
  const [selected, setSelected] = useState<string | null>(null);

  if (nodes.length === 0) {
    return (
      <p className="text-slate-500 text-sm px-3 py-4">
        No assembly data available for this format.
      </p>
    );
  }

  return (
    <div className="overflow-y-auto h-full py-1">
      {nodes.map((node) => (
        <TreeNode
          key={node.id}
          node={node}
          depth={0}
          selected={selected}
          onSelect={setSelected}
        />
      ))}
    </div>
  );
}
