// DatalakeBiometric.mm
// Objective-C++ bridge — exposes the Swift class to React Native via
// RCT_EXTERN_MODULE. Business logic lives in DatalakeBiometric.swift.
//
// NOTE: do NOT #import "DatalakeBiometric-Swift.h" here. The
// `@interface RCT_EXTERN_MODULE(...)` pattern below expands into a
// forward declaration of the class; the Swift implementation is resolved
// at link time. Importing the Swift header on top of that would risk a
// duplicate-@interface warning/error.

#import <React/RCTBridgeModule.h>

// ---------------------------------------------------------------------------
// Module registration. `@interface` is required — the RCT_EXTERN_MODULE macro
// expands to `objc_name : objc_supername @end ...` and only parses as a
// top-level declaration when preceded by `@interface`. The macro leaves the
// final `@interface DatalakeBiometric (RCTExternMethods)` open so that the
// `RCT_EXTERN_METHOD` lines below land inside it; we close with `@end`.
// ---------------------------------------------------------------------------
@interface RCT_EXTERN_MODULE(DatalakeBiometric, NSObject)

// ---------------------------------------------------------------------------
// initialize() -> Promise<boolean>
// ---------------------------------------------------------------------------
RCT_EXTERN_METHOD(
  initialize:(RCTPromiseResolveBlock)resolve
  reject:(RCTPromiseRejectBlock)reject
)

// ---------------------------------------------------------------------------
// enrollWorker(workerId, frames, hint) -> Promise<{success, framesUsed}>
// ---------------------------------------------------------------------------
RCT_EXTERN_METHOD(
  enrollWorker:(NSString *)workerId
  frames:(NSArray<NSString *> *)frames
  hint:(NSDictionary *)hint
  resolve:(RCTPromiseResolveBlock)resolve
  reject:(RCTPromiseRejectBlock)reject
)

// ---------------------------------------------------------------------------
// verifyWorker(base64Image, hint) -> Promise<{status, workerId?, confidence?}>
// ---------------------------------------------------------------------------
RCT_EXTERN_METHOD(
  verifyWorker:(NSString *)base64Image
  hint:(NSDictionary *)hint
  resolve:(RCTPromiseResolveBlock)resolve
  reject:(RCTPromiseRejectBlock)reject
)

// ---------------------------------------------------------------------------
// logAndQueueAttendance(workerId, latitude, longitude, confidence) -> Promise<boolean>
// ---------------------------------------------------------------------------
RCT_EXTERN_METHOD(
  logAndQueueAttendance:(NSString *)workerId
  latitude:(double)latitude
  longitude:(double)longitude
  confidence:(double)confidence
  resolve:(RCTPromiseResolveBlock)resolve
  reject:(RCTPromiseRejectBlock)reject
)

// ---------------------------------------------------------------------------
// checkLiveness(landmarks) -> Promise<{isLive, isBlink, blinkCount, earValue}>
// ---------------------------------------------------------------------------
RCT_EXTERN_METHOD(
  checkLiveness:(NSArray *)landmarks
  resolve:(RCTPromiseResolveBlock)resolve
  reject:(RCTPromiseRejectBlock)reject
)

// ---------------------------------------------------------------------------
// getPendingAttendanceRecords() -> Promise<Array<Record>>
// JS-facing name is `getPendingAttendanceRecords` (matches Android Kotlin
// override and the TurboModule spec). The underlying Swift method is
// `getPendingRecords` — REMAP keeps the bridge surface aligned across
// platforms without renaming the Swift implementation.
// ---------------------------------------------------------------------------
RCT_EXTERN_REMAP_METHOD(
  getPendingAttendanceRecords,
  getPendingRecords:(RCTPromiseResolveBlock)resolve
  reject:(RCTPromiseRejectBlock)reject
)

// ---------------------------------------------------------------------------
// markRecordsSynced(ids) -> Promise<null>
// JS-facing name aligned with Android + spec; Swift method is `markSynced`.
// ---------------------------------------------------------------------------
RCT_EXTERN_REMAP_METHOD(
  markRecordsSynced,
  markSynced:(NSArray<NSString *> *)ids
  resolve:(RCTPromiseResolveBlock)resolve
  reject:(RCTPromiseRejectBlock)reject
)

// ---------------------------------------------------------------------------
// purgeSyncedRecords() -> Promise<boolean>
// Local data purge after server ACK. Swift method has the same name.
// ---------------------------------------------------------------------------
RCT_EXTERN_METHOD(
  purgeSyncedRecords:(RCTPromiseResolveBlock)resolve
  reject:(RCTPromiseRejectBlock)reject
)

@end
