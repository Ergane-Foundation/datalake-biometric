# datalake-biometric

Offline facial recognition and liveness detection for React Native.

Embeds workers' faces on-device (MobileFaceNet INT8, ~5 MB), persists encrypted embeddings with SQLCipher (AES-256), and syncs HMAC-signed attendance records to AWS — all without a camera frame ever leaving the phone.

## Installation

```sh
npm install datalake-biometric
```

Peer dependencies required in the host app:
```sh
npm install react-native-vision-camera react-native-vision-camera-face-detector react-native-worklets-core react-native-blob-util @react-native-community/netinfo
```

## Android setup

Place model files in `android/src/main/assets/models/` before building (see [Model Download](#model-download)).

## Quick Start

```typescript
import { BiometricSDK } from 'datalake-biometric';

// 1. Initialize once — loads TFLite models and opens the encrypted DB
await BiometricSDK.initialize();

// 2. Enroll — capture 3+ base64 JPEG frames; pass an optional MLKit face-box hint
const result = await BiometricSDK.enrollWorker('W-1042', [frame1, frame2, frame3]);
// → { success: true, framesUsed: 3 }

// 3. Verify — 1-N matching; returns MATCH | NO_MATCH | POOR_QUALITY | NO_FACE
const verify = await BiometricSDK.verifyWorker(base64Frame);
// → { status: 'MATCH', workerId: 'W-1042', confidence: 0.82, inferenceMs: 32, totalMs: 435 }

// 4. Liveness — native EAR blink counter for 468-point MediaPipe landmarks
const liveness = await BiometricSDK.checkLiveness(landmarks);
// → { isLive: true, isBlink: true, blinkCount: 2, earValue: 0.15 }

// 5. Log attendance locally — HMAC-signed, queued for sync
await BiometricSDK.logAttendance('W-1042', 28.7041, 77.1025, 0.87);

// 6. Sync pending records (after server confirms, mark them synced)
const pending = await BiometricSDK.getPendingRecords();
// POST `pending` to your endpoint, then:
await BiometricSDK.markSynced(pending.map(r => r.id));
```

## API Reference

| Method | Returns | Description |
|--------|---------|-------------|
| `initialize()` | `Promise<boolean>` | Load TFLite models, open SQLCipher DB |
| `enrollWorker(id, frames[], hint?)` | `Promise<EnrollResult>` | Average embeddings from multiple frames and store |
| `verifyWorker(frame, hint?)` | `Promise<VerifyResult>` | Quality gate + 1-N face match |
| `checkLiveness(landmarks)` | `Promise<LivenessResult>` | EAR blink counter on 468-pt MediaPipe landmarks |
| `logAttendance(id, lat, lng, conf)` | `Promise<boolean>` | HMAC-sign and queue an attendance record |
| `getPendingRecords()` | `Promise<AttendanceRecord[]>` | Returns all unsynced attendance records |
| `markSynced(ids[])` | `Promise<boolean>` | Mark records synced after server acknowledgement |

### Types

```typescript
type VerifyStatus = 'MATCH' | 'NO_MATCH' | 'NO_FACE' | 'POOR_QUALITY';

interface VerifyResult {
  status: VerifyStatus;
  workerId?: string;
  confidence?: number;   // cosine similarity (0–1)
  inferenceMs?: number;
  totalMs?: number;
  quality?: number;      // blur + exposure score (0–1)
}

interface EnrollResult {
  success: boolean;
  framesUsed: number;
}

interface LivenessResult {
  isLive: boolean;
  isBlink: boolean;
  blinkCount: number;
  earValue: number;
}

interface AttendanceRecord {
  id: string;
  workerId: string;
  timestamp: number;
  latitude: number;
  longitude: number;
  confidence: number;
  signature: string;  // HMAC-SHA256
}
```

## Model Download

Models are not committed to git. Run before building:

```bash
python ml_prep/setup_models.py
```

This downloads:
- `blazeface.tflite` — 0.22 MB (face detection)
- `mobilefacenet_int8.tflite` — ~5 MB (face embedding)

Total model footprint: **~5.2 MB** (well under the 20 MB target).

## Further Reading

- [Architecture & Integration Guide](ARCHITECTURE.md)
- [Performance Benchmarks](BENCHMARKS.md)
- [Security Model](SECURITY.md)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## License

MIT
