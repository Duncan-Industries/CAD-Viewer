import type { ProcessedFile } from "../types/cad";

const ELECTRON_API_FALLBACK = "http://127.0.0.1:48321/api";

function getApiBase(): string {
  if (typeof window === "undefined") return "/api";
  if (window.location.protocol === "file:") {
    return window.cadviewer?.apiBaseUrl ?? ELECTRON_API_FALLBACK;
  }
  return "/api";
}

function toApiUrl(path: string): string {
  return `${getApiBase()}${path}`;
}

function toAbsoluteAssetUrl(pathOrUrl: string): string {
  if (/^https?:\/\//.test(pathOrUrl)) return pathOrUrl;
  if (pathOrUrl.startsWith("/api/")) {
    const suffix = pathOrUrl.slice("/api".length);
    return toApiUrl(suffix);
  }
  return pathOrUrl;
}

export async function uploadFile(file: File): Promise<ProcessedFile> {
  const form = new FormData();
  form.append("file", file);

  const res = await fetch(toApiUrl("/upload"), {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Upload failed" }));
    throw new Error((err as { detail?: string }).detail ?? "Upload failed");
  }

  const payload = (await res.json()) as ProcessedFile;
  return {
    ...payload,
    gltf_url: toAbsoluteAssetUrl(payload.gltf_url),
  };
}

export function glbUrl(fileId: string): string {
  return toApiUrl(`/files/${fileId}.glb`);
}
