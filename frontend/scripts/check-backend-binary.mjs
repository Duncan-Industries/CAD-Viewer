/**
 * Aborts the Electron packaging step if the PyInstaller binary
 * (backend/dist/cadviewer-api[.exe]) is missing.
 *
 * Without this guard, electron-builder's `extraResources` filter silently
 * matches nothing and the shipped app has no backend — which then manifests
 * at runtime as the confusing
 *   "Error loading ASGI app. Could not import module 'main'."
 * because the fallback code path tries to run `uvicorn main:app` from a
 * resources/backend/ directory that does not contain main.py.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, "../../backend/dist");

const candidates = ["cadviewer-api.exe", "cadviewer-api"];
const found = candidates
  .map((name) => path.join(distDir, name))
  .filter((p) => fs.existsSync(p));

if (found.length === 0) {
  console.error(
    [
      "",
      "✖ PyInstaller binary not found.",
      `  Looked for: ${candidates.map((c) => path.join(distDir, c)).join(", ")}`,
      "",
      "  Build it first:",
      "    cd backend && pyinstaller cadviewer-api.spec --distpath dist --noconfirm --clean",
      "  (or run scripts/build-python.sh from the repo root)",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

console.log(`✓ Found backend binary: ${found[0]}`);
