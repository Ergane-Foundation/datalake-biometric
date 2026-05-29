"""
Verify TFLite models in android/src/main/assets/models/ by running a dummy
inference and reporting input/output shapes, dtype, and inference time.

Usage:
    python ml_prep/verify_models.py

Requires:
    pip install tensorflow
"""

import time
from pathlib import Path

import numpy as np

try:
    import tensorflow as tf
    Interpreter = tf.lite.Interpreter
except ImportError:
    raise SystemExit(
        "TensorFlow is not installed.\n"
        "Install it with:  pip install tensorflow"
    )

SCRIPT_DIR = Path(__file__).parent.resolve()
MODELS_DIR = SCRIPT_DIR / ".." / "android" / "src" / "main" / "assets" / "models"

MODELS = [
    {"filename": "blazeface.tflite",          "label": "BlazeFace (face detector)"},
    {"filename": "mobilefacenet_int8.tflite", "label": "MobileFaceNet (face embedder)"},
    {"filename": "face_mesh.tflite",          "label": "Face Landmarker / face_mesh"},
]

PASS = "\033[32mPASS\033[0m"
FAIL = "\033[31mFAIL\033[0m"
SKIP = "\033[33mSKIP\033[0m"


def dtype_name(detail: dict) -> str:
    return np.dtype(detail["dtype"]).name


def verify_model(model_path: Path, label: str) -> bool:
    print(f"\n{'â”€' * 60}")
    print(f"Model : {label}")
    print(f"File  : {model_path.name}")

    if not model_path.exists():
        print(f"Status: {SKIP}  (file not found â€” skipping)")
        return True  # not a failure; file simply hasn't been downloaded yet

    try:
        interpreter = Interpreter(model_path=str(model_path))
        interpreter.allocate_tensors()

        input_details  = interpreter.get_input_details()
        output_details = interpreter.get_output_details()

        print(f"\nInputs  ({len(input_details)}):")
        for d in input_details:
            print(f"  [{d['index']}] shape={d['shape'].tolist():<30} dtype={dtype_name(d)}")

        print(f"\nOutputs ({len(output_details)}):")
        for d in output_details:
            print(f"  [{d['index']}] shape={d['shape'].tolist():<30} dtype={dtype_name(d)}")

        # Build random input tensors that match each input's declared shape & dtype
        for d in input_details:
            shape = d["shape"]
            np_dtype = np.dtype(d["dtype"])

            if np.issubdtype(np_dtype, np.floating):
                dummy = np.random.uniform(-1.0, 1.0, shape).astype(np_dtype)
            elif np.issubdtype(np_dtype, np.integer):
                info = np.iinfo(np_dtype)
                dummy = np.random.randint(info.min, info.max + 1, size=shape, dtype=np_dtype)
            else:
                dummy = np.zeros(shape, dtype=np_dtype)

            interpreter.set_tensor(d["index"], dummy)

        # Warm-up pass (excluded from timing)
        interpreter.invoke()

        # Timed pass
        start = time.perf_counter()
        interpreter.invoke()
        elapsed_ms = (time.perf_counter() - start) * 1000

        print(f"\nInference time: {elapsed_ms:.2f} ms")
        print(f"Status: {PASS}")
        return True

    except Exception as exc:
        print(f"\nError : {exc}")
        print(f"Status: {FAIL}")
        return False


def main() -> None:
    print(f"Models directory: {MODELS_DIR.resolve()}")

    results: dict[str, bool | None] = {}

    for model in MODELS:
        path = MODELS_DIR / model["filename"]
        ok = verify_model(path, model["label"])
        results[model["filename"]] = ok

    print(f"\n{'â•' * 60}")
    print("Summary")
    print(f"{'â•' * 60}")

    all_present_passed = True
    for model in MODELS:
        fname = model["filename"]
        path  = MODELS_DIR / fname
        if not path.exists():
            status = SKIP
        elif results[fname]:
            status = PASS
        else:
            status = FAIL
            all_present_passed = False
        print(f"  {status}  {fname}")

    print()
    if all_present_passed:
        print("All present models verified successfully.")
    else:
        print("One or more models FAILED verification.")
        raise SystemExit(1)


if __name__ == "__main__":
    main()
