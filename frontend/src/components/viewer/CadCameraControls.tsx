import { useLayoutEffect, useRef, useState } from "react";
import { CameraControls, type CameraControlsImpl } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import {
  applyCadCameraFeel,
  applyMouseButtons,
  isTypingTarget,
} from "./cameraNav";

/**
 * CAD-style camera controls:
 * - LMB drag: orbit
 * - Shift/Space + LMB, MMB, or RMB: pan
 * - Wheel: zoom to cursor
 */
export function CadCameraControls() {
  const controlsRef = useRef<CameraControlsImpl | null>(null);
  const [ready, setReady] = useState(false);
  const gl = useThree((s) => s.gl);
  const panModifier = useRef(false);
  const dragging = useRef(false);

  useLayoutEffect(() => {
    const controls = controlsRef.current;
    if (!controls || !ready) return;

    const spaceHeld = { current: false };
    const canvas = gl.domElement;

    const setCursor = () => {
      if (dragging.current) {
        canvas.style.cursor = panModifier.current ? "move" : "grabbing";
      } else if (panModifier.current) {
        canvas.style.cursor = "move";
      } else {
        canvas.style.cursor = "default";
      }
    };

    const syncPanModifier = (shiftKey = false) => {
      panModifier.current = shiftKey || spaceHeld.current;
      applyMouseButtons(controls, panModifier.current);
      setCursor();
    };

    applyCadCameraFeel(controls);
    syncPanModifier(false);

    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      if (event.code === "Space") {
        event.preventDefault();
        spaceHeld.current = true;
      }
      syncPanModifier(event.shiftKey);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") spaceHeld.current = false;
      syncPanModifier(event.shiftKey);
    };
    const onBlur = () => {
      spaceHeld.current = false;
      dragging.current = false;
      syncPanModifier(false);
    };
    // Capture so left-button mode is set before camera-controls reads it.
    const onPointerDown = (event: PointerEvent) => {
      syncPanModifier(event.shiftKey);
    };
    const onControlStart = () => {
      dragging.current = true;
      setCursor();
    };
    const onControlEnd = () => {
      dragging.current = false;
      setCursor();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    document.addEventListener("pointerdown", onPointerDown, true);
    controls.addEventListener("controlstart", onControlStart);
    controls.addEventListener("controlend", onControlEnd);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("pointerdown", onPointerDown, true);
      controls.removeEventListener("controlstart", onControlStart);
      controls.removeEventListener("controlend", onControlEnd);
      canvas.style.cursor = "";
    };
  }, [ready, gl]);

  return (
    <CameraControls
      ref={(instance) => {
        controlsRef.current = instance;
        if (instance && !ready) setReady(true);
      }}
      makeDefault
      dollyToCursor
    />
  );
}
