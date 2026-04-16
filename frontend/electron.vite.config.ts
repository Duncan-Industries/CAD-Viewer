import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

export default defineConfig({
  main: {
    // Electron main process
    build: {
      lib: {
        entry: resolve("electron/main.ts"),
      },
      outDir: "electron/dist",
      rollupOptions: {
        external: ["electron"],
      },
    },
  },
  preload: {
    // Electron preload script
    build: {
      lib: {
        entry: resolve("electron/preload.ts"),
      },
      outDir: "electron/dist",
      rollupOptions: {
        external: ["electron"],
      },
    },
  },
  renderer: {
    // React app (same as vite.config.ts but with Electron-aware base)
    root: ".",
    plugins: [react(), tailwindcss()],
    base: "./",
    build: {
      outDir: "dist/renderer",
      emptyOutDir: true,
      rollupOptions: {
        input: resolve("index.html"),
      },
    },
    server: {
      port: 5173,
      proxy: {
        "/api": {
          target: "http://127.0.0.1:48321",
          changeOrigin: true,
        },
      },
    },
  },
});
