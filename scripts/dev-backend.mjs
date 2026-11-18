#!/usr/bin/env node
/**
 * Start the FastAPI backend with the local uv/venv Python on port 48321.
 * Usage (from repo root): npm run dev:backend
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BACKEND = path.join(ROOT, "backend");
const VENV = path.join(BACKEND, ".venv");
const IS_WIN = process.platform === "win32";
const PORT = process.env.PORT || "48321";

const python = IS_WIN
  ? path.join(VENV, "Scripts", "python.exe")
  : path.join(VENV, "bin", "python");

if (!fs.existsSync(python)) {
  console.error(
    [
      `Backend venv not found at ${VENV}`,
      "Run from the repo root:",
      "  npm run setup",
    ].join("\n"),
  );
  process.exit(1);
}

const child = spawn(
  python,
  [
    "-m",
    "uvicorn",
    "main:app",
    "--reload",
    "--host",
    "127.0.0.1",
    "--port",
    PORT,
  ],
  {
    cwd: BACKEND,
    stdio: "inherit",
    env: {
      ...process.env,
      PORT,
      // Faster STEP opens by default; set CAD_TESSELLATION_QUALITY=balanced|high to override
      CAD_TESSELLATION_QUALITY: process.env.CAD_TESSELLATION_QUALITY || "fast",
      // Prefer a writable local cache for GLB files in dev
      GLB_DIR:
        process.env.GLB_DIR ||
        path.join(
          process.env.USERPROFILE || process.env.HOME || ROOT,
          ".cadviewer",
          "glb_cache",
        ),
    },
  },
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 0);
  }
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    if (!child.killed) child.kill(sig);
  });
}
