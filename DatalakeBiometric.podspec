require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "DatalakeBiometric"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors      = package["author"]

  # React Native 0.85's own minimum. The example app needs 15.5 because the
  # ML Kit face detector it uses requires it; the library itself does not.
  s.platforms    = { :ios => "15.1" }
  # release-it tags releases as v<version>.
  s.source       = { :git => "https://github.com/Ergane-Foundation/datalake-biometric.git", :tag => "v#{s.version}" }

  s.source_files = "ios/**/*.{h,m,mm,swift,cpp}"
  s.swift_version = "5.9"

  # DEFINES_MODULE gives the pod a module map, so the Swift class is visible
  # to the Objective-C++ registration in DatalakeBiometric.mm at link time.
  s.pod_target_xcconfig = {
    "DEFINES_MODULE" => "YES",
    "SWIFT_VERSION" => "5.9"
  }

  # Encrypted SQLite. The Swift code checks at runtime that SQLCipher, not the
  # system SQLite, is linked, and refuses to open the database otherwise.
  s.dependency "SQLCipher"

  s.frameworks = "Foundation", "CoreML", "Security", "UIKit"

  install_modules_dependencies(s)
end
