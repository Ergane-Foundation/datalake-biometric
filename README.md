# Faceproof

[![CI](https://github.com/Ergane-Foundation/faceproof/actions/workflows/ci.yml/badge.svg)](https://github.com/Ergane-Foundation/faceproof/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/faceproof)](https://www.npmjs.com/package/faceproof)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

Open-source offline face verification and liveness SDK for React Native.
No cloud API, no per-call cost, biometric data never leaves the device.

Made for places with weak or no internet: attendance at remote field sites or
schools with poor connectivity, event and kiosk check-in, hostel or site entry,
and agent verification for cooperatives.

## Status

Pre-release. Not yet published to npm.

| Platform | Status |
|----------|--------|
| Android | Supported (API 24+). Enrollment, verification, encryption and photo cleanup checked on one physical device; impostor rejection and liveness against spoofs not yet verified on a device. |
| iOS | Experimental. Compiles in CI but is not tested on a device, and needs a Core ML model that is not included. |

**iOS and Android templates are not comparable.** Android aligns each face before
embedding it; iOS does not yet (open issue "Port face alignment to iOS").
Until it does, do not enroll on one platform and verify on the other, and expect
much lower accuracy on iOS.

The default match threshold (0.54) is calibrated on the LFW benchmark, which is
likely an upper bound; see [Benchmarks](#benchmarks).

## Features

- **On-device face detection and alignment** with BlazeFace. Optionally pass a
  face box from your own detector (for example ML Kit) to choose the face.
- **Face embedding** with MobileFaceNet (192 values) and 1:N matching against
  everyone enrolled.
- **Active liveness**: two random challenges out of blink, smile and head turn.
  This is challenge-response only. It is designed to stop static photos (not yet
  verified on a device); it does not defend against video replay, deepfakes or
  masks.
- **Encrypted storage**: SQLCipher (AES-256), keys protected by the Android Keystore.
- **Offline attendance queue**: signed records, optional location, and an optional
  self-hosted [sync backend](backend/README.md) for AWS.
- **No images stored or logged** by the SDK.

## Quick start

The fastest way to see it working is the example app on an Android phone.

Requirements: Node 24, Yarn (via Corepack), JDK 17, Android SDK with platform 36.

```sh
git clone https://github.com/Ergane-Foundation/faceproof.git
cd faceproof
yarn install
yarn setup            # download and verify the models, create a debug keystore
yarn example android  # with a phone connected over USB
```

To try it without a build setup, maintainers can run the "Release APK (test
only, debug-signed)" workflow in the Actions tab; it uploads an
`example-release-apk` artifact for arm64 phones. It is a test build signed
with a throwaway debug key, not a published release.

## Models

The models are not stored in git. `yarn setup:models` downloads them and checks
each file against a fixed SHA-256 hash:

| File | Purpose | Size | License |
|------|---------|------|---------|
| `blazeface.tflite` | Face detection and keypoints | 0.22 MB | Apache-2.0 |
| `mobilefacenet.tflite` | Face embedding | 5.0 MB | BSD-3-Clause (source repository) |

Read [docs/MODELS.md](docs/MODELS.md) before production use: it explains where
the embedding model comes from and why its training data is a concern.

## Usage

```ts
import {
  BiometricSDK,
  createLivenessState,
  pickChallenges,
  updateLiveness,
} from 'faceproof';

// Once, at app start.
await BiometricSDK.initialize();

// Enroll: a few JPEG frames as base64 strings. The face box (normalized 0..1)
// is optional; without it the SDK finds the single face in the frame.
await BiometricSDK.enrollWorker('EMP-1042', [frame1, frame2, frame3], faceBox);

// Liveness: pick two random challenges, then feed one observation per camera frame.
const random = await BiometricSDK.createSecureRandomInt();
let session = createLivenessState(pickChallenges(2, random), {}, Date.now());
session = updateLiveness(session, {
  faceCount: 1,
  leftEyeOpenProbability: 0.9,
  rightEyeOpenProbability: 0.9,
  smilingProbability: 0.1,
  headYawDegrees: 2,
  timestampMs: Date.now(),
});

// After session.status === 'PASSED', take a photo and verify.
const result = await BiometricSDK.verifyWorker(photoBase64, faceBox);
// { status: 'MATCH', workerId: 'EMP-1042', confidence: 0.82, inferenceMs, totalMs, quality }

if (result.status === 'MATCH') {
  // Location is optional.
  await BiometricSDK.logAttendance(result.workerId!, result.confidence!);
}

// Later, upload pending records to your backend, then:
const pending = await BiometricSDK.getPendingRecords();
await BiometricSDK.markSynced(pending.map((r) => r.id));
await BiometricSDK.purgeSyncedRecords();
```

`verifyWorker` returns `MATCH`, `NO_MATCH`, `NO_FACE`, `MULTIPLE_FACES` or
`POOR_QUALITY`. Errors reject with stable codes listed in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#error-codes).

The [example app](example/) shows the complete flow with Vision Camera and ML Kit,
including deleting the camera's temporary photo file right after use.

Tips for reliable results:

- Verify in even light from the front. In dim light most photos fail the quality
  check (`POOR_QUALITY`); ask the person to move to better light and try again.
- Pass the face box from your camera's face detector (for example ML Kit) when you
  have one. On Android it selects which face to use and made verification faster
  in our test (median 147 ms against 237 ms without a box). See
  [docs/BENCHMARKS.md](docs/BENCHMARKS.md#device-test-020-on-a-galaxy-a17-release-build).

## Configuration

| Option | Default | Meaning |
|--------|---------|---------|
| `initialize({ matchThreshold })` | 0.54 | Minimum cosine similarity for a match. Chosen for a false accept rate of 1e-4 per comparison on LFW. |
| `initialize({ minQuality })` | 0.5 | Minimum blur and exposure score before matching (Android). |
| `createLivenessState(challenges, config)` | see `DEFAULT_LIVENESS_CONFIG` | Timeout and detector thresholds for liveness. |

## How it works

On Android, each photo is decoded in memory, checked for blur and exposure, and
searched for faces with BlazeFace. The face is aligned so its eyes, nose and mouth
sit at fixed positions, embedded with MobileFaceNet, and compared with every
stored template. Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Benchmarks

- **On a phone (0.2.0, release build, Samsung Galaxy A17, one person, small
  sample):**

  | Light | ML Kit box | Result | Median model time | Median total |
  |-------|------------|--------|-------------------|--------------|
  | Even front light | on | 5 of 5 `MATCH` | 29 ms | 147 ms |
  | Even front light | off | 4 of 5 `MATCH` | 48 ms | 237 ms |
  | Dim indoor | on | 2 of 10 `MATCH` | | |

  Dim light fails the quality gate: frames score below the 0.5 cutoff and are
  rejected as `POOR_QUALITY` before matching. Impostor rejection and spoof
  resistance are not yet verified on a device.
- **Accuracy (LFW benchmark, likely an upper bound):** 99.28% 10-fold accuracy;
  at the default threshold 0.54, FAR 8.0e-5 per comparison and TAR 92.97%. 10.8%
  of images (19.6% of pairs) were excluded because a second face was visible.
  It is an upper bound because LFW photos are clean web photos and the model's
  training data (MS-Celeb-1M) overlaps LFW identities.
- **1:N risk:** each verification is compared with everyone enrolled, so the chance
  that a non-enrolled person matches someone is about N x FAR:

  | People enrolled | Chance of a false match (at 0.54, LFW) |
  |-----------------|----------------------------------------|
  | 10 | 0.08% |
  | 100 | 0.8% |
  | 1,000 | 7.7% |

  For large groups, raise the threshold or split people into smaller groups.

Method, numbers and caveats: [docs/BENCHMARKS.md](docs/BENCHMARKS.md).

## Privacy and security

The SDK makes no network calls and never stores images. Templates are still
biometric data, and you remain responsible for consent and retention.

The example app is different: its face detector is Google ML Kit, which keeps a
local queue of usage logs (`com.google.android.datatransport.events`) and sends
them to Google when the phone is online. Google states these are API usage and
performance metrics, not images. Details and options:
[docs/PRIVACY.md](docs/PRIVACY.md#the-example-app-and-ml-kit).

- [docs/PRIVACY.md](docs/PRIVACY.md): notes for app developers (not legal advice)
- [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md): what is protected, and the limits
- [SECURITY.md](SECURITY.md): how to report a vulnerability privately

## Roadmap

- Validate the match threshold on field-like data (phones, outdoor light, diverse faces).
- Measure speed on a range of Android phones.
- Make iOS work: embedding model and face alignment, tested on a device.
- Replace the embedding model with one trained on consented data.
- Passive anti-spoofing to complement the active liveness check.
- Server-side signature verification with per-device keys.
- First npm release.

## Contributing

Contributions are welcome, from documentation fixes to native code. Start with
[CONTRIBUTING.md](CONTRIBUTING.md) and look for issues labelled
`good first issue`. Please follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

[Apache License 2.0](LICENSE). See [NOTICE](NOTICE) and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for third-party components,
including the separately downloaded models.

Created by Dhruv Goyal and Vaani Prashar.
