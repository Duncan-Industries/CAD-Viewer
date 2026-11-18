/** Supported CAD / 3D mesh extensions (no leading dots for Electron filters). */
export const CAD_FILE_EXTENSIONS = [
  "step",
  "stp",
  "iges",
  "igs",
  "stl",
  "obj",
  "glb",
  "gltf",
  "ply",
  "off",
  "3mf",
  "pdf",
  "prc",
] as const;

/** HTML input accept attribute — extensions only. */
export const CAD_FILE_ACCEPT = CAD_FILE_EXTENSIONS.map((ext) => `.${ext}`).join(",");

const CAD_ACCEPT_TYPES: FilePickerAcceptType[] = [
  {
    description: "3D / CAD files",
    accept: {
      "application/octet-stream": CAD_FILE_EXTENSIONS.map((ext) => `.${ext}`),
    },
  },
];

export function pickFirstFile(files: FileList | null): File | null {
  if (!files || files.length === 0) return null;
  return files[0] ?? null;
}

export function isSupportedCadFileName(name: string): boolean {
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  return (CAD_FILE_EXTENSIONS as readonly string[]).includes(ext);
}

export function clearFileInput(input: HTMLInputElement): void {
  input.value = "";
}

export function openFileInputPicker(input: HTMLInputElement | null): void {
  input?.click();
}

/**
 * Open the OS file explorer filtered to 3D / CAD files only.
 * Prefer Electron dialog or showOpenFilePicker (no "All files"); fall back to <input accept>.
 */
export async function openCadFilePicker(
  inputFallback: HTMLInputElement | null = null,
): Promise<File | null> {
  // Electron: native dialog with CAD-only filter (no All Files)
  if (window.cadviewer?.openCadFile) {
    const picked = await window.cadviewer.openCadFile();
    if (!picked) return null;
    return new File([picked.data], picked.name);
  }

  // Chromium / Edge: File System Access API
  if (typeof window.showOpenFilePicker === "function") {
    try {
      const [handle] = await window.showOpenFilePicker({
        multiple: false,
        excludeAcceptAllOption: true,
        types: CAD_ACCEPT_TYPES,
      });
      return await handle.getFile();
    } catch (err) {
      // User cancelled
      if (err instanceof DOMException && err.name === "AbortError") return null;
      // Unsupported / permission — fall through to <input>
    }
  }

  // Fallback: hidden file input (accept still hints the dialog).
  // Caller owns the change handler — we only trigger the picker.
  openFileInputPicker(inputFallback);
  return null;
}
