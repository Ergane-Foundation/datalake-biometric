// SPDX-License-Identifier: Apache-2.0
// DatalakeBiometric.swift
//
// iOS native module. EXPERIMENTAL: it compiles in CI but has not been verified
// on a device. Embedding uses a Core ML model ("MobileFaceNet.mlmodelc") that
// this repository does not ship yet, so initialize() rejects with
// MODEL_NOT_FOUND until one is added to the app bundle. iOS has no built-in
// face detector here: pass a face box (for example from ML Kit).

import CoreGraphics
import CoreML
import CoreVideo
import CryptoKit
import Foundation
import React
import SQLite3
import Security
import UIKit

// Same default as Android, calibrated on LFW for FAR 1e-4 per comparison. iOS has
// no face alignment yet, so this value does not hold there (see docs/BENCHMARKS.md).
private let defaultMatchThreshold = 0.54

/// An error with a stable code that becomes the JavaScript rejection code.
struct BiometricError: Error {
  let code: String
  let message: String
}

// MARK: - KeyVault

/// Stores two independent random 256-bit secrets in the Keychain: the database
/// passphrase and the record-signing key. Using separate secrets means a leak
/// of one does not expose the other. Items are bound to this device and are
/// readable after the first unlock, so background sync can still work.
final class KeyVault {
  private let service = "com.datalakebiometric.keys"

  func secret(named account: String) throws -> Data {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecReturnData as String: true,
    ]
    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    if status == errSecSuccess, let data = item as? Data {
      return data
    }
    guard status == errSecItemNotFound else {
      throw BiometricError(code: "KEYCHAIN_ERROR", message: "Keychain read failed (\(status)).")
    }

    var bytes = [UInt8](repeating: 0, count: 32)
    guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
      throw BiometricError(code: "KEYCHAIN_ERROR", message: "Could not generate a key.")
    }
    let data = Data(bytes)
    let add: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecValueData as String: data,
      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
    ]
    let addStatus = SecItemAdd(add as CFDictionary, nil)
    guard addStatus == errSecSuccess else {
      throw BiometricError(code: "KEYCHAIN_ERROR", message: "Keychain write failed (\(addStatus)).")
    }
    return data
  }
}

// MARK: - Attendance signature

/// Same canonical text as Android's AttendanceSignature.kt. Keep both in sync:
/// `v1|id|workerId|timestamp|latitude|longitude|confidence|deviceId`.
enum AttendanceSignature {
  static func payload(
    id: String, workerId: String, timestampMs: Int64,
    latitude: Double?, longitude: Double?, confidence: Double, deviceId: String
  ) -> String {
    // String(format:) uses the POSIX locale, so the decimal separator is always ".".
    func coordinate(_ v: Double?) -> String { v.map { String(format: "%.7f", $0) } ?? "" }
    return [
      "v1", id, workerId, String(timestampMs),
      coordinate(latitude), coordinate(longitude),
      String(format: "%.6f", confidence), deviceId,
    ].joined(separator: "|")
  }
}

// MARK: - EmbeddingStore

/// SQLCipher-encrypted store for face templates and queued attendance records.
final class EmbeddingStore {
  private var db: OpaquePointer?
  private static let schemaVersion: Int32 = 2

  /// Tells SQLite to copy bound values, so Swift temporaries can be released.
  private let sqliteTransient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

  /// Opens the database and verifies that encryption is really active.
  ///
  /// `PRAGMA key` is silently ignored by the system SQLite, so if the app were
  /// linked against it instead of SQLCipher, data would be stored in plain
  /// text. `PRAGMA cipher_version` only returns a row under SQLCipher; without
  /// it the store refuses to open.
  func open(url: URL, key: Data) throws {
    guard sqlite3_open(url.path, &db) == SQLITE_OK else {
      throw BiometricError(code: "DB_OPEN_FAILED", message: "Could not open the database.")
    }
    // Raw 256-bit key in SQLCipher's blob syntax, so no key derivation is needed.
    let hex = key.map { String(format: "%02x", $0) }.joined()
    try exec("PRAGMA key = \"x'\(hex)'\";")
    guard try queryString("PRAGMA cipher_version;") != nil else {
      close()
      throw BiometricError(
        code: "ENCRYPTION_UNAVAILABLE",
        message: "SQLCipher is not linked; refusing to store biometric data unencrypted.")
    }
    try migrate()
  }

  private func migrate() throws {
    let raw = try queryString("PRAGMA user_version;") ?? "0"
    let version = Int32(raw) ?? 0
    if version < 2 {
      // Version 1 required a location and had no device ID. It could never
      // hold records (initialize always failed without the Core ML model),
      // so the table is recreated instead of migrated.
      try exec("DROP TABLE IF EXISTS attendance_log;")
    }
    try exec(
      """
      CREATE TABLE IF NOT EXISTS embeddings (
        worker_id   TEXT PRIMARY KEY,
        embedding   BLOB NOT NULL,
        enrolled_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS attendance_log (
        id         TEXT PRIMARY KEY,
        worker_id  TEXT NOT NULL,
        timestamp  INTEGER NOT NULL,
        latitude   REAL,
        longitude  REAL,
        confidence REAL NOT NULL,
        device_id  TEXT NOT NULL,
        signature  TEXT NOT NULL,
        synced     INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_synced ON attendance_log(synced);
      PRAGMA user_version = \(EmbeddingStore.schemaVersion);
      """)
  }

  func saveTemplate(workerId: String, embedding: [Float]) throws {
    let stmt = try prepare(
      "INSERT OR REPLACE INTO embeddings (worker_id, embedding, enrolled_at) VALUES (?, ?, ?);")
    defer { sqlite3_finalize(stmt) }
    bindText(stmt, 1, workerId)
    let blob = embedding.withUnsafeBufferPointer { Data(buffer: $0) }
    _ = blob.withUnsafeBytes { bytes in
      sqlite3_bind_blob(stmt, 2, bytes.baseAddress, Int32(blob.count), sqliteTransient)
    }
    sqlite3_bind_int64(stmt, 3, Int64(Date().timeIntervalSince1970 * 1000))
    try step(stmt)
  }

  /// Linear 1:N search. Templates of another size (a different model) are skipped.
  func bestMatch(for query: [Float], threshold: Double) throws -> (workerId: String, similarity: Double)? {
    let stmt = try prepare("SELECT worker_id, embedding FROM embeddings;")
    defer { sqlite3_finalize(stmt) }
    var best: (workerId: String, similarity: Double)?
    while sqlite3_step(stmt) == SQLITE_ROW {
      guard let idText = sqlite3_column_text(stmt, 0), let blob = sqlite3_column_blob(stmt, 1) else {
        continue
      }
      let count = Int(sqlite3_column_bytes(stmt, 1)) / MemoryLayout<Float>.size
      guard count == query.count else { continue }
      let stored = UnsafeBufferPointer(start: blob.assumingMemoryBound(to: Float.self), count: count)
      var dot: Float = 0
      for i in 0..<count { dot += query[i] * stored[i] }
      let similarity = Double(dot)
      if similarity >= threshold && similarity > (best?.similarity ?? -Double.infinity) {
        best = (String(cString: idText), similarity)
      }
    }
    return best
  }

  func insertAttendance(
    id: String, workerId: String, timestampMs: Int64, latitude: Double?, longitude: Double?,
    confidence: Double, deviceId: String, signature: String
  ) throws {
    let stmt = try prepare(
      """
      INSERT INTO attendance_log
        (id, worker_id, timestamp, latitude, longitude, confidence, device_id, signature, synced)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0);
      """)
    defer { sqlite3_finalize(stmt) }
    bindText(stmt, 1, id)
    bindText(stmt, 2, workerId)
    sqlite3_bind_int64(stmt, 3, timestampMs)
    if let latitude { sqlite3_bind_double(stmt, 4, latitude) } else { sqlite3_bind_null(stmt, 4) }
    if let longitude { sqlite3_bind_double(stmt, 5, longitude) } else { sqlite3_bind_null(stmt, 5) }
    sqlite3_bind_double(stmt, 6, confidence)
    bindText(stmt, 7, deviceId)
    bindText(stmt, 8, signature)
    try step(stmt)
  }

  func pendingRecords() throws -> [[String: Any]] {
    let stmt = try prepare(
      """
      SELECT id, worker_id, timestamp, latitude, longitude, confidence, device_id, signature
      FROM attendance_log WHERE synced = 0 ORDER BY timestamp ASC;
      """)
    defer { sqlite3_finalize(stmt) }
    var records: [[String: Any]] = []
    while sqlite3_step(stmt) == SQLITE_ROW {
      var record: [String: Any] = [
        "id": columnText(stmt, 0),
        "workerId": columnText(stmt, 1),
        "timestamp": Double(sqlite3_column_int64(stmt, 2)),
        "confidence": sqlite3_column_double(stmt, 5),
        "deviceId": columnText(stmt, 6),
        "signature": columnText(stmt, 7),
      ]
      if sqlite3_column_type(stmt, 3) != SQLITE_NULL {
        record["latitude"] = sqlite3_column_double(stmt, 3)
      }
      if sqlite3_column_type(stmt, 4) != SQLITE_NULL {
        record["longitude"] = sqlite3_column_double(stmt, 4)
      }
      records.append(record)
    }
    return records
  }

  func markSynced(ids: [String]) throws {
    guard !ids.isEmpty else { return }
    let placeholders = ids.map { _ in "?" }.joined(separator: ", ")
    let stmt = try prepare("UPDATE attendance_log SET synced = 1 WHERE id IN (\(placeholders));")
    defer { sqlite3_finalize(stmt) }
    for (index, id) in ids.enumerated() { bindText(stmt, Int32(index + 1), id) }
    try step(stmt)
  }

  func purgeSynced() throws {
    try exec("DELETE FROM attendance_log WHERE synced = 1;")
  }

  func close() {
    if let db { sqlite3_close(db) }
    db = nil
  }

  deinit { close() }

  // MARK: SQLite helpers

  private func exec(_ sql: String) throws {
    guard sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK else { throw dbError() }
  }

  private func prepare(_ sql: String) throws -> OpaquePointer? {
    var stmt: OpaquePointer?
    guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { throw dbError() }
    return stmt
  }

  private func step(_ stmt: OpaquePointer?) throws {
    guard sqlite3_step(stmt) == SQLITE_DONE else { throw dbError() }
  }

  private func queryString(_ sql: String) throws -> String? {
    let stmt = try prepare(sql)
    defer { sqlite3_finalize(stmt) }
    guard sqlite3_step(stmt) == SQLITE_ROW, let text = sqlite3_column_text(stmt, 0) else { return nil }
    return String(cString: text)
  }

  private func bindText(_ stmt: OpaquePointer?, _ index: Int32, _ value: String) {
    sqlite3_bind_text(stmt, index, value, -1, sqliteTransient)
  }

  private func columnText(_ stmt: OpaquePointer?, _ index: Int32) -> String {
    guard let text = sqlite3_column_text(stmt, index) else { return "" }
    return String(cString: text)
  }

  private func dbError() -> BiometricError {
    var message = "unknown error"
    if let db, let cMessage = sqlite3_errmsg(db) {
      message = String(cString: cMessage)
    }
    return BiometricError(code: "DB_ERROR", message: message)
  }
}

// MARK: - FaceEmbedder

/// Runs a Core ML MobileFaceNet export on a 112x112 face crop.
final class FaceEmbedder {
  private var model: MLModel?

  func load() throws {
    guard let url = Bundle.main.url(forResource: "MobileFaceNet", withExtension: "mlmodelc") else {
      throw BiometricError(
        code: "MODEL_NOT_FOUND",
        message: "MobileFaceNet.mlmodelc is not in the app bundle. iOS support is experimental; see docs/MODELS.md.")
    }
    model = try MLModel(contentsOf: url)
  }

  /// Returns the L2-normalized embedding, or nil if inference fails.
  func embed(_ image: CGImage) -> [Float]? {
    guard let model, let buffer = pixelBuffer(from: image, side: 112) else { return nil }
    guard
      let input = try? MLDictionaryFeatureProvider(dictionary: ["input": MLFeatureValue(pixelBuffer: buffer)]),
      let output = try? model.prediction(from: input)
    else { return nil }

    for name in output.featureNames {
      guard let array = output.featureValue(for: name)?.multiArrayValue else { continue }
      let values = (0..<array.count).map { Float(truncating: array[$0]) }
      let norm = values.reduce(Float(0)) { $0 + $1 * $1 }.squareRoot()
      return norm > 0 ? values.map { $0 / norm } : values
    }
    return nil
  }

  private func pixelBuffer(from image: CGImage, side: Int) -> CVPixelBuffer? {
    var buffer: CVPixelBuffer?
    let attrs: [String: Any] = [
      kCVPixelBufferCGImageCompatibilityKey as String: true,
      kCVPixelBufferCGBitmapContextCompatibilityKey as String: true,
    ]
    CVPixelBufferCreate(kCFAllocatorDefault, side, side, kCVPixelFormatType_32BGRA, attrs as CFDictionary, &buffer)
    guard let buffer else { return nil }
    CVPixelBufferLockBaseAddress(buffer, [])
    defer { CVPixelBufferUnlockBaseAddress(buffer, []) }
    let bitmapInfo = CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue
    guard
      let context = CGContext(
        data: CVPixelBufferGetBaseAddress(buffer), width: side, height: side, bitsPerComponent: 8,
        bytesPerRow: CVPixelBufferGetBytesPerRow(buffer), space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: bitmapInfo)
    else { return nil }
    context.interpolationQuality = .high
    context.draw(image, in: CGRect(x: 0, y: 0, width: side, height: side))
    return buffer
  }
}

// MARK: - LivenessTracker

/// Experimental blink counter over 468-point Face Mesh landmarks, matching
/// Android's LivenessEngine. Nothing in this package produces such landmarks yet.
final class LivenessTracker {
  private let earClosed: Float = 0.20
  private let requiredBlinks = 2
  private var blinkCount = 0
  private var eyeWasClosed = false
  private var earHistory: [Float] = []

  func evaluate(_ landmarks: [[Float]]) -> (isLive: Bool, isBlink: Bool, blinkCount: Int, ear: Float) {
    guard landmarks.count >= 468 else { return (false, false, 0, 0) }
    let left = eyeAspectRatio(landmarks, [362, 385, 387, 263, 373, 380])
    let right = eyeAspectRatio(landmarks, [33, 160, 158, 133, 153, 144])
    let ear = (left + right) / 2
    earHistory.append(ear)
    if earHistory.count > 30 { earHistory.removeFirst(earHistory.count - 30) }

    let closed = ear < earClosed
    // Counted on re-opening, so a still photo with closed eyes never counts.
    let isBlink = eyeWasClosed && !closed
    if isBlink { blinkCount += 1 }
    eyeWasClosed = closed

    let mean = earHistory.reduce(Float(0), +) / Float(earHistory.count)
    let variance = earHistory.reduce(Float(0)) { $0 + ($1 - mean) * ($1 - mean) } / Float(earHistory.count)
    return (blinkCount >= requiredBlinks && variance > 0.0005, isBlink, blinkCount, ear)
  }

  private func eyeAspectRatio(_ p: [[Float]], _ i: [Int]) -> Float {
    func distance(_ a: [Float], _ b: [Float]) -> Float {
      guard a.count >= 2, b.count >= 2 else { return 0 }
      let dx = a[0] - b[0]
      let dy = a[1] - b[1]
      return (dx * dx + dy * dy).squareRoot()
    }
    let width = distance(p[i[0]], p[i[3]])
    guard width > 0 else { return 0 }
    return (distance(p[i[1]], p[i[5]]) + distance(p[i[2]], p[i[4]])) / (2 * width)
  }
}

// MARK: - React Native module

@objc(DatalakeBiometric)
class DatalakeBiometric: NSObject {

  @objc static func moduleName() -> String! { return "DatalakeBiometric" }
  @objc static func requiresMainQueueSetup() -> Bool { return false }

  private let store = EmbeddingStore()
  private let embedder = FaceEmbedder()
  private let liveness = LivenessTracker()
  private let keyVault = KeyVault()
  private var initialized = false
  private var matchThreshold = defaultMatchThreshold
  private var hmacKey = SymmetricKey(size: .bits256)
  private let queue = DispatchQueue(label: "com.datalakebiometric", qos: .userInitiated)

  /// Runs `work` on the module queue and settles the promise with its result.
  private func run(
    _ resolve: @escaping RCTPromiseResolveBlock,
    _ reject: @escaping RCTPromiseRejectBlock,
    _ work: @escaping () throws -> Any
  ) {
    queue.async {
      do {
        resolve(try work())
      } catch let error as BiometricError {
        reject(error.code, error.message, nil)
      } catch {
        reject("NATIVE_ERROR", error.localizedDescription, error)
      }
    }
  }

  private func requireInitialized() throws {
    if !initialized {
      throw BiometricError(code: "NOT_INITIALIZED", message: "Call initialize() first.")
    }
  }

  /// Same rules as Android: 1 to 128 printable characters, no "|".
  private func requireValidId(_ id: String) throws {
    let blank = id.trimmingCharacters(in: .whitespaces).isEmpty
    let hasControl = id.unicodeScalars.contains { CharacterSet.controlCharacters.contains($0) }
    if blank || id.count > 128 || id.contains("|") || hasControl {
      throw BiometricError(
        code: "INVALID_ARGUMENT",
        message: "workerId must be 1 to 128 printable characters and must not contain '|'.")
    }
  }

  @objc func initialize(
    _ options: NSDictionary?,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    run(resolve, reject) { [self] in
      if let value = (options?["matchThreshold"] as? NSNumber)?.doubleValue {
        guard value >= 0 && value <= 1 else {
          throw BiometricError(code: "INVALID_ARGUMENT", message: "matchThreshold must be from 0 to 1.")
        }
        matchThreshold = value
      }
      // minQuality is accepted for API parity; iOS has no quality gate yet.
      if initialized { return true }

      let fm = FileManager.default
      let directory = try fm.url(
        for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
      var dbURL = directory.appendingPathComponent("biometric.db")
      // Earlier builds kept an unusable database in Documents; remove it.
      if let docs = fm.urls(for: .documentDirectory, in: .userDomainMask).first {
        try? fm.removeItem(at: docs.appendingPathComponent("biometric.db"))
      }

      let dbKey = try keyVault.secret(named: "db-passphrase")
      try store.open(url: dbURL, key: dbKey)
      var values = URLResourceValues()
      values.isExcludedFromBackup = true
      try? dbURL.setResourceValues(values)
      try? fm.setAttributes(
        [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: dbURL.path)

      let hmacData = try keyVault.secret(named: "hmac-key")
      hmacKey = SymmetricKey(data: hmacData)
      try embedder.load()
      initialized = true
      return true
    }
  }

  @objc func enrollWorker(
    _ workerId: String,
    frames: [String],
    hint: NSDictionary?,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    run(resolve, reject) { [self] in
      try requireInitialized()
      try requireValidId(workerId)
      var embeddings: [[Float]] = []
      for frame in frames {
        if let crop = faceCrop(base64: frame, hint: hint), let embedding = embedder.embed(crop) {
          embeddings.append(embedding)
        }
      }
      guard let dim = embeddings.first?.count, embeddings.allSatisfy({ $0.count == dim }) else {
        throw BiometricError(code: "NO_FACE", message: "No face could be embedded. iOS requires a face box.")
      }
      var sum = [Float](repeating: 0, count: dim)
      for e in embeddings { for i in 0..<dim { sum[i] += e[i] } }
      let norm = sum.reduce(Float(0)) { $0 + $1 * $1 }.squareRoot()
      try store.saveTemplate(workerId: workerId, embedding: norm > 0 ? sum.map { $0 / norm } : sum)
      return ["success": true, "framesUsed": embeddings.count] as [String: Any]
    }
  }

  @objc func verifyWorker(
    _ base64Image: String,
    hint: NSDictionary?,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    run(resolve, reject) { [self] in
      try requireInitialized()
      guard let crop = faceCrop(base64: base64Image, hint: hint), let query = embedder.embed(crop) else {
        return ["status": "NO_FACE"] as [String: Any]
      }
      guard let match = try store.bestMatch(for: query, threshold: matchThreshold) else {
        return ["status": "NO_MATCH"] as [String: Any]
      }
      return ["status": "MATCH", "workerId": match.workerId, "confidence": match.similarity] as [String: Any]
    }
  }

  @objc func checkLiveness(
    _ landmarks: NSArray,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    run(resolve, reject) { [self] in
      let rows = landmarks as? [[NSNumber]] ?? []
      let points = rows.map { row in row.map { $0.floatValue } }
      let r = liveness.evaluate(points)
      let result: [String: Any] = [
        "isLive": r.isLive, "isBlink": r.isBlink, "blinkCount": r.blinkCount, "earValue": r.ear,
      ]
      return result
    }
  }

  @objc func logAndQueueAttendance(
    _ workerId: String,
    confidence: Double,
    location: NSDictionary?,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    run(resolve, reject) { [self] in
      try requireInitialized()
      try requireValidId(workerId)
      let latitude = (location?["latitude"] as? NSNumber)?.doubleValue
      let longitude = (location?["longitude"] as? NSNumber)?.doubleValue
      if let latitude, let longitude, abs(latitude) > 90 || abs(longitude) > 180 {
        throw BiometricError(code: "INVALID_ARGUMENT", message: "Location is out of range.")
      }
      let id = UUID().uuidString.lowercased()
      let timestamp = Int64(Date().timeIntervalSince1970 * 1000)
      // Per-vendor install ID, the closest iOS equivalent of Android's ANDROID_ID.
      let deviceId = UIDevice.current.identifierForVendor?.uuidString ?? "unknown"
      let payload = AttendanceSignature.payload(
        id: id, workerId: workerId, timestampMs: timestamp, latitude: latitude, longitude: longitude,
        confidence: confidence, deviceId: deviceId)
      let mac = HMAC<SHA256>.authenticationCode(for: Data(payload.utf8), using: hmacKey)
      try store.insertAttendance(
        id: id, workerId: workerId, timestampMs: timestamp, latitude: latitude, longitude: longitude,
        confidence: confidence, deviceId: deviceId, signature: Data(mac).base64EncodedString())
      return true
    }
  }

  @objc func getPendingAttendanceRecords(
    _ resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    run(resolve, reject) { [self] in
      try requireInitialized()
      return try store.pendingRecords()
    }
  }

  @objc func markRecordsSynced(
    _ ids: [String],
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    run(resolve, reject) { [self] in
      try requireInitialized()
      try store.markSynced(ids: ids)
      return true
    }
  }

  @objc func purgeSyncedRecords(
    _ resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    run(resolve, reject) { [self] in
      try requireInitialized()
      try store.purgeSynced()
      return true
    }
  }

  @objc func getSecureRandomBytes(
    _ count: Double,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    run(resolve, reject) {
      let n = Int(count)
      guard n >= 1 && n <= 1024 else {
        throw BiometricError(code: "INVALID_ARGUMENT", message: "count must be from 1 to 1024.")
      }
      var bytes = [UInt8](repeating: 0, count: n)
      guard SecRandomCopyBytes(kSecRandomDefault, n, &bytes) == errSecSuccess else {
        throw BiometricError(code: "NATIVE_ERROR", message: "Secure random source failed.")
      }
      return bytes.map { Int($0) }
    }
  }

  // MARK: Helpers

  /// Decodes the JPEG in memory and crops a padded square around the face box,
  /// like Android. Returns nil without a face box: iOS has no detector here.
  private func faceCrop(base64: String, hint: NSDictionary?) -> CGImage? {
    guard let hint,
      let nx = (hint["nx"] as? NSNumber)?.doubleValue,
      let ny = (hint["ny"] as? NSNumber)?.doubleValue,
      let nw = (hint["nw"] as? NSNumber)?.doubleValue,
      let nh = (hint["nh"] as? NSNumber)?.doubleValue,
      nw > 0, nh > 0,
      let data = Data(base64Encoded: base64, options: .ignoreUnknownCharacters),
      let image = UIImage(data: data)
    else { return nil }

    // Render once to apply the EXIF orientation, so the box matches the pixels.
    let size = image.size
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    let upright = UIGraphicsImageRenderer(size: size, format: format).image { _ in
      image.draw(in: CGRect(origin: .zero, size: size))
    }
    guard let cg = upright.cgImage else { return nil }

    // Widen the box by 20% per side, as on Android (forehead and chin).
    let w = Double(cg.width)
    let h = Double(cg.height)
    let side = min(max(nw * w, nh * h) * 1.4, min(w, h))
    let x = min(max((nx + nw / 2) * w - side / 2, 0), w - side)
    let y = min(max((ny + nh / 2) * h - side / 2, 0), h - side)
    return cg.cropping(to: CGRect(x: x, y: y, width: side, height: side).integral)
  }
}
