// SPDX-License-Identifier: Apache-2.0
// DatalakeBiometric.mm
//
// Registers the Swift class in DatalakeBiometric.swift with React Native.
// Each RCT_EXTERN_METHOD must match the Swift @objc selector exactly, and the
// method names and argument order must match src/NativeDatalakeBiometric.ts.
//
// `@interface` before RCT_EXTERN_MODULE is required: the macro expands to a
// category declaration that only parses at the top level after `@interface`.
// The Swift header is not imported; the class is resolved at link time.

#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(DatalakeBiometric, NSObject)

RCT_EXTERN_METHOD(initialize:(NSDictionary *)options
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(enrollWorker:(NSString *)workerId
                  frames:(NSArray<NSString *> *)frames
                  hint:(NSDictionary *)hint
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(verifyWorker:(NSString *)base64Image
                  hint:(NSDictionary *)hint
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(checkLiveness:(NSArray *)landmarks
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(logAndQueueAttendance:(NSString *)workerId
                  confidence:(double)confidence
                  location:(NSDictionary *)location
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(getPendingAttendanceRecords:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(markRecordsSynced:(NSArray<NSString *> *)ids
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(purgeSyncedRecords:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(getSecureRandomBytes:(double)count
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

@end
