# Security Model

How `datalake-biometric` protects worker biometrics and attendance records
on-device and in transit.

## Threat model

The SDK is designed to remain safe under the following realistic threats:

1. **Lost or stolen phone.** An attacker has physical access to a locked or
   sometimes-unlocked device and can read the app's private data directory
   (e.g. via a root exploit, ADB on a debuggable device, or a malicious backup).
2. **Tampered records in transit.** An attacker on the network between the
   device and AWS attempts to alter, replay, or inject attendance records.
3. **Spoof at enrolment / verification.** A worker holds a printed photo or
   replays a video of an enrolled colleague to fool the camera.
4. **Reverse engineering the APK.** An attacker decompiles the APK looking for
   embedded secrets (HMAC keys, DB passphrases, API tokens).

It is explicitly **not** designed to defend against a fully privileged actor on
the device (root + active debugger + live RAM dump), nor a compromised
TEE/Android Keystore.

## What we store, and what we never store

| Stored on device                        | Never stored                                  |
|-----------------------------------------|-----------------------------------------------|
| L2-normalized face **embeddings** (float vectors) | Raw or cropped face images          |
| `worker_id`, `enrolled_at`              | Photos, videos, frame buffers (discarded after embed) |
| Queued attendance rows (worker, time, lat/lng, confidence, HMAC) | Identity documents, names beyond `worker_id` |
| Two long-lived secrets in [KeyVault](android/src/main/java/com/datalakebiometric/KeyVault.kt) | The raw passphrase or HMAC key in plain prefs |

Embeddings are an **irreversible biometric template**: the face cannot be
reconstructed from a 128–512-dim vector, only compared against other
embeddings of the same face. This is the property the DPDP Act treats more
favorably than raw biometrics.

## Encryption at rest — SQLCipher

The entire SQLite database (`biometric.db`) is encrypted with
**SQLCipher 4 (AES-256 in CBC mode with HMAC page integrity)**.

- Implementation: [EmbeddingStore.kt](android/src/main/java/com/datalakebiometric/EmbeddingStore.kt) extends `net.sqlcipher.database.SQLiteOpenHelper`.
- Cipher / KDF / page size: SQLCipher defaults (AES-256-CBC, PBKDF2-HMAC-SHA512, 4 KB pages).
- The passphrase is **never hard-coded** — it is generated at first launch
  inside [KeyVault](android/src/main/java/com/datalakebiometric/KeyVault.kt)
  from `SecureRandom` (32 bytes) and stored encrypted (see next section).

## Key management — Android Keystore

`KeyVault` does not invent a custom Keystore protocol; it uses Jetpack
`androidx.security.crypto.EncryptedSharedPreferences`, whose master key lives
in the hardware-backed Android Keystore.

Layout:

```
EncryptedSharedPreferences("datalake_biometric_vault")
  ├── "db_passphrase_b64"  -- SQLCipher passphrase (base64 of 32 random bytes)
  └── "hmac_key_b64"       -- HMAC-SHA256 signing key (base64 of 32 random bytes)
```

- Master key alias: **`biometric_db_key`**, scheme `AES256_GCM`. The key is
  generated on first use and bound to the device's TEE / StrongBox if
  available; otherwise it lives in software-backed Keystore.
- Key encryption: `AES256_SIV` for entry keys, `AES256_GCM` for entry values
  (Tink defaults via EncryptedSharedPreferences).
- The master key is **not exportable** — even an attacker who reads
  `shared_prefs/datalake_biometric_vault.xml` cannot decrypt it without
  invoking the device's Keystore.

Uninstalling the app (or "clear data") deletes both the vault and the encrypted
DB, which means biometrics cannot follow the APK off the device.

## Record integrity — HMAC-SHA256

Every queued attendance record is signed before it lands in `attendance_log`:

```
signature = HMAC-SHA256(
  key  = KeyVault.hmacKey(),                              -- 32 random bytes
  data = workerId | timestamp | lat | lng | confidence | deviceId
)
```

- Key source: the **Keystore-protected** HMAC key in `KeyVault`. The earlier
  draft used the device's ANDROID_ID as the key, which is not a secret — that
  is replaced.
- Encoding: `Base64.NO_WRAP`. Stored alongside the row.
- Verification: the AWS Lambda sync handler (`backend/lambda_sync_handler.py`)
  recomputes the HMAC over the same field order and rejects rows whose
  signature does not match.

This catches two attacks:

1. **In-transit tampering.** Any change to worker, time, location, confidence,
   or device id invalidates the signature.
2. **Replay across devices.** `deviceId` is part of the signed payload, so a
   record from device A cannot be silently rewritten to look like one from
   device B.

## Liveness / anti-spoof

Spoofing — a printed photo or a still on another screen — is rejected by the
Verify screen before the embedding is ever computed:

- ML Kit's per-frame `leftEyeOpenProbability` / `rightEyeOpenProbability`
  drive a blink state machine in
  [`camera.ts`](example/src/camera.ts). A blink is counted only on an
  **open → closed → open** transition above and below empirical thresholds
  (default 0.7 / 0.3).
- Verify proceeds only after **two real blinks** within the 12 s timeout. A
  still photo cannot produce that transition; a video replay would need to be
  preloaded with the exact challenge.
- If the timeout elapses, the screen shows **SPOOF / NO LIVENESS** and the
  embedding is never run.

The legacy native [`LivenessEngine.kt`](android/src/main/java/com/datalakebiometric/LivenessEngine.kt)
still ships an EAR + variance check over the 468-point MediaPipe Face Mesh
topology, for future use if a 468-landmark JS source is added.

## Transit security (AWS sync)

- Records are uploaded over TLS to API Gateway → Lambda.
- DynamoDB writes use `condition: attribute_not_exists(id)` so a duplicate
  retry cannot create a second row.
- No raw images, no facial templates, leave the device. Sync payload is the
  attendance row only.
- **HMAC signature is preserved in DynamoDB for audit but server-side
  verification is intentionally not performed in this build** — see the
  next section.

## What goes off-device

| Channel                         | Payload                                      |
|---------------------------------|----------------------------------------------|
| AWS sync (HTTPS → Lambda)       | Signed attendance rows only                  |
| (anywhere else)                 | Nothing                                      |

Recognition itself runs **100 % on-device** — there is no upstream call during
`verifyWorker`. Airplane mode does not affect identification.

## DPDP Act alignment (India)

The Digital Personal Data Protection Act, 2023 treats biometric data as
sensitive personal data. The SDK aligns with its main obligations:

- **Purpose limitation.** Embeddings are only used to verify worker identity
  for attendance.
- **Storage minimization.** No raw biometric is retained; only the irreversible
  template.
- **On-device processing.** No third-party cloud sees the biometric. The data
  fiduciary (Datalake) holds only signed attendance metadata, not the face.
- **Right to erasure.** Uninstalling the app or clearing app data destroys the
  Keystore-wrapped vault — the encrypted DB becomes unreadable.
- **Security safeguards.** AES-256 at rest, hardware-backed key wrapping,
  HMAC-signed sync rows.

## Known limitations

- **Open sync endpoint (no API authorizer).** The deployed API Gateway HTTP
  API accepts unauthenticated POSTs to `/sync`. Anyone with the URL can
  write rows; rate-limiting is left to DynamoDB's on-demand throttling.
  Production hardening: add an API Gateway authorizer (Cognito user pool,
  Lambda authorizer with a per-device JWT, or IAM SigV4 from the app).
- **Server-side HMAC verification is skipped.** Each attendance record is
  signed on-device with a 32-byte key generated inside the Android Keystore
  ([KeyVault.kt](android/src/main/java/com/datalakebiometric/KeyVault.kt));
  that key is hardware-bound and never leaves the device. The Lambda has no
  way to recompute the signature without a separate registration handshake
  that would expose the key. The signature is therefore stored alongside
  the row for post-hoc audit (a tamper-detecting consumer with a registered
  device key could verify out-of-band), but the Lambda itself trusts what
  the device sends. Production design: per-device key registration on first
  launch (device sends a *public* key; server stores it; subsequent records
  signed with the *private* counterpart over the same canonical fields).
- **Root + active debug.** A fully privileged on-device attacker can read
  memory while the DB is open. This is true of any encrypted DB; we do not
  claim TEE-equivalent runtime protection.
- **MobileFaceNet model.** The bundled model is open-source and not
  fine-tuned on diverse demographics; accuracy in challenging outdoor lighting
  is part of the BENCHMARKS validation, not a SECURITY guarantee.
- **Backup.** `android:allowBackup="false"` is set on the example app — auto
  backup will not exfiltrate the vault. Library integrators must keep this
  flag false in their host app.
