import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import {
  Grid,
  Environment,
  Center,
  useGLTF,
  Html,
  Text,
  Billboard,
  Line,
  GizmoHelper,
  GizmoViewport,
} from "@react-three/drei";
import * as THREE from "three";
import type { Annotation, PmiLine, ViewMode } from "../types/cad";
import { Spinner } from "./ui/spinner";
import { CadCameraControls } from "./viewer/CadCameraControls";
import {
  applyClipPlanesFromBox,
  exceededDragThreshold,
  frameCameraToBox,
  isCameraControls,
} from "./viewer/cameraNav";

const ANNOTATION_COLORS: Record<string, string> = {
  note: "#93c5fd",
  dimension: "#6ee7b7",
  gdt: "#c4b5fd",
  surface_finish: "#fcd34d",
  weld: "#fdba74",
};

export interface ScenePart {
  id: string;
  name: string;
  kind: "body";
}

function isDisplayableAnnotation(ann: Annotation): boolean {
  const text = (ann.text || "").trim();
  if (!text) return false;
  const source = String(ann.metadata?.source ?? "");
  if (source === "prc_pdf" && text.startsWith("PRC content:")) return false;
  if (text.startsWith("nanoprc-py is not installed")) return false;
  if (text.startsWith("Could not read PRC metadata")) return false;
  return true;
}

function hasWorldPosition(ann: Annotation): boolean {
  return !!(
    ann.position &&
    Number.isFinite(ann.position.x) &&
    Number.isFinite(ann.position.y) &&
    Number.isFinite(ann.position.z)
  );
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

function namesMatch(a: string, b: string): boolean {
  const left = normalizeName(a);
  const right = normalizeName(b);
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

function hiddenKey(ids: Iterable<string>): string {
  return Array.from(ids).sort().join("|");
}

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

interface ModelProps {
  url: string;
  viewMode: ViewMode;
  hiddenPartIds: Set<string>;
  onPartClick?: (name: string) => void;
  onLoadStats?: (stats: { renderLoadMs: number; sceneNodes: number; meshCount: number }) => void;
  onBounds?: (box: THREE.Box3) => void;
  onSceneParts?: (parts: ScenePart[]) => void;
}

function applyMaterial(
  object: THREE.Object3D,
  viewMode: ViewMode,
  originalMaterials: Map<string, THREE.Material | THREE.Material[]>,
) {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const id = child.uuid;

    if (!originalMaterials.has(id)) {
      originalMaterials.set(
        id,
        Array.isArray(child.material)
          ? child.material.map((m) => m.clone())
          : child.material.clone(),
      );
    }

    const originals = originalMaterials.get(id)!;
    const mats = Array.isArray(originals) ? originals : [originals];

    const newMats = mats.map((orig) => {
      const m = orig.clone() as THREE.MeshStandardMaterial;
      if (viewMode === "wireframe") {
        m.wireframe = true;
        m.transparent = false;
        m.opacity = 1;
      } else if (viewMode === "transparent") {
        m.wireframe = false;
        m.transparent = true;
        m.opacity = 0.35;
        m.depthWrite = false;
      } else {
        m.wireframe = false;
        m.transparent = false;
        m.opacity = 1;
      }
      return m;
    });

    child.material = Array.isArray(originals) ? newMats : newMats[0]!;
  });
}

function CADModel({
  url,
  viewMode,
  hiddenPartIds,
  onPartClick,
  onLoadStats,
  onBounds,
  onSceneParts,
}: ModelProps) {
  const { camera, controls, invalidate } = useThree();
  const loadStart = useRef<number>(performance.now());
  const { scene } = useGLTF(url);
  const cloned = useMemo(() => scene.clone(true), [scene]);
  const originalMaterials = useRef(new Map<string, THREE.Material | THREE.Material[]>());
  const framedUrl = useRef<string | null>(null);
  const meshByPartId = useRef(new Map<string, THREE.Mesh>());
  const hideKey = hiddenKey(hiddenPartIds);
  const pointerDown = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    applyMaterial(cloned, viewMode, originalMaterials.current);
    invalidate();
  }, [cloned, viewMode, invalidate]);

  useLayoutEffect(() => {
    const parts: ScenePart[] = [];
    const map = new Map<string, THREE.Mesh>();
    let bodyIndex = 0;

    cloned.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      const partId = `body-${bodyIndex}`;
      const rawName = node.name?.trim() ?? "";
      const label =
        rawName && !/^__body[_-]?\d*__$/i.test(rawName) ? rawName : `Body ${bodyIndex + 1}`;
      node.userData.cadPartId = partId;
      map.set(partId, node);
      parts.push({ id: partId, name: label, kind: "body" });
      bodyIndex += 1;
    });

    meshByPartId.current = map;
    onSceneParts?.(parts);
  }, [cloned, onSceneParts]);

  useLayoutEffect(() => {
    for (const [partId, mesh] of meshByPartId.current.entries()) {
      mesh.visible = !hiddenPartIds.has(partId);
      if (mesh.parent && mesh.parent.children.length === 1) {
        mesh.parent.visible = mesh.visible;
      }
    }
    invalidate();
  }, [cloned, hideKey, hiddenPartIds, invalidate]);

  useEffect(() => {
    // Wait a frame so <Center> has applied its layout transform.
    const frame = requestAnimationFrame(() => {
      const box = new THREE.Box3();
      cloned.traverse((node) => {
        if (node instanceof THREE.Mesh && node.visible) {
          box.expandByObject(node);
        }
      });
      if (box.isEmpty()) {
        box.setFromObject(cloned);
      }
      onBounds?.(box.clone());

      if (isCameraControls(controls) && framedUrl.current !== url) {
        framedUrl.current = url;
        frameCameraToBox(controls, camera as THREE.PerspectiveCamera, box);
      } else {
        applyClipPlanesFromBox(camera as THREE.PerspectiveCamera, box);
      }

      let sceneNodes = 0;
      let meshCount = 0;
      cloned.traverse((node) => {
        sceneNodes += 1;
        if (node instanceof THREE.Mesh) meshCount += 1;
      });
      onLoadStats?.({
        renderLoadMs: Math.round(performance.now() - loadStart.current),
        sceneNodes,
        meshCount,
      });
      invalidate();
    });

    return () => cancelAnimationFrame(frame);
  }, [cloned, camera, controls, onLoadStats, onBounds, url, invalidate]);

  return (
    <primitive
      object={cloned}
      onPointerDown={(e: { stopPropagation: () => void; clientX: number; clientY: number }) => {
        // Don't steal camera-control gestures; only record for click-vs-drag.
        pointerDown.current = { x: e.clientX, y: e.clientY };
      }}
      onClick={(e: {
        stopPropagation: () => void;
        object: THREE.Object3D;
        clientX: number;
        clientY: number;
      }) => {
        e.stopPropagation();
        const start = pointerDown.current;
        pointerDown.current = null;
        if (!onPartClick || !start) return;
        if (exceededDragThreshold(start, { x: e.clientX, y: e.clientY })) return;
        const name = e.object.name || e.object.parent?.name || "Unknown";
        onPartClick(name);
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Loading spinner overlay
// ---------------------------------------------------------------------------

function LoadingSpinner() {
  return (
    <Html center>
      <div className="flex flex-col items-center gap-2">
        <Spinner size="lg" />
        <span className="text-slate-300 text-sm">Loading model…</span>
      </div>
    </Html>
  );
}

type LabelPlacement = { ann: Annotation; x: number; y: number; z: number };

function placeAnnotations(
  annotations: Annotation[],
  bounds: THREE.Box3 | null,
): LabelPlacement[] {
  const usable = annotations.filter(isDisplayableAnnotation);
  const withPos: LabelPlacement[] = [];
  const withoutPos: Annotation[] = [];

  for (const ann of usable) {
    if (hasWorldPosition(ann)) {
      withPos.push({
        ann,
        x: ann.position!.x,
        y: ann.position!.y,
        z: ann.position!.z,
      });
    } else {
      withoutPos.push(ann);
    }
  }

  if (withoutPos.length === 0) return withPos;

  const box =
    bounds && !bounds.isEmpty()
      ? bounds
      : new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const radius = Math.max(size.x, size.z, 1) * 0.62;
  const baseY = center.y + Math.max(size.y * 0.35, 0.5);

  withoutPos.forEach((ann, i) => {
    const t = (i / Math.max(withoutPos.length, 1)) * Math.PI * 2;
    const tier = Math.floor(i / 8);
    withPos.push({
      ann,
      x: center.x + Math.cos(t) * radius,
      y: baseY + tier * Math.max(size.y * 0.12, 0.4),
      z: center.z + Math.sin(t) * radius,
    });
  });

  return withPos;
}

function AnnotationLabels({
  annotations,
  bounds,
  hiddenAnnotationIds,
}: {
  annotations: Annotation[];
  bounds: THREE.Box3 | null;
  hiddenAnnotationIds?: Set<string>;
}) {
  const visibleAnnotations = useMemo(() => {
    if (!hiddenAnnotationIds || hiddenAnnotationIds.size === 0) return annotations;
    return annotations.filter((ann) => !hiddenAnnotationIds.has(ann.id));
  }, [annotations, hiddenAnnotationIds]);

  const placements = useMemo(
    () => placeAnnotations(visibleAnnotations, bounds),
    [visibleAnnotations, bounds],
  );

  const fontSize = useMemo(() => {
    if (!bounds || bounds.isEmpty()) return 2.2;
    const diag = bounds.getSize(new THREE.Vector3()).length();
    return Math.min(12, Math.max(0.8, diag * 0.02));
  }, [bounds]);

  if (placements.length === 0) return null;

  return (
    <>
      {placements.map(({ ann, x, y, z }) => {
        const color = ANNOTATION_COLORS[ann.type] ?? ANNOTATION_COLORS.note;
        return (
          <Billboard key={ann.id} position={[x, y, z]} follow>
            <Text
              fontSize={fontSize}
              color={color}
              anchorX="center"
              anchorY="middle"
              maxWidth={fontSize * 18}
              outlineWidth={fontSize * 0.08}
              outlineColor="#0f172a"
              depthOffset={-2}
              renderOrder={10}
              // Labels must not steal orbit/pan ray hits.
              raycast={() => {}}
            >
              {ann.text}
            </Text>
          </Billboard>
        );
      })}
    </>
  );
}

function PmiLeaderLines({ lines }: { lines: PmiLine[] }) {
  const points = useMemo(() => {
    const pts: Array<[number, number, number]> = [];
    for (const line of lines) {
      pts.push([line.start.x, line.start.y, line.start.z]);
      pts.push([line.end.x, line.end.y, line.end.z]);
    }
    return pts;
  }, [lines]);

  if (points.length < 2) return null;

  return (
    <Line
      segments
      points={points}
      color="#34d399"
      lineWidth={1.25}
      transparent
      opacity={0.95}
      depthTest
      renderOrder={5}
    />
  );
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

interface SceneProps {
  modelUrl: string;
  viewMode: ViewMode;
  hiddenPartIds: Set<string>;
  hiddenAnnotationIds: Set<string>;
  showNotes: boolean;
  onPartClick?: (name: string) => void;
  measurementMarkers?: Array<{ x: number; y: number; z: number }>;
  annotations?: Annotation[];
  pmiLines?: PmiLine[];
  onLoadStats?: (stats: { renderLoadMs: number; sceneNodes: number; meshCount: number }) => void;
  onSceneParts?: (parts: ScenePart[]) => void;
}

function ViewerScene({
  modelUrl,
  viewMode,
  hiddenPartIds,
  hiddenAnnotationIds,
  showNotes,
  onPartClick,
  measurementMarkers,
  annotations,
  pmiLines,
  onLoadStats,
  onSceneParts,
}: SceneProps) {
  const [bounds, setBounds] = useState<THREE.Box3 | null>(null);

  useEffect(() => {
    setBounds(null);
  }, [modelUrl]);

  return (
    <>
      <ambientLight intensity={1.2} />
      <directionalLight position={[10, 10, 5]} intensity={2} castShadow />
      <directionalLight position={[-8, -6, -4]} intensity={0.6} />
      <Environment preset="city" />

      <Suspense fallback={<LoadingSpinner />}>
        <Center>
          <CADModel
            url={modelUrl}
            viewMode={viewMode}
            hiddenPartIds={hiddenPartIds}
            onPartClick={onPartClick}
            onLoadStats={onLoadStats}
            onBounds={setBounds}
            onSceneParts={onSceneParts}
          />
          {showNotes && (
            <AnnotationLabels
              annotations={annotations ?? []}
              bounds={bounds}
              hiddenAnnotationIds={hiddenAnnotationIds}
            />
          )}
          {/* Dimension leaders are graphics, not notes; show with notes for readability. */}
          {showNotes && <PmiLeaderLines lines={pmiLines ?? []} />}
          {(measurementMarkers ?? []).map((marker, idx) => (
            <group key={`${marker.x}:${marker.y}:${marker.z}:${idx}`} position={[marker.x, marker.y, marker.z]}>
              <mesh>
                <sphereGeometry args={[0.6, 16, 16]} />
                <meshStandardMaterial color="#fbbf24" emissive="#7c2d12" />
              </mesh>
            </group>
          ))}
        </Center>
      </Suspense>

      <Grid
        position={[0, -0.01, 0]}
        infiniteGrid
        fadeStrength={3}
        fadeDistance={80}
        cellColor="#334155"
        sectionColor="#475569"
        cellSize={0.5}
        sectionSize={3}
      />

      <GizmoHelper alignment="bottom-right" margin={[60, 60]}>
        <GizmoViewport
          axisColors={["#ef4444", "#22c55e", "#3b82f6"]}
          labelColor="white"
        />
      </GizmoHelper>
    </>
  );
}

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------

interface Viewer3DProps {
  modelUrl: string | null;
  viewMode: ViewMode;
  hiddenPartIds?: Set<string>;
  hiddenAnnotationIds?: Set<string>;
  showNotes?: boolean;
  onPartClick?: (name: string) => void;
  measurementMarkers?: Array<{ x: number; y: number; z: number }>;
  annotations?: Annotation[];
  pmiLines?: PmiLine[];
  onLoadStats?: (stats: { renderLoadMs: number; sceneNodes: number; meshCount: number }) => void;
  onSceneParts?: (parts: ScenePart[]) => void;
}

export function Viewer3D({
  modelUrl,
  viewMode,
  hiddenPartIds,
  hiddenAnnotationIds,
  showNotes = false,
  onPartClick,
  measurementMarkers,
  annotations,
  pmiLines,
  onLoadStats,
  onSceneParts,
}: Viewer3DProps) {
  const hidden = useMemo(
    () => hiddenPartIds ?? new Set<string>(),
    [hiddenPartIds],
  );
  const hiddenNoteIds = useMemo(
    () => hiddenAnnotationIds ?? new Set<string>(),
    [hiddenAnnotationIds],
  );

  return (
    <div
      className={`w-full h-full bg-slate-950${modelUrl ? "" : " pointer-events-none"}`}
      onContextMenu={(e) => e.preventDefault()}
      title={
        modelUrl
          ? "Orbit: drag · Pan: Shift/Space+drag, middle, or right-drag · Zoom: scroll"
          : undefined
      }
    >
      <Canvas
        shadows
        camera={{ position: [5, 5, 5], fov: 50, near: 0.01, far: 5000 }}
        gl={{
          antialias: true,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1,
        }}
      >
        <CadCameraControls />
        {modelUrl && (
          <ViewerScene
            modelUrl={modelUrl}
            viewMode={viewMode}
            hiddenPartIds={hidden}
            hiddenAnnotationIds={hiddenNoteIds}
            showNotes={showNotes}
            onPartClick={onPartClick}
            measurementMarkers={measurementMarkers}
            annotations={annotations}
            pmiLines={pmiLines}
            onLoadStats={onLoadStats}
            onSceneParts={onSceneParts}
          />
        )}
        {!modelUrl && (
          <Html center>
            <p className="text-slate-500 text-sm">No model loaded</p>
          </Html>
        )}
      </Canvas>
    </div>
  );
}

export function collectMatchingPartIds(
  parts: ScenePart[],
  name: string,
): string[] {
  return parts.filter((part) => namesMatch(part.name, name)).map((part) => part.id);
}
