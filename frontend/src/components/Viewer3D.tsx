import { Suspense, useEffect, useMemo, useRef } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import {
  OrbitControls,
  Grid,
  Environment,
  Center,
  useGLTF,
  Html,
  GizmoHelper,
  GizmoViewport,
} from "@react-three/drei";
import * as THREE from "three";
import type { ViewMode } from "../types/cad";
import { Spinner } from "./ui/spinner";

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

interface ModelProps {
  url: string;
  viewMode: ViewMode;
  onPartClick?: (name: string) => void;
  onLoadStats?: (stats: { renderLoadMs: number; sceneNodes: number; meshCount: number }) => void;
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

function CADModel({ url, viewMode, onPartClick, onLoadStats }: ModelProps) {
  const { camera, controls } = useThree();
  const loadStart = useRef<number>(performance.now());
  const { scene } = useGLTF(url);
  const cloned = useMemo(() => scene.clone(true), [scene]);
  const originalMaterials = useRef(new Map<string, THREE.Material | THREE.Material[]>());

  useEffect(() => {
    applyMaterial(cloned, viewMode, originalMaterials.current);
  }, [cloned, viewMode]);

  useEffect(() => {
    const box = new THREE.Box3().setFromObject(cloned);
    const size = box.getSize(new THREE.Vector3()).length();
    const center = box.getCenter(new THREE.Vector3());
    const cam = camera as THREE.PerspectiveCamera;
    const safeSize = size > 0 ? size : 1;
    cam.near = safeSize / 100;
    cam.far = safeSize * 10;
    cam.position.set(
      center.x + safeSize,
      center.y + safeSize * 0.6,
      center.z + safeSize,
    );
    cam.lookAt(center);
    cam.updateProjectionMatrix();
    if (controls) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (controls as any).target.copy(center);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (controls as any).update();
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
  }, [cloned, camera, controls, onLoadStats]);

  return (
    <primitive
      object={cloned}
      onClick={(e: { stopPropagation: () => void; object: THREE.Object3D }) => {
        e.stopPropagation();
        if (onPartClick) {
          const name = e.object.name || e.object.parent?.name || "Unknown";
          onPartClick(name);
        }
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

// ---------------------------------------------------------------------------
// Camera auto-fit
// ---------------------------------------------------------------------------

interface SceneProps {
  modelUrl: string;
  viewMode: ViewMode;
  onPartClick?: (name: string) => void;
  measurementMarkers?: Array<{ x: number; y: number; z: number }>;
  onLoadStats?: (stats: { renderLoadMs: number; sceneNodes: number; meshCount: number }) => void;
}

function ViewerScene({
  modelUrl,
  viewMode,
  onPartClick,
  measurementMarkers,
  onLoadStats,
}: SceneProps) {
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
            onPartClick={onPartClick}
            onLoadStats={onLoadStats}
          />
        </Center>
        {(measurementMarkers ?? []).map((marker, idx) => (
          <group key={`${marker.x}:${marker.y}:${marker.z}:${idx}`} position={[marker.x, marker.y, marker.z]}>
            <mesh>
              <sphereGeometry args={[0.6, 16, 16]} />
              <meshStandardMaterial color="#fbbf24" emissive="#7c2d12" />
            </mesh>
          </group>
        ))}
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
  onPartClick?: (name: string) => void;
  measurementMarkers?: Array<{ x: number; y: number; z: number }>;
  onLoadStats?: (stats: { renderLoadMs: number; sceneNodes: number; meshCount: number }) => void;
}

export function Viewer3D({
  modelUrl,
  viewMode,
  onPartClick,
  measurementMarkers,
  onLoadStats,
}: Viewer3DProps) {
  return (
    <div className={`w-full h-full bg-slate-950${modelUrl ? "" : " pointer-events-none"}`}>
      <Canvas
        shadows
        camera={{ position: [5, 5, 5], fov: 50, near: 0.01, far: 5000 }}
        gl={{
          antialias: true,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1,
        }}
      >
        <OrbitControls makeDefault enableDamping dampingFactor={0.05} />
        {modelUrl && (
          <ViewerScene
            modelUrl={modelUrl}
            viewMode={viewMode}
            onPartClick={onPartClick}
            measurementMarkers={measurementMarkers}
            onLoadStats={onLoadStats}
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
