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

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

interface ModelProps {
  url: string;
  viewMode: ViewMode;
  onPartClick?: (name: string) => void;
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

function CADModel({ url, viewMode, onPartClick }: ModelProps) {
  const { scene } = useGLTF(url);
  const cloned = useMemo(() => scene.clone(true), [scene]);
  const originalMaterials = useRef(new Map<string, THREE.Material | THREE.Material[]>());

  useEffect(() => {
    applyMaterial(cloned, viewMode, originalMaterials.current);
  }, [cloned, viewMode]);

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

function AutoFit({ url }: { url: string }) {
  const { camera, controls } = useThree();
  const { scene } = useGLTF(url);

  useEffect(() => {
    const box = new THREE.Box3().setFromObject(scene);
    const size = box.getSize(new THREE.Vector3()).length();
    const center = box.getCenter(new THREE.Vector3());

    const cam = camera as THREE.PerspectiveCamera;
    cam.near = size / 100;
    cam.far = size * 10;
    cam.position.set(center.x + size, center.y + size * 0.6, center.z + size);
    cam.lookAt(center);
    cam.updateProjectionMatrix();

    if (controls) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (controls as any).target.copy(center);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (controls as any).update();
    }
  }, [scene, camera, controls]);

  return null;
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

interface SceneProps {
  modelUrl: string;
  viewMode: ViewMode;
  onPartClick?: (name: string) => void;
}

function ViewerScene({ modelUrl, viewMode, onPartClick }: SceneProps) {
  return (
    <>
      <ambientLight intensity={1.2} />
      <directionalLight position={[10, 10, 5]} intensity={2} castShadow />
      <directionalLight position={[-8, -6, -4]} intensity={0.6} />
      <Environment preset="city" />

      <Suspense fallback={<LoadingSpinner />}>
        <Center>
          <CADModel url={modelUrl} viewMode={viewMode} onPartClick={onPartClick} />
        </Center>
        <AutoFit url={modelUrl} />
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
}

export function Viewer3D({ modelUrl, viewMode, onPartClick }: Viewer3DProps) {
  const pointerEventsDisabled = !modelUrl;
  return (
    <div
      className={`w-full h-full bg-slate-950${modelUrl ? "" : " pointer-events-none"}`}
      onPointerDown={() => {
        debugLog(
          "Viewer3D.tsx:onPointerDown",
          "viewer container received pointer down",
          "H4",
          { modelLoaded: !!modelUrl, pointerEventsDisabled },
        );
      }}
      onDrop={(e) => {
        debugLog(
          "Viewer3D.tsx:onDrop",
          "viewer container received drop",
          "H4",
          { modelLoaded: !!modelUrl, pointerEventsDisabled, fileCount: e.dataTransfer.files?.length ?? 0 },
        );
      }}
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
        <OrbitControls makeDefault enableDamping dampingFactor={0.05} />
        {modelUrl && (
          <ViewerScene
            modelUrl={modelUrl}
            viewMode={viewMode}
            onPartClick={onPartClick}
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
