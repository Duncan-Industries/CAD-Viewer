import type { CameraControlsImpl } from "@react-three/drei";
import { CameraControlsImpl as CameraControlsClass } from "@react-three/drei";
import * as THREE from "three";

const { ACTION } = CameraControlsClass;

export { ACTION };

export const DRAG_CLICK_THRESHOLD_PX = 5;

/** CAD touch map: 1-finger orbit, 2-finger zoom+pan, 3-finger pan. */
export const CAD_TOUCHES = {
  one: ACTION.TOUCH_ROTATE,
  two: ACTION.TOUCH_DOLLY_TRUCK,
  three: ACTION.TOUCH_TRUCK,
} as const;

/** Precise CAD orbit / pan / zoom feel. */
export const CAD_CAMERA_FEEL = {
  azimuthRotateSpeed: 0.7,
  polarRotateSpeed: 0.7,
  truckSpeed: 1.4,
  dollySpeed: 0.85,
  draggingSmoothTime: 0.08,
  smoothTime: 0.12,
  minPolarAngle: 0.05,
  maxPolarAngle: Math.PI - 0.05,
  infinityDolly: true,
} as const;

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable
  );
}

export function isCameraControls(value: unknown): value is CameraControlsImpl {
  return !!value && typeof value === "object" && "setLookAt" in value && "fitToBox" in value;
}

export function applyMouseButtons(
  controls: CameraControlsImpl,
  panWithLeft: boolean,
): void {
  controls.mouseButtons.left = panWithLeft ? ACTION.TRUCK : ACTION.ROTATE;
  controls.mouseButtons.middle = ACTION.TRUCK;
  controls.mouseButtons.right = ACTION.TRUCK;
  controls.mouseButtons.wheel = ACTION.DOLLY;
}

export function applyCadCameraFeel(controls: CameraControlsImpl): void {
  controls.azimuthRotateSpeed = CAD_CAMERA_FEEL.azimuthRotateSpeed;
  controls.polarRotateSpeed = CAD_CAMERA_FEEL.polarRotateSpeed;
  controls.truckSpeed = CAD_CAMERA_FEEL.truckSpeed;
  controls.dollySpeed = CAD_CAMERA_FEEL.dollySpeed;
  controls.draggingSmoothTime = CAD_CAMERA_FEEL.draggingSmoothTime;
  controls.smoothTime = CAD_CAMERA_FEEL.smoothTime;
  controls.minPolarAngle = CAD_CAMERA_FEEL.minPolarAngle;
  controls.maxPolarAngle = CAD_CAMERA_FEEL.maxPolarAngle;
  controls.infinityDolly = CAD_CAMERA_FEEL.infinityDolly;
  controls.touches.one = CAD_TOUCHES.one;
  controls.touches.two = CAD_TOUCHES.two;
  controls.touches.three = CAD_TOUCHES.three;
  applyMouseButtons(controls, false);
}

/**
 * Scale perspective clip planes to a model bbox diagonal.
 * Returns the safe diagonal used for distance math.
 */
export function applyClipPlanesFromBox(
  camera: THREE.PerspectiveCamera,
  box: THREE.Box3,
): number {
  const size = box.getSize(new THREE.Vector3()).length();
  const safeSize = size > 0 ? size : 1;
  camera.near = safeSize / 100;
  camera.far = safeSize * 100;
  camera.updateProjectionMatrix();
  return safeSize;
}

/**
 * Frame the camera on a model bbox and scale near/far + dolly limits to size.
 * Returns the safe diagonal used for distance math.
 */
export function frameCameraToBox(
  controls: CameraControlsImpl,
  camera: THREE.PerspectiveCamera,
  box: THREE.Box3,
): number {
  const safeSize = applyClipPlanesFromBox(camera, box);
  const center = box.getCenter(new THREE.Vector3());
  const distance = safeSize * 1.35;

  void controls.setLookAt(
    center.x + distance,
    center.y + distance * 0.55,
    center.z + distance,
    center.x,
    center.y,
    center.z,
    false,
  );
  controls.minDistance = safeSize / 200;
  controls.maxDistance = safeSize * 50;

  return safeSize;
}

export function exceededDragThreshold(
  start: { x: number; y: number },
  end: { x: number; y: number },
  thresholdPx: number = DRAG_CLICK_THRESHOLD_PX,
): boolean {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  return dx * dx + dy * dy > thresholdPx * thresholdPx;
}
