"""
PyInstaller entry point for the CADViewer backend.

When packaged, this script is the `cadviewer-api` binary.
It reads the port from the PORT environment variable (set by the Electron
main process) and starts uvicorn programmatically.
"""

import os
import sys
import json
import time
from pathlib import Path
from importlib import import_module

# Keep handles alive for process lifetime so added DLL dirs stay active.
_DLL_DIR_HANDLES = []
DEBUG_LOG_PATH = Path(
    os.environ.get(
        "CADVIEWER_DEBUG_LOG_PATH",
        r"C:\Users\jake\Documents\GitHub\CAD-Viewer\debug-b66542.log",
    )
)


def _debug_log(run_id: str, hypothesis_id: str, location: str, message: str, data: dict) -> None:
    # #region agent log
    try:
        entry = {
            "sessionId": "b66542",
            "runId": run_id,
            "hypothesisId": hypothesis_id,
            "location": location,
            "message": message,
            "data": data,
            "timestamp": int(time.time() * 1000),
        }
        with DEBUG_LOG_PATH.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry, ensure_ascii=True) + "\n")
    except Exception:
        pass
    # #endregion


def _configure_windows_dll_search_paths() -> None:
    """Add bundled directories used by native extensions on Windows."""
    if sys.platform != "win32" or not hasattr(os, "add_dll_directory"):
        return

    bundle_dir = getattr(sys, "_MEIPASS", None)  # type: ignore[attr-defined]
    if not bundle_dir:
        return

    for dll_dir in (bundle_dir, os.path.join(bundle_dir, "casadi")):
        if os.path.isdir(dll_dir):
            _DLL_DIR_HANDLES.append(os.add_dll_directory(dll_dir))


# PyInstaller sets _MEIPASS when running from a bundle.
# We need to add the bundle directory to sys.path so FastAPI can find our app.
if hasattr(sys, "_MEIPASS"):
    sys.path.insert(0, sys._MEIPASS)  # type: ignore[attr-defined]
    _configure_windows_dll_search_paths()


def self_test() -> None:
    """Validate imports that are commonly missed by PyInstaller."""
    cadquery = import_module("cadquery")
    import_module("casadi")
    import_module("OCP")
    import_module("trimesh")
    import_module("uvicorn")
    processor = import_module("services.cad_processor")

    if not processor._has_cadquery():
        raise RuntimeError("cadquery import check failed")

    print(f"cadviewer-api self-test passed (cadquery {cadquery.__version__})")


def main() -> None:
    if "--self-test" in sys.argv:
        self_test()
        return

    _debug_log(
        "startup",
        "H7",
        "run.py:main:startup",
        "Backend runtime startup",
        {
            "frozen": bool(getattr(sys, "frozen", False)),
            "has_meipass": hasattr(sys, "_MEIPASS"),
            "cwd": os.getcwd(),
            "argv0": sys.argv[0],
            "debug_log_path": str(DEBUG_LOG_PATH),
        },
    )

    port = int(os.environ.get("PORT", "48321"))
    glb_dir = os.environ.get(
        "GLB_DIR",
        os.path.join(os.path.expanduser("~"), ".cadviewer", "glb_cache"),
    )
    os.makedirs(glb_dir, exist_ok=True)

    # Expose GLB_DIR so main.py picks it up
    os.environ["GLB_DIR"] = glb_dir

    # Import main directly so PyInstaller bundles it (string imports aren't traced)
    import uvicorn
    from main import app

    uvicorn.run(
        app,
        host="127.0.0.1",
        port=port,
        log_level="warning",
        # Don't watch for file changes — we're frozen
        reload=False,
    )


if __name__ == "__main__":
    main()
