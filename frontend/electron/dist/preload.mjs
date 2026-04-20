import { contextBridge } from "electron";
contextBridge.exposeInMainWorld("cadviewer", {
  platform: process.platform
});
