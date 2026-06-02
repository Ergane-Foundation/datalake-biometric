#!/usr/bin/env python3
"""
Setup TFLite models for datalake-biometric.

Downloads BlazeFace and MobileFaceNet into:
  android/src/main/assets/models/

Usage:
    python ml_prep/setup_models.py
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
        "description": "Face detection (BlazeFace short-range, ~0.22 MB)",
    },
    {
        # MobileFaceNet trained for face recognition (112x112 -> embedding vector).
        # The model bundled in the verified build (BENCHMARKS.md) is the one from
        # MCarlomagno/FaceRecognitionAuth; download it manually if the URL below
        # has moved, following the instructions printed on failure.
        "url": (
            "https://github.com/MCarlomagno/FaceRecognitionAuth/raw/refs/heads/master/"
            "android/app/src/main/assets/mobilefacenet.tflite"
        ),
        "filename": "mobilefacenet_int8.tflite",
        "description": "Face embedding -- MobileFaceNet 112x112 (~5 MB)",
        "manual_instructions": (
            "Download MobileFaceNet manually:\n"
            "  Option A: https://github.com/MCarlomagno/FaceRecognitionAuth "
            "(android/app/src/main/assets/mobilefacenet.tflite)\n"
            "  Option B: convert from https://github.com/sirius-ai/MobileFaceNet_TF "
            "using tf.lite.TFLiteConverter\n"
            "Place the file at: android/src/main/assets/models/mobilefacenet_int8.tflite"
        ),
    },
    {
        # face_mesh is not loaded at runtime (liveness runs in JS via ML Kit).
        # Download the lite variant so the asset reference resolves at build time
        # without pulling in the full 3 MB task file.
        "url": (
            "https://storage.googleapis.com/mediapipe-models/face_landmarker/"
            "face_landmarker_lite/float16/1/face_landmarker_lite.tflite"
        ),
        "filename": "face_mesh.tflite",
        "description": "Face mesh landmarks -- unused at runtime (JS liveness path)",
    },
]


def _progress_hook(filename: str):
    """Print download progress."""
    def hook(block_count: int, block_size: int, total_size: int):
        downloaded = block_count * block_size
        if total_size > 0:
            pct = min(downloaded / total_size * 100, 100)
            bar = "#" * int(pct // 5)
            print(f"\r  [{bar:<20}] {pct:5.1f}%", end="", flush=True)
    return hook


def download_model(url: str, dest: Path) -> float:
    """Download model and return size in MB."""
    urllib.request.urlretrieve(url, dest, reporthook=_progress_hook(dest.name))
    print()
    size_mb = dest.stat().st_size / (1024 * 1024)
    print(f"  Size: {size_mb:.2f} MB")
    return size_mb


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    print("\n" + "=" * 70)
    print("Datalake Biometric - Model Setup")
    print("=" * 70)
    print(f"\nTarget: {OUTPUT_DIR.resolve()}\n")

    total_mb = 0.0
    success = 0

    for model in MODELS:
        dest = OUTPUT_DIR / model["filename"]

        if dest.exists():
            size_mb = dest.stat().st_size / (1024 * 1024)
            print(f"OK  {model['filename']} ({size_mb:.2f} MB) - already present")
            total_mb += size_mb
            success += 1
            continue

        print(f"Downloading {model['filename']}")
        print(f"   {model['description']}")
        print(f"   URL: {model['url']}")

        try:
            mb = download_model(model["url"], dest)
            total_mb += mb
            print(f"OK\n")
            success += 1
        except Exception as e:
            print(f"\nFAILED: {type(e).__name__}: {e}")
            if "manual_instructions" in model:
                print(f"\n  {model['manual_instructions']}\n")
            else:
                print(f"  Please download {model['filename']} manually and place it in:")
                print(f"  {dest}\n")

    print("=" * 70)
    print(f"{success}/{len(MODELS)} models ready ({total_mb:.2f} MB)")
    print("=" * 70)

    if success == len(MODELS):
        print("\nAll models ready for Android build!\n")
    else:
        failed = len(MODELS) - success
        print(f"\n{failed} model(s) failed to download.")
        print("Fix the URLs above or download manually before building.\n")
        raise SystemExit(1)


if __name__ == "__main__":
    main()
