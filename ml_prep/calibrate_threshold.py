#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""
Calibrate the face-match threshold on the LFW pairs protocol.

Runs the SDK's own models (android/src/main/assets/models) with the same
preprocessing as the Android no-face-box path:

  JPEG -> BlazeFace on a letterboxed 128x128 input -> exactly one face required
  -> similarity transform that puts the eyes, nose and mouth keypoints on the
  112x112 template (FaceAligner.kt) -> scaled to [-1, 1] -> MobileFaceNet
  -> L2-normalized 192-d embedding -> cosine similarity

Images where Android would answer NO_FACE or MULTIPLE_FACES are excluded and
counted, so the numbers describe what the SDK would actually do.

Reports:
  1. LFW 10-fold accuracy (the standard protocol, 6000 pairs).
  2. TAR (true accept rate) at FAR (false accept rate) 1e-2, 1e-3 and 1e-4,
     using the 3000 genuine pairs from pairs.txt against ALL cross-identity
     pairs of the images involved (millions). With only the 3000 impostor pairs
     of the protocol, the smallest measurable FAR step is about 3.3e-4, so
     FAR 1e-4 could not be measured from them.
  3. The ROC curve (CSV, plus PNG if matplotlib is installed).
  4. A recommended threshold: the lowest threshold whose measured FAR is at or
     below --target-far (default 1e-4 per comparison), rounded up to 2 decimals.
     The SDK compares a probe with every enrolled template, so the chance of a
     false accept per verification grows with the number enrolled (N): roughly
     N x FAR when that product is small. The summary includes this for N = 10,
     100 and 1000.

Caveats, printed with the results:
  - LFW benchmark, likely an upper bound: LFW shows clean, well-lit web photos
    of public figures, and the model's training data (MS-Celeb-1M) overlaps
    LFW identities.
  - Resampling filters differ slightly from Android's Bitmap scaling.
  - Re-check any threshold on data from your own users and cameras.

Usage (from the repository root, Python 3.10+):
  python -m venv .venv
  .venv\\Scripts\\activate          (Windows)   or   source .venv/bin/activate
  pip install tensorflow pillow numpy matplotlib
  yarn setup:models
  python ml_prep/calibrate_threshold.py

The first run downloads LFW (about 180 MB, checked by SHA-256) into
ml_prep/.cache/, which git ignores. Results are written to
ml_prep/.cache/calibration/.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import platform
import sys
import tarfile
import time
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
MODELS_DIR = ROOT / "android" / "src" / "main" / "assets" / "models"
CACHE = ROOT / "ml_prep" / ".cache"

# Same files scikit-learn uses for LFW, with the same checksums.
LFW_ARCHIVE = ("https://ndownloader.figshare.com/files/5976018",
               "055f7d9c632d7370e6fb4afc7468d40f970c34a80d4c6f50ffec63f5a8d536c0")
LFW_PAIRS = ("https://ndownloader.figshare.com/files/5976006",
             "ea42330c62c92989f9d7c03237ed5d591365e89b3e649747777b70e692dc1592")

# --- Constants that must match the Android code --------------------------------
BLAZE_SIZE = 128          # BlazeFaceDecoder.INPUT_SIZE
BLAZE_STRIDES = [8, 16, 16, 16]
BLAZE_MIN_SCORE = 0.5
BLAZE_SCORE_CLIP = 100.0
BLAZE_NMS_IOU = 0.3
EMBED_SIZE = 112          # FaceAligner.SIZE
# FaceAligner.TEMPLATE: right eye, left eye, nose tip, mouth center (person's view).
TEMPLATE = np.array([[38.2946, 51.6963], [73.5318, 51.5014], [56.0252, 71.7366], [56.1396, 92.2848]])
MAX_SIDE = 720            # DatalakeBiometricModule.MAX_SIDE
DEFAULT_MIN_QUALITY = 0.5


# --- Downloads -------------------------------------------------------------------

def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def fetch(url: str, expected: str, target: Path) -> Path:
    if target.exists() and sha256(target) == expected:
        return target
    target.parent.mkdir(parents=True, exist_ok=True)
    print(f"Downloading {target.name} ...")
    temp = target.with_suffix(target.suffix + ".download")
    urllib.request.urlretrieve(url, temp)
    actual = sha256(temp)
    if actual != expected:
        temp.unlink()
        sys.exit(f"SHA-256 mismatch for {target.name}: expected {expected}, got {actual}")
    temp.replace(target)
    return target


def prepare_lfw() -> tuple[Path, Path]:
    lfw_dir = CACHE / "lfw"
    archive = fetch(*LFW_ARCHIVE, lfw_dir / "lfw.tgz")
    pairs = fetch(*LFW_PAIRS, lfw_dir / "pairs.txt")
    images = lfw_dir / "lfw"
    if not images.exists():
        print("Extracting LFW ...")
        with tarfile.open(archive) as tar:
            if sys.version_info >= (3, 12):
                tar.extractall(lfw_dir, filter="data")
            else:
                tar.extractall(lfw_dir)
    return images, pairs


def read_pairs(path: Path) -> list[tuple[int, str, str, bool]]:
    """Returns (fold, image_a, image_b, same_person) for the 6000 LFW pairs."""
    lines = path.read_text().strip().split("\n")
    folds, per_fold = (int(x) for x in lines[0].split())
    image = lambda name, n: f"{name}/{name}_{int(n):04d}.jpg"
    result = []
    i = 1
    for fold in range(folds):
        for _ in range(per_fold):
            name, a, b = lines[i].split()
            result.append((fold, image(name, a), image(name, b), True))
            i += 1
        for _ in range(per_fold):
            name_a, a, name_b, b = lines[i].split()
            result.append((fold, image(name_a, a), image(name_b, b), False))
            i += 1
    return result


# --- Models ----------------------------------------------------------------------

def load_interpreter(path: Path):
    try:
        from ai_edge_litert.interpreter import Interpreter
    except ImportError:
        try:
            import tensorflow as tf
            Interpreter = tf.lite.Interpreter
        except ImportError:
            sys.exit("Install a TFLite runtime: pip install tensorflow (or ai-edge-litert)")
    interpreter = Interpreter(model_path=str(path))
    interpreter.allocate_tensors()
    return interpreter


class BlazeFace:
    """Port of BlazeFaceDecoder.kt and BlazeFaceDetector.kt."""

    def __init__(self, interpreter):
        self.interp = interpreter
        self.input_index = interpreter.get_input_details()[0]["index"]
        outputs = interpreter.get_output_details()
        boxes_first = outputs[0]["shape"][-1] == 16
        self.boxes_index = outputs[0 if boxes_first else 1]["index"]
        self.scores_index = outputs[1 if boxes_first else 0]["index"]
        self.anchors = self._anchors()

    @staticmethod
    def _anchors() -> np.ndarray:
        result = []
        layer = 0
        while layer < len(BLAZE_STRIDES):
            stride = BLAZE_STRIDES[layer]
            per_cell, nxt = 0, layer
            while nxt < len(BLAZE_STRIDES) and BLAZE_STRIDES[nxt] == stride:
                per_cell += 2
                nxt += 1
            grid = (BLAZE_SIZE + stride - 1) // stride
            for y in range(grid):
                for x in range(grid):
                    result.extend([((x + 0.5) / grid, (y + 0.5) / grid)] * per_cell)
            layer = nxt
        return np.array(result, dtype=np.float32)

    def detect(self, img: Image.Image) -> list[np.ndarray]:
        """Returns the six keypoints (6x2, source pixels) of each face, best first."""
        w, h = img.size
        scale = min(BLAZE_SIZE / w, BLAZE_SIZE / h)
        pad_x = (BLAZE_SIZE - w * scale) / 2
        pad_y = (BLAZE_SIZE - h * scale) / 2
        canvas = Image.new("RGB", (BLAZE_SIZE, BLAZE_SIZE))
        scaled = img.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.BILINEAR)
        canvas.paste(scaled, (round(pad_x), round(pad_y)))
        x = (np.asarray(canvas, dtype=np.float32) / 127.5 - 1.0)[None]
        self.interp.set_tensor(self.input_index, x)
        self.interp.invoke()
        boxes = self.interp.get_tensor(self.boxes_index)[0]
        logits = self.interp.get_tensor(self.scores_index)[0][:, 0].astype(np.float64)

        scores = 1.0 / (1.0 + np.exp(-np.clip(logits, -BLAZE_SCORE_CLIP, BLAZE_SCORE_CLIP)))
        keep = np.nonzero(scores >= BLAZE_MIN_SCORE)[0]
        dets = []
        for i in keep:
            b = boxes[i]
            xc = b[0] / BLAZE_SIZE + self.anchors[i, 0]
            yc = b[1] / BLAZE_SIZE + self.anchors[i, 1]
            bw, bh = b[2] / BLAZE_SIZE, b[3] / BLAZE_SIZE
            kp = b[4:16].reshape(6, 2) / BLAZE_SIZE + self.anchors[i]
            dets.append((float(scores[i]), xc - bw / 2, yc - bh / 2, bw, bh, kp))

        result = []
        for *_, kp in self._weighted_nms(dets):
            # Model-input coordinates -> source pixels.
            result.append(np.stack([(kp[:, 0] * BLAZE_SIZE - pad_x) / scale,
                                    (kp[:, 1] * BLAZE_SIZE - pad_y) / scale], axis=1))
        return result

    @staticmethod
    def _iou(a, b) -> float:
        left, top = max(a[1], b[1]), max(a[2], b[2])
        right = min(a[1] + a[3], b[1] + b[3])
        bottom = min(a[2] + a[4], b[2] + b[4])
        inter = max(0.0, right - left) * max(0.0, bottom - top)
        union = a[3] * a[4] + b[3] * b[4] - inter
        return 0.0 if union <= 0 else inter / union

    def _weighted_nms(self, dets):
        remaining = sorted(dets, key=lambda d: -d[0])
        result = []
        while remaining:
            top = remaining[0]
            overlap = [d for d in remaining if d is top or self._iou(top, d) > BLAZE_NMS_IOU]
            remaining = [d for d in remaining if not (d is top or self._iou(top, d) > BLAZE_NMS_IOU)]
            total = sum(d[0] for d in overlap)
            avg = lambda f: sum(f(d) * d[0] for d in overlap) / total
            x0, y0 = avg(lambda d: d[1]), avg(lambda d: d[2])
            x1, y1 = avg(lambda d: d[1] + d[3]), avg(lambda d: d[2] + d[4])
            kp = sum(d[5] * d[0] for d in overlap) / total
            result.append((top[0], x0, y0, x1 - x0, y1 - y0, kp))
        return result


class MobileFaceNet:
    """Port of TFLiteEngine.alignFace and TFLiteEngine.embed (float32 model)."""

    def __init__(self, interpreter):
        self.interp = interpreter
        self.input_index = interpreter.get_input_details()[0]["index"]
        self.output_index = interpreter.get_output_details()[0]["index"]

    @staticmethod
    def similarity(src: np.ndarray, dst: np.ndarray = TEMPLATE):
        """Same closed form as FaceAligner.similarity: returns (a, b, tx, ty) or None."""
        ms, md = src.mean(0), dst.mean(0)
        p, q = src - ms, dst - md
        norm = (p * p).sum()
        if norm <= 1e-12:
            return None
        a = (p * q).sum() / norm
        b = (p[:, 0] * q[:, 1] - p[:, 1] * q[:, 0]).sum() / norm
        tx = md[0] - (a * ms[0] - b * ms[1])
        ty = md[1] - (b * ms[0] + a * ms[1])
        return a, b, tx, ty

    def align(self, img: Image.Image, keypoints: np.ndarray) -> Image.Image | None:
        t = self.similarity(keypoints[:4])
        if t is None:
            return None
        a, b, tx, ty = t
        # PIL wants the inverse map (output pixel -> input pixel).
        k = 1.0 / (a * a + b * b)
        ia, ib = a * k, b * k
        inverse = (ia, ib, -(ia * tx + ib * ty), -ib, ia, -(-ib * tx + ia * ty))
        return img.transform((EMBED_SIZE, EMBED_SIZE), Image.AFFINE, inverse, Image.BILINEAR)

    def embed(self, face: Image.Image) -> np.ndarray:
        x = (np.asarray(face, dtype=np.float32) / 127.5 - 1.0)[None]
        self.interp.set_tensor(self.input_index, x)
        self.interp.invoke()
        v = self.interp.get_tensor(self.output_index)[0].astype(np.float64)
        n = np.linalg.norm(v)
        return v / n if n > 0 else v


def quality_score(img: Image.Image) -> float:
    """Port of TFLiteEngine.scoreQuality (sharpness and exposure, 0..1)."""
    size = 256
    rgb = np.asarray(img.resize((size, size), Image.BILINEAR), dtype=np.float64)
    luma = 0.299 * rgb[..., 0] + 0.587 * rgb[..., 1] + 0.114 * rgb[..., 2]
    c = luma[1:-1, 1:-1]
    lap = 4 * c - luma[:-2, 1:-1] - luma[2:, 1:-1] - luma[1:-1, :-2] - luma[1:-1, 2:]
    mean_brightness = c.sum() / (size * size)
    exposure = 0.2 if (mean_brightness < 40 or mean_brightness > 220) else 1 - abs(mean_brightness - 130) / 130
    variance = float((lap * lap).mean())
    sharpness = variance / (variance + 500)
    return float(min(max(0.5 * sharpness + 0.5 * exposure, 0.0), 1.0))


def load_image(path: Path) -> Image.Image:
    img = Image.open(path).convert("RGB")
    longest = max(img.size)
    if longest > MAX_SIDE:
        s = MAX_SIDE / longest
        img = img.resize((round(img.size[0] * s), round(img.size[1] * s)), Image.BILINEAR)
    return img


# --- Metrics ---------------------------------------------------------------------

def tar_at_far(genuine: np.ndarray, impostor: np.ndarray, far: float):
    """Lowest threshold with measured FAR <= far, and the TAR there (accept if score >= threshold)."""
    imp = np.sort(impostor)
    allowed = int(math.floor(far * len(imp)))   # impostor accepts we may allow
    if allowed >= len(imp):
        threshold = float(imp[0])
    else:
        # Accept only scores strictly above the (allowed+1)-th highest impostor score.
        threshold = float(np.nextafter(imp[len(imp) - 1 - allowed], np.inf))
    measured_far = float((impostor >= threshold).mean())
    tar = float((genuine >= threshold).mean())
    return threshold, measured_far, tar


def ten_fold_accuracy(scores: np.ndarray, same: np.ndarray, folds: np.ndarray):
    grid = np.linspace(-1, 1, 2001)
    accs = []
    for f in np.unique(folds):
        train, test = folds != f, folds == f
        train_acc = [((scores[train] >= t) == same[train]).mean() for t in grid]
        best = grid[int(np.argmax(train_acc))]
        accs.append(((scores[test] >= best) == same[test]).mean())
    return float(np.mean(accs)), float(np.std(accs))


# --- Main ------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--target-far", type=float, default=1e-4,
                        help="Per-comparison FAR for the recommended threshold (default 1e-4)")
    parser.add_argument("--limit", type=int, default=0, help="Use only the first N pairs (quick smoke test)")
    parser.add_argument("--out", type=Path, default=CACHE / "calibration", help="Output folder")
    args = parser.parse_args()

    images_dir, pairs_path = prepare_lfw()
    pairs = read_pairs(pairs_path)
    if args.limit:
        pairs = pairs[: args.limit]

    detector = BlazeFace(load_interpreter(MODELS_DIR / "blazeface.tflite"))
    embedder = MobileFaceNet(load_interpreter(MODELS_DIR / "mobilefacenet.tflite"))

    names = sorted({p for pair in pairs for p in pair[1:3]})
    embeddings: dict[str, np.ndarray] = {}
    outcome = {"no_face": 0, "multiple_faces": 0, "low_quality": 0}
    start = time.time()
    for i, name in enumerate(names, 1):
        img = load_image(images_dir / name)
        if quality_score(img) < DEFAULT_MIN_QUALITY:
            outcome["low_quality"] += 1  # counted only; LFW frames are not excluded for quality
        faces = detector.detect(img)
        if len(faces) == 0:
            outcome["no_face"] += 1
            continue
        if len(faces) > 1:
            outcome["multiple_faces"] += 1
            continue
        crop = embedder.align(img, faces[0])
        if crop is None:
            outcome["no_face"] += 1
            continue
        embeddings[name] = embedder.embed(crop)
        if i % 500 == 0:
            print(f"  {i}/{len(names)} images, {time.time() - start:.0f} s")

    usable = [p for p in pairs if p[1] in embeddings and p[2] in embeddings]
    scores = np.array([float(embeddings[a] @ embeddings[b]) for _, a, b, _ in usable])
    same = np.array([s for *_, s in usable])
    folds = np.array([f for f, *_ in usable])
    genuine = scores[same]

    # All cross-identity pairs among the embedded images.
    keys = sorted(embeddings)
    ids = np.array([k.split("/")[0] for k in keys])
    matrix = np.stack([embeddings[k] for k in keys]).astype(np.float32)
    impostor_chunks = []
    for i in range(0, len(keys), 512):
        block = matrix[i:i + 512] @ matrix.T
        rows = np.arange(i, min(i + 512, len(keys)))[:, None]
        cols = np.arange(len(keys))[None, :]
        mask = (cols > rows) & (ids[rows] != ids[cols][0])
        impostor_chunks.append(block[mask])
    impostor = np.concatenate(impostor_chunks).astype(np.float64)

    acc_mean, acc_std = ten_fold_accuracy(scores, same, folds) if len(np.unique(folds)) > 1 else (float("nan"), 0.0)
    far_rows = []
    for far in (1e-2, 1e-3, 1e-4):
        thr, measured, tar = tar_at_far(genuine, impostor, far)
        far_rows.append({"far_target": far, "threshold": thr, "far_measured": measured, "tar": tar})
    rec_thr, rec_far, rec_tar = tar_at_far(genuine, impostor, args.target_far)
    recommended = math.ceil(rec_thr * 100) / 100
    # Measured at the rounded threshold the SDK will actually use.
    final_far = float((impostor >= recommended).mean())
    final_tar = float((genuine >= recommended).mean())
    # Chance that a probe of a non-enrolled person matches someone among N:
    # 1 - (1 - FAR)^N, which is about N x FAR while that is small.
    one_to_n = {str(n): 1 - (1 - final_far) ** n for n in (10, 100, 1000)}
    excluded_images = outcome["no_face"] + outcome["multiple_faces"]

    args.out.mkdir(parents=True, exist_ok=True)
    grid = np.round(np.arange(-0.2, 1.0001, 0.005), 3)
    imp_sorted, gen_sorted = np.sort(impostor), np.sort(genuine)
    with (args.out / "roc.csv").open("w") as f:
        f.write("threshold,far,tar\n")
        for t in grid:
            far = 1 - np.searchsorted(imp_sorted, t, side="left") / len(imp_sorted)
            tar = 1 - np.searchsorted(gen_sorted, t, side="left") / len(gen_sorted)
            f.write(f"{t:.3f},{far:.8f},{tar:.6f}\n")
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        far_curve = [1 - np.searchsorted(imp_sorted, t) / len(imp_sorted) for t in grid]
        tar_curve = [1 - np.searchsorted(gen_sorted, t) / len(gen_sorted) for t in grid]
        plt.figure(figsize=(6, 4))
        plt.semilogx(np.maximum(far_curve, 1e-7), tar_curve)
        plt.xlabel("False accept rate")
        plt.ylabel("True accept rate")
        plt.title("LFW ROC, datalake-biometric pipeline")
        plt.grid(True, which="both", alpha=0.3)
        plt.tight_layout()
        plt.savefig(args.out / "roc.png", dpi=150)
    except ImportError:
        pass

    summary = {
        "dataset": "LFW, pairs.txt (10 folds x 600 pairs)",
        "pairs_total": len(pairs),
        "pairs_used": len(usable),
        "genuine_pairs": int(same.sum()),
        "impostor_pairs_protocol": int((~same).sum()),
        "impostor_pairs_all_cross_identity": int(len(impostor)),
        "images": len(names),
        "images_excluded": outcome,
        "image_exclusion_rate": excluded_images / len(names),
        "pair_exclusion_rate": 1 - len(usable) / len(pairs),
        "ten_fold_accuracy_mean": acc_mean,
        "ten_fold_accuracy_std": acc_std,
        "tar_at_far": far_rows,
        "recommended_threshold": recommended,
        "recommended_for_far": args.target_far,
        "recommended_far_measured": final_far,
        "recommended_tar_measured": final_tar,
        "one_to_n_false_accept_probability": one_to_n,
        "model_sha256": {
            "blazeface.tflite": sha256(MODELS_DIR / "blazeface.tflite"),
            "mobilefacenet.tflite": sha256(MODELS_DIR / "mobilefacenet.tflite"),
        },
        "python": platform.python_version(),
        "seconds": round(time.time() - start, 1),
    }
    (args.out / "summary.json").write_text(json.dumps(summary, indent=2))

    print("\n=== Results (LFW, datalake-biometric Android pipeline) ===")
    print(f"Images: {len(names)}, excluded: {outcome['no_face']} no face, {outcome['multiple_faces']} several faces "
          f"({excluded_images / len(names) * 100:.1f}%)")
    print(f"Images below quality {DEFAULT_MIN_QUALITY} (counted, not excluded): {outcome['low_quality']}")
    print(f"Pairs used: {len(usable)} of {len(pairs)} ({(1 - len(usable) / len(pairs)) * 100:.1f}% excluded)")
    print(f"10-fold accuracy: {acc_mean * 100:.2f}% (std {acc_std * 100:.2f})")
    print(f"Genuine pairs: {len(genuine)}, impostor pairs (all cross-identity): {len(impostor)}")
    for row in far_rows:
        print(f"  FAR {row['far_target']:.0e}: threshold {row['threshold']:.4f}, "
              f"measured FAR {row['far_measured']:.2e}, TAR {row['tar'] * 100:.2f}%")
    print(f"Recommended threshold for FAR {args.target_far:.0e}: {recommended:.2f} "
          f"(measured there: FAR {final_far:.2e}, TAR {final_tar * 100:.2f}%)")
    for n, p in one_to_n.items():
        print(f"  Non-enrolled person falsely matched with N={n} enrolled: {p * 100:.2f}%")
    print(f"Files: {args.out}")
    print("\nLFW benchmark, likely an upper bound: clean web photos, and the model's training")
    print("data (MS-Celeb-1M) overlaps LFW identities. Re-check on your own data.")


if __name__ == "__main__":
    main()
