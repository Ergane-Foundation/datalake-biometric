# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Before 1.0, minor
versions may contain breaking changes.

## [Unreleased]

## [0.2.0] - not released yet

### Breaking

- `logAttendance(workerId, confidence, location?)` replaces
  `logAttendance(workerId, latitude, longitude, confidence)`. The location is
  optional; records without one have no `latitude` and `longitude`.
- Existing installs are reset once on upgrade: the old key store and the database
  it protected are deleted, because the new key handling cannot read the old
  keys. Enroll everyone again after upgrading.
- Face templates from 0.1.0 are not comparable with 0.2.0 templates (faces are
  now aligned before embedding). This is covered by the reset above.
- License changed from MIT to Apache-2.0.
- The model file is now `mobilefacenet.tflite` (it was wrongly named
  `mobilefacenet_int8.tflite`). Run `yarn setup:models`.

### Added

- Face alignment with BlazeFace keypoints before embedding. On a preliminary LFW
  subset, 10-fold accuracy went from 77.6% to 99.0% with the same model.
- BlazeFace face detection on Android when no face box is passed;
  `MULTIPLE_FACES` status when several faces are visible.
- Liveness session in the SDK (`createLivenessState`, `updateLiveness`,
  `pickChallenges`, `expireLiveness`): two random challenges, start-pose checks,
  multi-face rejection, timeout. Active challenge-response only: it defeats static
  photos but not video replay, deepfakes or masks.
- `BiometricSDK.createSecureRandomInt()` and the native `getSecureRandomBytes`,
  because React Native has no `crypto.getRandomValues`.
- `initialize({ matchThreshold, minQuality })`.
- Default `matchThreshold` is now 0.54 (was 0.65), calibrated on the LFW benchmark
  for a false accept rate of 1e-4 per comparison: 99.28% 10-fold accuracy, TAR
  92.97% at the default, with 10.8% of images (19.6% of pairs) excluded for a second
  visible face. LFW is likely an upper bound. The 1:N false-match risk grows with
  the number enrolled (about N x FAR); see docs/BENCHMARKS.md.
- `deviceId` in attendance records; versioned signature payload that is the same
  on Android and iOS.
- `yarn setup` (models with SHA-256 checks, debug keystore) and
  `yarn lint:encoding`.
- `ml_prep/calibrate_threshold.py`: runs the Android pipeline on the LFW pairs
  protocol and reports accuracy, TAR at FAR, the ROC curve and a threshold.
- Token authorizer, rate limits and tests for the optional sync backend;
  manual-only, OpenID Connect deploy workflow.
- Unit tests for JavaScript, Kotlin and the backend; example app tests in CI.
- Documentation: architecture, benchmarks, models, privacy, security model.

### Changed

- Android uses LiteRT 1.4.2 and `sqlcipher-android` 4.19.1. All native libraries
  are 16 KB page aligned, as Google Play requires for Android 15+.
- Android keys: a non-exportable Android Keystore AES-GCM key now protects the
  database passphrase and signing key (replaces the deprecated
  `androidx.security:security-crypto`).
- iOS: separate Keychain secrets for the database and signing, database moved to
  Application Support and excluded from backup, startup check that SQLCipher is
  really linked, face box required.
- Errors reach JavaScript with stable codes instead of being swallowed.
- Minimum iOS version is 15.1 for the library (15.5 for the example app).

### Fixed

- The example app's head-turn challenge could never pass: it read a yaw field the
  face detector does not provide.
- Photos written to the cache by the camera library were never deleted.
- The native module never closed its interpreters.
- Worker IDs were written to the Android log.
- `ml_prep/verify_models.py` crashed on every run.
- Broken root `build:web` script; example tests that never ran.
- Byte order marks and garbled characters in 51 files.

### Removed

- `ml_prep/setup_models.py` and `ml_prep/download_models.py` (replaced by
  `yarn setup:models`).
- The unused Face Mesh placeholder model.

## [0.1.0]

First version.
