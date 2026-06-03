require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "DatalakeBiometric"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors      = package["author"]

  # The DatalakeBiometric native module (CoreML + SQLCipher) supports iOS 14.0+.
  # Apps using the optional ML Kit liveness helper (react-native-vision-camera-face-detector)
  # require iOS 15.5+ at the app target level.
  s.platforms    = { :ios => '14.0' }
  s.source       = { :git => "https://github.com/vaani1127/datalake-biometric.git", :tag => "#{s.version}" }

  s.source_files = "ios/**/*.{h,m,mm,swift,cpp}"

  # Swift ↔ Objective-C interop
  s.swift_version = "5.9"

  # DEFINES_MODULE generates a module map for this pod, which is required so the
  # Swift-generated "DatalakeBiometric-Swift.h" header (produced from
  # ios/DatalakeBiometric.swift) is discoverable when DatalakeBiometric.mm
  # imports it via #import "DatalakeBiometric-Swift.h". Without this flag the
  # Swift compiler still produces the header but ObjC++ can't find it, so the
  # @objc(DatalakeBiometric) class is "unknown type" and every RCT_EXTERN_MODULE
  # / RCT_EXTERN_METHOD line fails to compile.
  s.pod_target_xcconfig = {
    "DEFINES_MODULE" => "YES",
    "SWIFT_VERSION" => "5.9"
  }

  # SQLCipher — encrypted SQLite store for embeddings & attendance log
  s.dependency "SQLCipher"

  # System frameworks used by DatalakeBiometric.swift
  s.frameworks = "Foundation", "Vision", "CoreML", "Security", "UIKit"

  install_modules_dependencies(s)
end
