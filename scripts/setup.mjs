#!/usr/bin/env node
/**
 * One-shot local setup: uv + Python 3.11 venv for the backend, npm install for the frontend.
 * Usage (from repo root): npm run setup
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BACKEND = path.join(ROOT, "backend");
const FRONTEND = path.join(ROOT, "frontend");
const VENV = path.join(BACKEND, ".venv");
const REQUIREMENTS = path.join(BACKEND, "requirements.txt");
const IS_WIN = process.platform === "win32";

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    stdio: "inherit",
    cwd: opts.cwd ?? ROOT,
    env: opts.env ?? process.env,
    shell: opts.shell ?? false,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function which(cmd) {
  const probe = IS_WIN ? "where" : "which";
  const result = spawnSync(probe, [cmd], { encoding: "utf8", shell: IS_WIN });
  if (result.status !== 0) return null;
  const line = (result.stdout || "").split(/\r?\n/).find((l) => l.trim());
  return line?.trim() || null;
}

function findUv() {
  const fromPath = which("uv");
  if (fromPath) return fromPath;

  // Common Windows install locations (standalone installer / cargo)
  const home = process.env.USERPROFILE || process.env.HOME || "";
  const candidates = [
    path.join(home, ".local", "bin", IS_WIN ? "uv.exe" : "uv"),
    path.join(home, ".cargo", "bin", IS_WIN ? "uv.exe" : "uv"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

console.log("==> CADViewer setup\n");

const uv = findUv();
if (!uv) {
  console.error(
    [
      "uv was not found on PATH.",
      "",
      "Install uv (recommended), then re-run npm run setup:",
      "  https://docs.astral.sh/uv/getting-started/installation/",
      "",
      "Windows (PowerShell):",
      '  powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"',
      "",
      "macOS / Linux:",
      "  curl -LsSf https://astral.sh/uv/install.sh | sh",
    ].join("\n"),
  );
  process.exit(1);
}

console.log(`Using uv: ${uv}`);
console.log("Creating backend/.venv with Python 3.11…");
run(uv, ["venv", VENV, "--python", "3.11"]);

console.log("Installing backend requirements (CadQuery / OCP)…");
run(uv, [
  "pip",
  "install",
  "--python",
  VENV,
  "--index-strategy",
  "unsafe-best-match",
  "-r",
  REQUIREMENTS,
]);

console.log("Installing frontend npm dependencies…");
run("npm", ["install"], { cwd: FRONTEND, shell: IS_WIN });

console.log("Installing root npm dependencies…");
run("npm", ["install"], { cwd: ROOT, shell: IS_WIN });
console.log(
  [
    "",
    "==> Setup complete.",
    "    Start everything with:  npm run dev",
    "    Web UI:                 http://localhost:5173",
    "    API (local):            http://127.0.0.1:48321",
    "    API docs:               http://127.0.0.1:48321/docs",
  ].join("\n"),
);
