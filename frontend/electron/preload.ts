/**
 * Preload script — runs in a privileged context before the renderer.
 * Keep this minimal; the renderer uses the /api proxy, not IPC.
 */
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("cadviewer", {
  platform: process.platform,

  // Python / backend setup
  checkPython: () => ipcRenderer.invoke("python:check"),
  downloadPython: () => ipcRenderer.invoke("python:download"),
  installPython: (installerPath: string) =>
    ipcRenderer.invoke("python:install", installerPath),
  startBackend: () => ipcRenderer.invoke("backend:start"),
  getBackendStatus: () => ipcRenderer.invoke("backend:status"),

  // Progress events streamed from main → renderer
  onSetupProgress: (
    cb: (event: { stage: string; percent: number; message: string }) => void,
  ) => {
    const handler = (_: Electron.IpcRendererEvent, payload: { stage: string; percent: number; message: string }) =>
      cb(payload);
    ipcRenderer.on("setup:progress", handler);
    return () => ipcRenderer.removeListener("setup:progress", handler);
  },
});
