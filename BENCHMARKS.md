# Benchmarks

Performance characteristics of the `datalake-biometric` on-device pipeline.

All measurements are taken on the actual integration target — a mid-range
Android phone — not on an emulator. Numbers fill in as device data is captured
from the in-app **Benchmark** screen, which reads `inferenceMs` and `totalMs`
from the most recent `verifyWorker` call.

## Design targets

| Constraint                              | Target              | Our budget                  |
|-----------------------------------------|---------------------|-----------------------------|
| Total ML model size                     | < 20 MB             | **~5.2 MB** (74 % headroom) |
| End-to-end verify latency               | < 1000 ms           | see table below             |
| Minimum Android target                  | Android 8.0 (API 26)| API 26                      |
| Reference SoC                           | Snapdragon 600-series, 3 GB RAM | same             |

## Model footprint (on disk, inside the APK)

| File                                                          | Role                                | Size      | Real / stub |
|---------------------------------------------------------------|-------------------------------------|-----------|-------------|
| `android/src/main/assets/models/blazeface.tflite`             | Face detection (128×128 → boxes)    | 0.22 MB   | real (MediaPipe `blaze_face_short_range`) |
| `android/src/main/assets/models/mobilefacenet_int8.tflite`    | Face embedding (112×112 → N-dim)    | 5.00 MB   | real (`MCarlomagno/FaceRecognitionAuth`, 112×112, float) |
| `android/src/main/assets/models/face_mesh.tflite`             | (Unused — liveness runs in JS)      | stub      | placeholder |
| **Total bundled**                                             |                                     | **~5.2 MB** | ✓ < 20 MB |

> Note on `face_mesh.tflite`: the original design used MediaPipe Face Mesh for
> EAR-based liveness. The demo instead uses ML Kit `leftEyeOpenProbability` /
> `rightEyeOpenProbability` (via the Vision Camera frame processor) for blink
> detection, which avoids the 468-landmark dependency on RN and is the path
> the Verify screen actually exercises. The native `LivenessEngine` + EAR code
> still ships and can be wired in if a 468-landmark JS source is added.

## Verify pipeline stages

| #   | Stage                          | Where it runs                | What it costs            |
|-----|--------------------------------|------------------------------|--------------------------|
| 1   | Quality gate                   | Native (Laplacian + exposure)| O(W·H) per frame         |
| 2   | Face detect                    | Native (BlazeFace, XNNPACK)  | one TFLite forward pass  |
| 3   | Crop + resize to 112×112       | Native (`Bitmap.createScaledBitmap`) | one bitmap op    |
| 4   | Embed                          | Native (MobileFaceNet, XNNPACK) | one TFLite forward pass |
| 5   | L2-normalize                   | Native (Kotlin)              | O(D), D = embedding dim  |
| 6   | DB match (cosine ≡ dot)        | Native + SQLCipher           | O(N · D), N = enrolled   |

## Measured latencies

Captured on 2026-05-30 from the in-app **Benchmark** screen and `adb logcat -s
DatalakeBM:V` running while a single user (DHRUV) Verified repeatedly.

| Device              | Android | SoC                  | inferenceMs | totalMs |
|---------------------|---------|----------------------|-------------|---------|
| Samsung Galaxy A17 (SM-A176B) | 14 (target API 36 build) | Exynos 1330 (mid-range) | **28–31 ms** | **413–576 ms** |

Per-stage breakdown (Welford-averaged across 4 warm Verify runs, derived from
adb log timestamps + the in-app counters):

| Stage                          | Latency       |
|--------------------------------|---------------|
| JPEG decode + EXIF rotation    | ~13 ms        |
| `downscaleForProcessing` (12 MP → 540×720) | ~1 ms |
| `scoreQuality` (256×256 streaming Welford) | ~5 ms |
| `detectAndCrop` (MLKit hint → 112×112)     | ~1 ms |
| `embed` (MobileFaceNet TFLite + XNNPACK)   | **28–31 ms** |
| `findMatch` over 2 enrolled embeddings     | <1 ms |
| **Total pipeline (`totalMs`)** | **413–576 ms** |

Notes:

- `totalMs` includes the Vision Camera `takePhoto` and base64 read on the JS
  side as well, which dominate (~350 ms). The pure native pipeline (after
  base64 arrives) runs in **~50 ms**.
- Quality scores (`scoreQuality` blended blur+exposure) are **0.77–0.89** in
  normal indoor light — well above the 0.5 POOR_QUALITY threshold.
- Match similarity (cosine) for the same person across pose/expression:
  **0.56–0.96** (threshold 0.5 → MATCH). For a different face: **0.012**
  (well below threshold → NO_MATCH). Spoof rejection works at liveness layer
  before the embedding is even computed.

## Memory footprint

| Component                      | Approx. resident size |
|--------------------------------|-----------------------|
| BlazeFace interpreter          | < 2 MB                |
| MobileFaceNet interpreter      | ~ 8 MB                |
| Per-frame bitmap buffer (112×112×3×4 B) | 150 KB       |
| Per-frame quality buffer       | depends on input bitmap |
| SQLCipher page cache (default) | 2 MB                  |

## Storage scaling

Each enrolled worker = one row in `embeddings`:

- `worker_id` text (≤ 32 B)
- `embedding` BLOB = D × 4 B (≈ 768 B for 192-dim, ≈ 2 KB for 512-dim)
- `enrolled_at` INTEGER (8 B)

→ **~1 KB per enrolled worker.** Ten thousand workers fit in ~10 MB encrypted.

Each queued attendance record adds ~250 B (worker id, timestamp, lat/lng,
confidence, device id, base64 HMAC signature, sync flag).
