export interface ColorRGB {
  r: number;
  g: number;
  b: number;
}

export interface AssemblyNode {
  id: string;
  name: string;
  type: "assembly" | "part" | "body";
  color: ColorRGB | null;
  material: string | null;
  children: AssemblyNode[];
}

export interface Annotation {
  id: string;
  type: "note" | "dimension" | "gdt" | "surface_finish" | "weld";
  text: string;
  component: string | null;
  position: { x: number; y: number; z: number } | null;
  metadata: Record<string, unknown>;
}

export interface FileMetadata {
  filename: string;
  format: string;
  file_size: number;
  unit: string | null;
  author: string | null;
  organization: string | null;
  created: string | null;
  description: string | null;
  ap_standard: string | null;
}

export interface ProcessedFile {
  file_id: string;
  gltf_url: string;
  metadata: FileMetadata;
  assembly: AssemblyNode[];
  annotations: Annotation[];
  supported_format: boolean;
}

export type ViewMode = "solid" | "wireframe" | "transparent";
export type PanelTab = "assembly" | "annotations" | "metadata";

export interface CADViewerBridge {
  platform: string;
  checkPython: () => Promise<{ found: boolean; version?: string; cmd?: string; bundled?: boolean }>;
  downloadPython: () => Promise<string>;
  installPython: () => Promise<boolean>;
  startBackend: () => Promise<{ ok: boolean; reason?: string }>;
  getBackendStatus: () => Promise<string>;
  onSetupProgress: (
    cb: (event: { stage: string; percent: number; message: string }) => void,
  ) => () => void;
}

declare global {
  interface Window {
    cadviewer?: CADViewerBridge;
  }
}
