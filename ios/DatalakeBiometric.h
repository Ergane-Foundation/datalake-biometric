#import <React/RCTBridgeModule.h>

// Forward declaration only — implementation is in DatalakeBiometric.swift.
// RCT_EXTERN_MODULE in DatalakeBiometric.mm registers the Swift class with the
// React Native bridge. No TurboModule spec conformance needed here.
@interface DatalakeBiometric : NSObject <RCTBridgeModule>

@end
