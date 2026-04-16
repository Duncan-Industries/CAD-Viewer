/**
 * Preload script — runs in a privileged context before the renderer.
 * Keep this minimal; the renderer uses the /api proxy, not IPC.
 */
import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("cadviewer", {
  platform: process.platform,
});
