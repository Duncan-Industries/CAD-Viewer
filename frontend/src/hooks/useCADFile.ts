import { useState, useCallback } from "react";
import { uploadFile } from "../services/api";
import type { ProcessedFile } from "../types/cad";

type Status = "idle" | "uploading" | "processing" | "done" | "error";

export function useCADFile() {
  const [status, setStatus] = useState<Status>("idle");
  const [cadFile, setCadFile] = useState<ProcessedFile | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (file: File) => {
    setStatus("uploading");
    setError(null);
    setCadFile(null);

    try {
      setStatus("processing");
      const result = await uploadFile(file);
      setCadFile(result);
      setStatus("done");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setError(msg);
      setStatus("error");
    }
  }, []);

  const reset = useCallback(() => {
    setStatus("idle");
    setCadFile(null);
    setError(null);
  }, []);

  return { status, cadFile, error, load, reset };
}
