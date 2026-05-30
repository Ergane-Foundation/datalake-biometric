require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "DatalakeBiometric"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors      = package["author"]

  # Pinned to 15.5 to match example/ios/Podfile — required by
  # GoogleMLKit/FaceDetection 8.0 (pulled in by react-native-vision-camera-face-detector).
  s.platforms    = { :ios => '15.5' }
  s.source       = { :git => "https://github.com/vaani1127/datalake-biometric.git", :tag => "#{s.version}" }

  s.source_files = "ios/**/*.{h,m,mm,swift,cpp}"
  s.private_header_files = "ios/**/*.h"

  # Swift ↔ Objective-C interop
  s.swift_version = "5.9"

  # SQLCipher — encrypted SQLite store for embeddings & attendance log
  s.dependency "SQLCipher"

  # System frameworks used by DatalakeBiometric.swift
  s.frameworks = "Foundation", "Vision", "CoreML", "Security", "UIKit"

  install_modules_dependencies(s)
end
