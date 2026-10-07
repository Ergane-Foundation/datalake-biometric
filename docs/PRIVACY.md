# Privacy notes for apps using this SDK

**This is general information for developers, not legal advice.** Biometric data
is specially protected in many places, for example under the GDPR in the European
Union and the Digital Personal Data Protection Act in India. Check the rules that
apply to you with someone qualified.

## What the SDK does

- Processes face images only in memory, on the device, and does not store or log them.
- Stores one face template (192 numbers) per enrolled person, an ID you choose,
  and queued attendance records, in an encrypted database on the device.
- Makes no network calls. Uploading records is up to your app.

## The example app and ML Kit

The example app is not the SDK. It uses Google ML Kit face detection (through
`react-native-vision-camera-face-detector`) for the live face box and the
liveness challenges. ML Kit processes images on the device and, according to
Google's [ML Kit data disclosure](https://developers.google.com/ml-kit/android-data-disclosure),
does not send images. It does send usage and performance metrics to Google:
device and app information, a per-installation identifier, latency, API
configuration and error codes. On the phone they wait in a local queue, the
database `com.google.android.datatransport.events`, and are uploaded when the
phone is online.

Google documents no setting to turn this off. If your app must not contact
Google:

- Do not use ML Kit. The SDK finds faces itself with BlazeFace on Android when
  no face box is passed (the example app's "Crop with ML Kit face box" switch,
  turned off). The liveness challenges still need a detector that reports eye,
  smile and head-pose values; ML Kit is only one choice.
- Or ship without the `INTERNET` permission if your app has no other network use;
  the queue then stays on the phone. The example app keeps the permission for its
  optional Sync screen.

Tell your users about ML Kit's metrics if you use it; Google's
[ML Kit terms](https://developers.google.com/ml-kit/terms) make that your
responsibility.

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
