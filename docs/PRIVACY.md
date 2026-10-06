# Privacy notes for apps using this SDK

**This is general information for developers, not legal advice.** Biometric data
is specially protected in many places, for example under the GDPR in the European
Union and the Digital Personal Data Protection Act in India. Check the rules that
apply to you with someone qualified.

## What the SDK does

- Processes face images only in memory, on the device, and does not store or log them.
- Stores one face template (192 numbers) per enrolled person, an ID you choose,
  and queued attendance records, in an encrypted database on the device.
- Never sends anything over the network. Uploading records is up to your app.

## What your app is responsible for

**Consent and notice.** Tell people, before enrollment, what is collected, why,
how long it is kept and who can see it. Get consent where the law requires it, and
offer an alternative (for example a manual check-in) to people who decline.

**Purpose.** Use templates only for the purpose you told people about, for
example attendance at one organization. Do not reuse them for anything else.

**Minimal data.**

- Use IDs that are not names where possible.
- Send a location only if you need it; `logAttendance` works without one.
- Do not upload templates. The SDK has no API for exporting them, on purpose.

**Retention and deletion.**

- Records are purged from the device after a confirmed sync
  (`purgeSyncedRecords`).
- The reference backend deletes records after 90 days.
- Plan how you remove a person who leaves or withdraws consent. Enrolling the same
  ID again replaces the template; a delete API is not available yet.
- Uninstalling the app or clearing its data destroys the encryption keys, which
  makes any remaining database copy unreadable.

**Backups.** Exclude the SDK's database and preferences from Android backups (the
example app sets `android:allowBackup="false"`). On iOS the SDK excludes its
database from backup itself.

**Temporary photo files.** Camera libraries often write each photo to a temporary
file. Delete it as soon as you have read it, as the example app does in
`example/src/photoFile.ts`, and check the cache directory during testing.

**Accuracy and fairness.** Face recognition makes mistakes, and error rates can
differ between groups of people. The bundled model has not been evaluated across
demographics (see [BENCHMARKS.md](BENCHMARKS.md) and [MODELS.md](MODELS.md)).
Give people a way to correct a wrong result, and do not use a single match as the
only evidence for decisions that seriously affect them.

**Security.** See [SECURITY_MODEL.md](SECURITY_MODEL.md) for what is protected and
what is not, including the limits of the liveness check.
