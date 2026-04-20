/**
 * Electron main process.
 *
 * Startup sequence:
 *  1. Spawn the Python backend (PyInstaller binary in prod, uvicorn in dev)
 *  2. Poll /api/health until ready
 *  3. Open the BrowserWindow
 *  4. Kill backend on app quit
 */

import { app, BrowserWindow, dialog, shell } from "electron";
import { spawn, ChildProcess } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Port the Python backend listens on. Use a high, obscure port to avoid conflicts.
const BACKEND_PORT = 48_321;

let backend: ChildProcess | null = null;
let mainWindow: BrowserWindow | null = null;

// ---------------------------------------------------------------------------
// Backend path resolution
// ---------------------------------------------------------------------------

function getBackendBinary(): { cmd: string; args: string[]; cwd?: string } {
  if (app.isPackaged) {
    // PyInstaller one-file binary lives in <app>/resources/backend/
    const ext = process.platform === "win32" ? ".exe" : "";
    const bin = path.join(
      process.resourcesPath,
      "backend",
      `cadviewer-api${ext}`,
    );
    return { cmd: bin, args: [] };
  }

  // Development: run uvicorn directly from the source tree
  const backendDir = path.join(__dirname, "../../backend");
  const python = process.platform === "win32" ? "python" : "python3";
  return {
    cmd: python,
    args: ["-m", "uvicorn", "main:app", "--port", String(BACKEND_PORT), "--log-level", "warning"],
    cwd: backendDir,
  };
}

// ---------------------------------------------------------------------------
// Wait for backend readiness
// ---------------------------------------------------------------------------

function waitForBackend(port: number, timeoutMs = 60_000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      if (Date.now() - start > timeoutMs) {
        return reject(new Error("Backend did not start within 60 seconds."));
      }
      const req = http.get(
        `http://127.0.0.1:${port}/api/health`,
        { timeout: 1500 },
        (res) => {
          if (res.statusCode === 200) return resolve();
          setTimeout(attempt, 1000);
        },
      );
      req.on("error", () => setTimeout(attempt, 1000));
      req.on("timeout", () => { req.destroy(); setTimeout(attempt, 1000); });
    };
    attempt();
  });
}

// ---------------------------------------------------------------------------
// Spawn backend
// ---------------------------------------------------------------------------

async function startBackend(): Promise<void> {
  const { cmd, args, cwd } = getBackendBinary();

  backend = spawn(cmd, args, {
    cwd,
    env: {
      ...process.env,
      PORT: String(BACKEND_PORT),
      GLB_DIR: path.join(app.getPath("temp"), "cadviewer_glb"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  backend.stdout?.on("data", (d: Buffer) =>
    process.stdout.write(`[backend] ${d.toString()}`),
  );
  backend.stderr?.on("data", (d: Buffer) =>
    process.stderr.write(`[backend] ${d.toString()}`),
  );

  backend.on("exit", (code, signal) => {
    if (code !== 0 && !app.isQuitting) {
      console.error(`[backend] exited unexpectedly (code=${code} signal=${signal})`);
    }
  });

  await waitForBackend(BACKEND_PORT);
}

// ---------------------------------------------------------------------------
// Create window
// ---------------------------------------------------------------------------

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#020617",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    show: false,
  });

  const rendererUrl = app.isPackaged
    ? `file://${path.join(__dirname, "../renderer/index.html")}`
    : "http://localhost:5173";

  mainWindow.loadURL(rendererUrl);

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  // Open external links in the OS browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https:") || url.startsWith("http:")) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Electron {
    interface App {
      isQuitting?: boolean;
    }
  }
}

app.on("before-quit", () => {
  app.isQuitting = true;
});

app.on("will-quit", () => {
  if (backend && !backend.killed) {
    backend.kill("SIGTERM");
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.whenReady().then(async () => {
  try {
    await startBackend();
  } catch (err) {
    await dialog.showErrorBox(
      "Backend failed to start",
      String(err) + "\n\nMake sure Python and all dependencies are installed.",
    );
    app.quit();
    return;
  }
  createWindow();
});
