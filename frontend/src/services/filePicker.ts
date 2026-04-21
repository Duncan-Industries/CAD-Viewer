export const CAD_FILE_ACCEPT = [
  ".step",
  ".stp",
  ".iges",
  ".igs",
  ".stl",
  ".obj",
  ".glb",
  ".gltf",
  ".ply",
  ".off",
  ".3mf",
].join(",");

export function pickFirstFile(files: FileList | null): File | null {
  if (!files || files.length === 0) return null;
  return files[0] ?? null;
}

export function clearFileInput(input: HTMLInputElement): void {
  input.value = "";
}

export function openFileInputPicker(input: HTMLInputElement | null): void {
  input?.click();
}
