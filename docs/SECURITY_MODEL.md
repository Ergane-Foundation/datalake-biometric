# Security model

To report a vulnerability, see [SECURITY.md](../SECURITY.md).

What the SDK protects, how, and where its limits are. This describes the
Android implementation unless noted; iOS is experimental.

## What is stored

| Stored on the device | Never stored by the SDK |
|----------------------|-------------------------|
| Face templates: one vector of 192 numbers per person | Photos, video frames, face crops |
| Person ID and enrollment time | Names or documents (unless you put them in the ID) |
| Queued attendance records: ID, time, optional location, similarity, device ID, signature | |
| Two random secrets, encrypted by the Android Keystore | Secrets in plain text |

Choose IDs that are not personal data where you can, for example an employee
number rather than a name.

**Templates are still biometric data.** A template cannot be turned back into
the original photo, but research has shown that an approximate face image can be
reconstructed from embeddings like these, and a stolen template can be compared
against other photos. Protect templates as carefully as photos.

## Encryption at rest

- The whole database is encrypted with SQLCipher 4 (AES-256), library
  `net.zetetic:sqlcipher-android`.
- The database passphrase is 32 random bytes from `SecureRandom`, created on
  first use.
- The passphrase and the signing key are encrypted with AES-256-GCM using a key
  that is generated inside the Android Keystore and cannot be exported. On
  devices with a hardware-backed Keystore it never exists outside secure hardware.
  The encrypted values are kept in the app's private SharedPreferences. See
  `KeyVault.kt`.
- Reading the app's data directory (for example from a backup or a rooted
  device) is therefore not enough to decrypt the database; the attacker also
  needs that device's Keystore.
- Uninstalling the app or clearing its data deletes the secrets, which makes any
  leftover copy of the database unreadable.

**Backups.** Exclude the SDK's database and preferences from Android backup in
your app (the example sets `android:allowBackup="false"`). A restored database
cannot be decrypted on another device anyway, and the SDK reports
`KEYSTORE_ERROR` in that case.

**iOS (experimental).** Two separate random secrets in the Keychain
(`AfterFirstUnlockThisDeviceOnly`), database in Application Support with file
protection, excluded from backup. At startup the code checks that SQLCipher is
really linked (`PRAGMA cipher_version`) and refuses to store anything if it is
not, so data is never written unencrypted by mistake.

## Record signatures

Each attendance record is signed with HMAC-SHA256 using the device's signing key
over a fixed text format (see [ARCHITECTURE.md](ARCHITECTURE.md#signed-records)).

What this gives you: anyone who holds the device's key can check that a record
was not changed after the SDK created it.

What it does not give you yet: the reference backend cannot check signatures,
because each key stays on its device. Proper server-side verification needs a
key registration step, for example the device sending a public key once and
signing records with the private key. This is an open task.

## Sync backend

The reference backend (`backend/`) is optional and runs in your own AWS account.

- Every request needs `Authorization: Bearer <token>`. The token is a random
  value you create in AWS Systems Manager Parameter Store; it is never in the code.
- The API is rate limited, has no browser (CORS) access, and the function can
  only write to its own table.
- Records expire after 90 days.
- A single shared token identifies "an app that knows the token", not a specific
  device or user. Treat it like a password, rotate it if a device is lost, and
  consider per-device credentials for larger deployments.

## Liveness

The liveness check is **active challenge-response only**: the person must
perform two random actions (blink, smile, head turn), each starting from the
opposite pose. This is designed to stop static photos, printed or on a screen;
that has not yet been verified on a device.

It does **not** defend against:

- video replays of the right actions, for example on a second screen;
- deepfakes or other generated video;
- masks.

There is no passive anti-spoofing (texture, depth or reflection analysis). It is
not certified presentation attack detection. Where stakes are high, combine it
with other controls, such as a supervisor present at the check-in point.

## Out of scope

- An attacker with root access and a debugger on an unlocked device can read
  memory while the database is open. No app-level encryption prevents that.
- A compromised Android Keystore or secure hardware.
- Accuracy and fairness of the face model. See [MODELS.md](MODELS.md) and [BENCHMARKS.md](BENCHMARKS.md).

## Privacy

See [PRIVACY.md](PRIVACY.md).
