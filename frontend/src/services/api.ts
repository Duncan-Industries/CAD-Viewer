import type {
  ProcessedFile,
  FileFeatureCatalog,
  FeatureMeasureRequest,
  FeatureMeasureResponse,
} from "../types/cad";

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

async function parseApiError(res: Response): Promise<string> {
  const err = await res.json().catch(() => null);
  if (!err) return `Request failed (${res.status})`;
  const topLevelDetail = (err as { detail?: unknown }).detail;
  if (typeof topLevelDetail === "string") return topLevelDetail;
  const apiError = (err as { error?: { message?: string; detail?: string; stage?: string } }).error;
  if (apiError?.message) {
    return apiError.stage
      ? `${apiError.message} [stage=${apiError.stage}]`
      : apiError.message;
  }
  return `Request failed (${res.status})`;
}

export async function uploadFile(file: File): Promise<ProcessedFile> {
  const form = new FormData();
  form.append("file", file);

  const res = await fetch(toApiUrl("/upload"), {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    throw new Error(await parseApiError(res));
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

export async function getFeatureCatalog(fileId: string): Promise<FileFeatureCatalog> {
  const res = await fetch(toApiUrl(`/files/${fileId}/features`));
  if (!res.ok) throw new Error(await parseApiError(res));
  return (await res.json()) as FileFeatureCatalog;
}

export async function measureFeature(
  fileId: string,
  payload: FeatureMeasureRequest,
): Promise<FeatureMeasureResponse> {
  const res = await fetch(toApiUrl(`/files/${fileId}/measure`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await parseApiError(res));
  return (await res.json()) as FeatureMeasureResponse;
}
