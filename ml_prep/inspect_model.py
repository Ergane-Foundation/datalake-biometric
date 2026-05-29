#!/usr/bin/env python3
"""
Inspect a .tflite model and print its input/output tensor shapes + dtypes.

Use this after dropping a real model into android/src/main/assets/models/ to
confirm it matches what the native code expects, e.g. MobileFaceNet:
  input  : [1, 112, 112, 3] float32 (normalized to [-1, 1])
  output : [1, N]           float32 (N is the embedding dimension)

Usage:
    python ml_prep/inspect_model.py android/src/main/assets/models/mobilefacenet_int8.tflite
    python ml_prep/inspect_model.py            # inspects all models in the assets folder
"""

import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent.resolve()
MODELS_DIR = SCRIPT_DIR / ".." / "android" / "src" / "main" / "assets" / "models"


def _load_interpreter(path):
    """Return a TFLite Interpreter from whichever runtime is installed."""
    try:
        from tensorflow.lite import Interpreter
    except Exception:
        try:
            from ai_edge_litert.interpreter import Interpreter
        except Exception:
            try:
                from tflite_runtime.interpreter import Interpreter
            except Exception:
                print(
                    "ERROR: No TFLite runtime found. Install one of:\n"
                    "  pip install tensorflow        (full, easiest)\n"
                    "  pip install ai-edge-litert    (lightweight)\n"
                    "  pip install tflite-runtime"
                )
                sys.exit(1)
    return Interpreter(model_path=str(path))


def inspect(path: Path) -> None:
    size_kb = path.stat().st_size / 1024
    print(f"\n{'=' * 60}\n{path.name}  ({size_kb:.1f} KB)\n{'=' * 60}")

    if size_kb < 1:
        print("  ⚠️  Suspiciously tiny — likely a placeholder/stub, not a real model.")

    interp = _load_interpreter(path)
    interp.allocate_tensors()

    for kind, details in (("INPUT", interp.get_input_details()),
                          ("OUTPUT", interp.get_output_details())):
        for d in details:
            print(f"  {kind:6} {d['name']!r}")
            print(f"         shape={list(d['shape'])}  dtype={d['dtype'].__name__}")
            scale, zero = d.get("quantization", (0.0, 0))
            if scale:
                print(f"         quantized: scale={scale}  zero_point={zero}")


def main() -> None:
    args = sys.argv[1:]
    targets = [Path(a) for a in args] if args else sorted(MODELS_DIR.glob("*.tflite"))
    if not targets:
        print(f"No .tflite files found in {MODELS_DIR.resolve()}")
        return
    for t in targets:
        if not t.exists():
            print(f"\n✗ Not found: {t}")
            continue
        try:
            inspect(t)
        except Exception as exc:
            print(f"  ✗ Could not load: {type(exc).__name__}: {exc}")


if __name__ == "__main__":
    main()
