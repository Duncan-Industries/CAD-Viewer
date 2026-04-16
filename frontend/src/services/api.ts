import type { ProcessedFile } from "../types/cad";

const BASE = "/api";

export async function uploadFile(file: File): Promise<ProcessedFile> {
  const form = new FormData();
  form.append("file", file);

  const res = await fetch(`${BASE}/upload`, {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Upload failed" }));
    throw new Error((err as { detail?: string }).detail ?? "Upload failed");
  }

  return res.json() as Promise<ProcessedFile>;
}

export function glbUrl(fileId: string): string {
  return `${BASE}/files/${fileId}.glb`;
}
