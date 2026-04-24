"""
PyInstaller entry point for the CADViewer backend.

When packaged, this script is the `cadviewer-api` binary.
It reads the port from the PORT environment variable (set by the Electron
main process) and starts uvicorn programmatically.
"""

import os
import sys

# PyInstaller sets _MEIPASS when running from a bundle.
# We need to add the bundle directory to sys.path so FastAPI can find our app.
if hasattr(sys, "_MEIPASS"):
    sys.path.insert(0, sys._MEIPASS)  # type: ignore[attr-defined]


def self_test() -> None:
    """Validate imports that are commonly missed by PyInstaller."""
    import cadquery
    import OCP  # noqa: F401
    import services.cad_processor as processor

    if not processor._has_cadquery():
        raise RuntimeError("cadquery import check failed")

    print(f"cadviewer-api self-test passed (cadquery {cadquery.__version__})")


def main() -> None:
    if "--self-test" in sys.argv:
        self_test()
        return

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
