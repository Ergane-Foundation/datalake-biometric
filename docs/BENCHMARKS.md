# Benchmarks

Only measured numbers are listed here, each with how and where it was measured.

## Model size

| File | Size |
|------|------|
| `blazeface.tflite` | 0.22 MB |
| `mobilefacenet.tflite` | 5.00 MB |
| Total | about 5.2 MB |

## Speed on phones

Measured with the example app's Benchmark screen, which shows `inferenceMs` (the
MobileFaceNet run) and `totalMs` (the whole native `verifyWorker` call: decoding,
quality score, face detection, alignment, embedding and the database search; not
the photo capture in JavaScript).

| Version | Device | OS | inferenceMs | totalMs |
|---------|--------|----|-------------|---------|
| 0.1.0 | Samsung Galaxy A17 (SM-A176B), Exynos 1330 | Android 14 | 28 to 33 ms | 413 to 576 ms |
| 0.2.0, ML Kit box passed | Samsung Galaxy A17 (SM-A176B) | Android 16 | median 29 ms (28 to 34, 5 runs) | median 147 ms (136 to 169, 5 runs) |
| 0.2.0, no box (BlazeFace on the whole frame) | Samsung Galaxy A17 (SM-A176B) | Android 16 | median 48 ms (31 to 82, 5 runs) | median 237 ms (171 to 287, 5 runs) |

Version 0.1.0 used a different pipeline (TensorFlow Lite 2.13, no alignment), so
its numbers do not describe the current code. The 0.2.0 rows are from the
good-light device test below (release build). Passing the face box is faster
because BlazeFace then only searches a small area around it.

## Device test: 0.2.0 on a Galaxy A17, release build

Single person, small sample. Not a benchmark: it shows the app works end to end
on one phone, and where it needs more testing.

- Device: Samsung Galaxy A17 (SM-A176B), Android 16, airplane mode on.
- Build: release APK from the "Release APK (test only, debug-signed)" workflow.

**Dim light fails the quality gate.** In dim light the frames score below the
`minQuality` cutoff of 0.5 and return `POOR_QUALITY` before any matching. In
even front light the same person matched in 9 of 10 attempts.

### Good front light (person wearing glasses)

| ML Kit box | Status | Similarity | Quality | inferenceMs | totalMs |
|------------|--------|------------|---------|-------------|---------|
| on | `MATCH` | 0.826 | 0.74 | 34 | 159 |
| on | `MATCH` | 0.962 | 0.78 | 28 | 147 |
| on | `MATCH` | 0.876 | 0.78 | 29 | 136 |
| on | `MATCH` | 0.893 | 0.81 | 29 | 140 |
| on | `MATCH` | 0.799 | 0.80 | 34 | 169 |
| off | `MATCH` | 0.962 | 0.79 | 42 | 240 |
| off | `MATCH` | 0.915 | 0.80 | 31 | 171 |
| off | `MATCH` (exaggerated pout) | 0.735 | 0.81 | 70 | 287 |
| off | `NO_MATCH` (exaggerated pout and head tilt) | not returned | 0.70 | 82 | 237 |
| off | `MATCH` | 0.916 | 0.80 | 48 | 231 |

Result: 9 of 10 `MATCH` (5 of 5 with the box, 4 of 5 without). The one
`NO_MATCH` reached the model (it has an inference time), so it was rejected by
the match threshold, not by the quality gate. The SDK returns a similarity only
for `MATCH`.

### Dim indoor light (ML Kit box on)

| Check | Result |
|-------|--------|
| Enroll one person | OK |
| 10 verifications of the enrolled person | 2 of 10 returned `MATCH` |
| Example `MATCH` | similarity 0.889, inferenceMs 34, totalMs 196, quality 0.50 |
| Same check on a debug build, for reference | similarity 0.968, inferenceMs 69, totalMs 329, quality 0.53 |
| Photos left on disk after enroll and verify | none (no `.jpg` or `.jpeg` in app storage) |
| Database encrypted | yes (first 16 bytes are random, not `SQLite format 3`) |
| People who are not enrolled are rejected | not yet verified on a device |
| Liveness against printed photos, screens, video | not yet verified on a device |
| Several faces, poor light, app restart | not yet verified on a device |

The statuses of the other 8 dim-light verifications were not recorded. The two
that passed had quality 0.50 and 0.53, right at the 0.5 cutoff, while every
good-light frame scored 0.70 to 0.81; with similarity 0.889 the match itself was
clear. Quality is a continuous score from 0 to 1 (not rounded or clamped except
to that range); the app shows it with two decimals. The score is computed on the
whole frame, so a dark background lowers it even when the face is lit; scoring
the aligned face instead is an open issue.

To contribute a measurement: build the example app in release mode, enroll one
person, run 10 verifications in normal indoor light, and report the median and
range of both numbers, with the device model, chipset and OS version.

## Accuracy

### Method

`ml_prep/calibrate_threshold.py` runs the bundled models on a computer with the
same preprocessing as the Android path without an app-provided face box:
BlazeFace, alignment to the 112x112 template, MobileFaceNet, cosine similarity.
It uses the Labeled Faces in the Wild (LFW) pairs protocol (6,000 pairs in 10
folds) and reports:

- 10-fold accuracy, the standard LFW measure;
- true accept rate (TAR) at false accept rates (FAR) of 1e-2, 1e-3 and 1e-4,
  computed from the protocol's same-person pairs against all different-person pairs
  among the same images (millions of pairs, so small FARs can be measured);
- the ROC curve and a recommended threshold for a target FAR.

Images where Android would answer `NO_FACE` or `MULTIPLE_FACES` are excluded
and counted. Accuracy does not depend on the phone, only the speed does.

### Results: LFW benchmark, likely an upper bound

These numbers are an upper bound on what to expect in the field, for two reasons:

- LFW photos are clean, mostly well-lit web photos of public figures, unlike
  phone photos taken outdoors or in poor light.
- The model's training data (MS-Celeb-1M) overlaps LFW identities, so the model
  may have seen many of these people before.

Run on 2026-10-06 with `ml_prep/calibrate_threshold.py` (model hashes as in
[MODELS.md](MODELS.md)). Every number below excludes the same images: **10.8% of
images (833 of 7,701) were excluded because a second face was visible**, which
Android would answer with `MULTIPLE_FACES`; no image was rejected for having no
face. That leaves 4,825 of 6,000 pairs (**19.6% of pairs excluded**): 2,376
same-person pairs and 23.6 million different-person pairs.

| Measure (10.8% of images, 19.6% of pairs excluded) | Result |
|----------------------------------------------------|--------|
| 10-fold accuracy | 99.28% (standard deviation 0.54) |
| TAR at FAR 1e-2 (threshold 0.350) | 99.12% |
| TAR at FAR 1e-3 (threshold 0.454) | 96.76% |
| TAR at FAR 1e-4 (threshold 0.533) | 93.31% |
| **At the default threshold 0.54** | **FAR 8.0e-5, TAR 92.97%** |

FAR is the false accept rate per comparison of two faces; TAR is the share of
same-person pairs accepted. 4,864 of the 7,701 LFW images (63%) score below the
default quality cutoff of 0.5, because they are small (250x250) web JPEGs; they
were counted but not excluded, so the quality gate does not affect these numbers.

### Default threshold

The default `matchThreshold` is **0.54**: the lowest threshold, rounded up to two
decimals, at which the measured FAR is at most **1e-4 per comparison**.

### Risk grows with the number of people enrolled

`verifyWorker` compares the photo with every enrolled person and returns the best
match. A person who is not enrolled is therefore falsely matched to *someone* with
probability `1 - (1 - FAR)^N`, which is about **N x FAR** while that is small. At
the default threshold (FAR 8.0e-5 on LFW):

| People enrolled (N) | About N x FAR | Chance a non-enrolled person matches someone |
|---------------------|---------------|----------------------------------------------|
| 10 | 0.08% | 0.08% |
| 100 | 0.8% | 0.80% |
| 1,000 | 8% | 7.7% |

For large groups, raise `matchThreshold` (a stricter threshold lowers FAR but
rejects more genuine attempts), split people into smaller groups per site or
device, or keep a person in the loop for decisions that matter. These figures are
from LFW, so real-world risk is likely higher.

### Why faces are aligned

An earlier pipeline cropped a box around the face without aligning it. On the
first 1,200 pairs (the same 10.8% of images and 19.0% of pairs excluded), it
reached 77.6% 10-fold accuracy and 16.7% TAR at FAR 1e-3, against 99.0% and 97.3%
with alignment on the same pairs. That comparison is why version 0.2.0 aligns
faces. iOS does not align yet, so none of these numbers apply to iOS.

### Re-running

```sh
python ml_prep/calibrate_threshold.py                     # FAR 1e-4 (default)
python ml_prep/calibrate_threshold.py --target-far 1e-5   # stricter
```

Measure on photos from your own users, cameras and lighting before relying on any
threshold.

## Liveness

Not formally evaluated. The liveness check is active challenge-response only: two
random actions out of blink, smile and head turn, each of which must start from
the opposite pose. It is designed to stop static photos; that has not yet been
verified on a device. It does not defend against video replays, deepfakes or
masks.

## Storage

Each enrolled person is one database row with a 192-value float template
(768 bytes) plus the ID and enrollment time, about 1 KB per person before SQLCipher
page overhead. The 1:N search is a linear scan over all templates.
