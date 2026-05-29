"""
Download TFLite models required by datalake-biometric into
android/src/main/assets/models/.

Usage:
    python ml_prep/download_models.py
"""

import os
import urllib.request
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent.resolve()
OUTPUT_DIR = SCRIPT_DIR / ".." / "android" / "src" / "main" / "assets" / "models"

MODELS = [
    {
        "url": (
            "https://storage.googleapis.com/mediapipe-models/face_detector/"
            "blaze_face_short_range/float16/1/blaze_face_short_range.tflite"
        ),
        "filename": "blazeface.tflite",
    },
    {
        "url": (
            "https://storage.googleapis.com/mediapipe-models/face_landmarker/"
            "face_landmarker/float16/1/face_landmarker.task"
        ),
        "filename": "face_mesh.tflite",
    },
]


def _progress_hook(filename: str):
    """Return a urllib reporthook that prints a single progress line."""
    def hook(block_count: int, block_size: int, total_size: int):
        downloaded = block_count * block_size
        if total_size > 0:
            pct = min(downloaded / total_size * 100, 100)
            bar = "#" * int(pct // 5)
            print(f"\r  [{bar:<20}] {pct:5.1f}%", end="", flush=True)
    return hook


def download_model(url: str, dest: Path) -> float:
    """Download *url* to *dest*, return file size in MB."""
    print(f"  URL : {url}")
    print(f"  Dest: {dest}")
    urllib.request.urlretrieve(url, dest, reporthook=_progress_hook(dest.name))
    print()  # newline after progress bar
    size_mb = dest.stat().st_size / (1024 * 1024)
    print(f"  Size: {size_mb:.2f} MB")
    return size_mb


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Output directory: {OUTPUT_DIR.resolve()}\n")

    total_mb = 0.0

    for model in MODELS:
        dest = OUTPUT_DIR / model["filename"]
        print(f"Downloading {model['filename']} ...")
        try:
            mb = download_model(model["url"], dest)
            total_mb += mb
            print(f"  OK\n")
        except Exception as exc:
            print(f"\n  FAILED: {exc}\n")

    print(f"Total downloaded: {total_mb:.2f} MB")
    print()
    print("=" * 60)
    print("MANUAL DOWNLOAD REQUIRED: mobilefacenet_int8.tflite")
    print("=" * 60)
    print(
        "MobileFaceNet must be downloaded (and optionally quantised to int8)\n"
        "from the official repository, then placed in:\n"
        f"  {(OUTPUT_DIR / 'mobilefacenet_int8.tflite').resolve()}\n"
        "\n"
        "Source / conversion instructions:\n"
        "  https://github.com/sirius-ai/MobileFaceNet_TF\n"
        "\n"
        "Quick-start: clone the repo, export the SavedModel, then run:\n"
        "  python -m tf_lite_converter \\\n"
        "    --saved_model_dir=<export_dir> \\\n"
        "    --output_file=mobilefacenet_int8.tflite \\\n"
        "    --optimizations=DEFAULT \\\n"
        "    --inference_type=INT8"
    )


if __name__ == "__main__":
    main()
