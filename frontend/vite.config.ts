import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Shared renderer config used by both `vite dev` (web) and electron-vite
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Use relative paths so the built index.html works when loaded via file:// in Electron
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      // In web-only dev mode, proxy /api to the local FastAPI server
      "/api": {
        target: "http://localhost:48321",
        changeOrigin: true,
      },
    },
  },
});
