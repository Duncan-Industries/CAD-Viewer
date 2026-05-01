import { useMemo } from "react";
import type { FileFeatureCatalog, MeasurementType, PartSummary, FeatureMeasureResponse } from "../types/cad";
import { Button } from "./ui/button";

const MEASURE_OPTIONS: Array<{ id: MeasurementType; label: string }> = [
  { id: "edge_length", label: "Edge Length" },
  { id: "hole_diameter", label: "Hole Diameter" },
  { id: "plane_distance", label: "Plane Distance" },
];

interface FeatureMeasurePanelProps {
  catalog: FileFeatureCatalog | null;
  selectedPartId: string | null;
  selectedMeasureType: MeasurementType;
  featureA: string | null;
  featureB: string | null;
  busy?: boolean;
  error?: string | null;
  result?: FeatureMeasureResponse | null;
  onPartChange: (partId: string) => void;
  onTypeChange: (type: MeasurementType) => void;
  onFeatureAChange: (featureId: string) => void;
  onFeatureBChange: (featureId: string) => void;
  onMeasure: () => void;
}

function findPart(catalog: FileFeatureCatalog | null, partId: string | null): PartSummary | null {
  if (!catalog || !partId) return null;
  return catalog.parts.find((p) => p.id === partId) ?? null;
}

export function FeatureMeasurePanel({
  catalog,
  selectedPartId,
  selectedMeasureType,
  featureA,
  featureB,
  busy,
  error,
  result,
  onPartChange,
  onTypeChange,
  onFeatureAChange,
  onFeatureBChange,
  onMeasure,
}: FeatureMeasurePanelProps) {
  const selectedPart = findPart(catalog, selectedPartId);
  const filteredFeatures = useMemo(() => {
    if (!selectedPart) return [];
    if (selectedMeasureType === "edge_length") {
      return selectedPart.features.filter((f) => f.kind === "edge");
    }
    if (selectedMeasureType === "hole_diameter") {
      return selectedPart.features.filter((f) => f.kind === "hole");
    }
    return selectedPart.features.filter((f) => f.kind === "plane");
  }, [selectedPart, selectedMeasureType]);

  return (
    <div className="overflow-y-auto h-full p-3 space-y-3">
      {!catalog && <p className="text-slate-500 text-sm">Load a model to inspect measurable features.</p>}
      {catalog && (
        <>
          <div className="space-y-1">
            <p className="text-xs text-slate-400 uppercase tracking-wide">Part</p>
            <select
              value={selectedPartId ?? ""}
              onChange={(e) => onPartChange(e.target.value)}
              className="w-full rounded-md bg-slate-800 border border-slate-700 px-2 py-1.5 text-sm text-slate-100"
            >
              <option value="">Choose a part</option>
              {catalog.parts.map((part) => (
                <option key={part.id} value={part.id}>
                  {part.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <p className="text-xs text-slate-400 uppercase tracking-wide">Measurement</p>
            <div className="grid grid-cols-1 gap-1.5">
              {MEASURE_OPTIONS.map((opt) => (
                <Button
                  key={opt.id}
                  type="button"
                  size="sm"
                  variant={selectedMeasureType === opt.id ? "primary" : "secondary"}
                  onClick={() => onTypeChange(opt.id)}
                >
                  {opt.label}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <p className="text-xs text-slate-400 uppercase tracking-wide">Feature A</p>
            <select
              value={featureA ?? ""}
              onChange={(e) => onFeatureAChange(e.target.value)}
              disabled={filteredFeatures.length === 0}
              className="w-full rounded-md bg-slate-800 border border-slate-700 px-2 py-1.5 text-sm text-slate-100 disabled:opacity-50"
            >
              <option value="">Select feature</option>
              {filteredFeatures.map((feature) => (
                <option key={feature.id} value={feature.id}>
                  {feature.label}
                </option>
              ))}
            </select>
          </div>

          {selectedMeasureType === "plane_distance" && (
            <div className="space-y-1">
              <p className="text-xs text-slate-400 uppercase tracking-wide">Feature B</p>
              <select
                value={featureB ?? ""}
                onChange={(e) => onFeatureBChange(e.target.value)}
                disabled={filteredFeatures.length === 0}
                className="w-full rounded-md bg-slate-800 border border-slate-700 px-2 py-1.5 text-sm text-slate-100 disabled:opacity-50"
              >
                <option value="">Select second plane</option>
                {filteredFeatures.map((feature) => (
                  <option key={feature.id} value={feature.id}>
                    {feature.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          <Button
            type="button"
            onClick={onMeasure}
            disabled={!selectedPartId || !featureA || (selectedMeasureType === "plane_distance" && !featureB) || busy}
          >
            {busy ? "Measuring..." : "Measure"}
          </Button>

          {error && <p className="text-sm text-red-400 whitespace-pre-wrap">{error}</p>}
          {result && (
            <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-3 space-y-1">
              <p className="text-xs uppercase tracking-wide text-slate-400">Result</p>
              <p className="text-base font-semibold text-slate-100">{result.value.display}</p>
            </div>
          )}

          {selectedPart && (
            <p className="text-xs text-slate-500">
              Features: edge {selectedPart.feature_counts.edge ?? 0}, hole {selectedPart.feature_counts.hole ?? 0}, plane {selectedPart.feature_counts.plane ?? 0}
            </p>
          )}
        </>
      )}
    </div>
  );
}
