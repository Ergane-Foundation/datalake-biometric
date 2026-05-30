// DatalakeBiometric.mm
// Objective-C++ bridge — exposes Swift class to React Native via RCT_EXTERN_MODULE.
// DO NOT add business logic here; implementation lives in DatalakeBiometric.swift.

#import <React/RCTBridgeModule.h>
#import "DatalakeBiometric-Swift.h"

// ---------------------------------------------------------------------------
// Module registration
// ---------------------------------------------------------------------------
RCT_EXTERN_MODULE(DatalakeBiometric, NSObject)

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
// logAttendance(workerId, lat, lng, confidence) -> Promise<null>
// ---------------------------------------------------------------------------
RCT_EXTERN_METHOD(
  logAttendance:(NSString *)workerId
  lat:(double)lat
  lng:(double)lng
  confidence:(double)confidence
  resolve:(RCTPromiseResolveBlock)resolve
  reject:(RCTPromiseRejectBlock)reject
)

// ---------------------------------------------------------------------------
// getPendingRecords() -> Promise<Array<Record>>
// ---------------------------------------------------------------------------
RCT_EXTERN_METHOD(
  getPendingRecords:(RCTPromiseResolveBlock)resolve
  reject:(RCTPromiseRejectBlock)reject
)

// ---------------------------------------------------------------------------
// markSynced(ids) -> Promise<null>
// ---------------------------------------------------------------------------
RCT_EXTERN_METHOD(
  markSynced:(NSArray<NSString *> *)ids
  resolve:(RCTPromiseResolveBlock)resolve
  reject:(RCTPromiseRejectBlock)reject
)
