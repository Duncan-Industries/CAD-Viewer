import { app, BrowserWindow, dialog, shell } from "electron";
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import __cjs_mod__ from "node:module";
const __filename = import.meta.filename;
const __dirname = import.meta.dirname;
const require2 = __cjs_mod__.createRequire(import.meta.url);
const __dirname$1 = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_PORT = 48321;
let backend = null;
let mainWindow = null;
function getBackendBinary() {
  if (app.isPackaged) {
    const ext = process.platform === "win32" ? ".exe" : "";
    const bin = path.join(
      process.resourcesPath,
      "backend",
      `cadviewer-api${ext}`
    );
    return { cmd: bin, args: [] };
  }
  const backendDir = path.join(__dirname$1, "../../backend");
  const python = process.platform === "win32" ? "python" : "python3";
  return {
    cmd: python,
    args: ["-m", "uvicorn", "main:app", "--port", String(BACKEND_PORT), "--log-level", "warning"],
    cwd: backendDir
  };
}
function waitForBackend(port, timeoutMs = 6e4) {
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
          setTimeout(attempt, 1e3);
        }
      );
      req.on("error", () => setTimeout(attempt, 1e3));
      req.on("timeout", () => {
        req.destroy();
        setTimeout(attempt, 1e3);
      });
    };
    attempt();
  });
}
async function startBackend() {
  const { cmd, args, cwd } = getBackendBinary();
  backend = spawn(cmd, args, {
    cwd,
    env: {
      ...process.env,
      PORT: String(BACKEND_PORT),
      GLB_DIR: path.join(app.getPath("temp"), "cadviewer_glb")
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  backend.stdout?.on(
    "data",
    (d) => process.stdout.write(`[backend] ${d.toString()}`)
  );
  backend.stderr?.on(
    "data",
    (d) => process.stderr.write(`[backend] ${d.toString()}`)
  );
  backend.on("exit", (code, signal) => {
    if (code !== 0 && !app.isQuitting) {
      console.error(`[backend] exited unexpectedly (code=${code} signal=${signal})`);
    }
  });
  await waitForBackend(BACKEND_PORT);
}
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#020617",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(__dirname$1, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    },
    show: false
  });
  const rendererUrl = app.isPackaged ? `file://${path.join(__dirname$1, "../renderer/index.html")}` : "http://localhost:5173";
  mainWindow.loadURL(rendererUrl);
  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https:") || url.startsWith("http:")) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });
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
      String(err) + "\n\nMake sure Python and all dependencies are installed."
    );
    app.quit();
    return;
  }
  createWindow();
});
