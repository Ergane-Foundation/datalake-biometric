// DatalakeBiometric.swift
// Datalake Biometric iOS native module.
// Frameworks: Foundation, React, Vision, CoreML, CryptoKit, Security, SQLite3

import Foundation
import React
import Vision
import CoreML
import CryptoKit
import Security
import SQLite3

// MARK: - KeyVault

/// Manages a 256-bit symmetric key in the iOS Keychain.
/// The key is used to HMAC-sign attendance records for tamper-evidence.
final class KeyVault {

  static let kAlias = "datalake_biometric_key"

  // MARK: getOrCreateKey

  /// Returns the existing Keychain-stored key, or generates and stores a new one.
  func getOrCreateKey() -> SymmetricKey {
    let tag = KeyVault.kAlias.data(using: .utf8)!

    // Query Keychain for an existing key
    let query: [String: Any] = [
      kSecClass as String: kSecClassKey,
      kSecAttrApplicationTag as String: tag,
      kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom, // generic key type for raw data
      kSecReturnData as String: true
    ]

    var dataRef: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &dataRef)

    if status == errSecSuccess, let data = dataRef as? Data {
      return SymmetricKey(data: data)
    }

    // Generate new 256-bit key
    let newKey = SymmetricKey(size: .bits256)
    let keyData = newKey.withUnsafeBytes { Data($0) }

    let addQuery: [String: Any] = [
      kSecClass as String: kSecClassKey,
      kSecAttrApplicationTag as String: tag,
      kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
      kSecValueData as String: keyData,
      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    ]

    SecItemAdd(addQuery as CFDictionary, nil)
    return newKey
  }

  // MARK: signRecord

  /// Returns base64-encoded HMAC-SHA256 signature for the given record string.
  func signRecord(_ record: String) -> String {
    let key = getOrCreateKey()
    let recordData = Data(record.utf8)
    let mac = HMAC<SHA256>.authenticationCode(for: recordData, using: key)
    return Data(mac).base64EncodedString()
  }
}

// MARK: - EmbeddingStore

/// SQLCipher-backed store for face embeddings and offline attendance logs.
final class EmbeddingStore {

  var db: OpaquePointer? = nil

  // MARK: open

  /// Opens (or creates) the SQLCipher database at `path` and applies the `passphrase`.
  /// Creates the required tables and indexes if they don't exist.
  /// Returns `true` on success.
  func open(path: String, passphrase: String) -> Bool {
    guard sqlite3_open(path, &db) == SQLITE_OK else {
      return false
    }

    // Apply SQLCipher encryption passphrase
    let keySQL = "PRAGMA key = '\(passphrase)';"
    guard sqlite3_exec(db, keySQL, nil, nil, nil) == SQLITE_OK else {
      return false
    }

    let schema = """
      CREATE TABLE IF NOT EXISTS embeddings (
        id          INTEGER PRIMARY KEY,
        worker_id   TEXT    UNIQUE NOT NULL,
        embedding   BLOB    NOT NULL,
        enrolled_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS attendance_log (
        id         TEXT    PRIMARY KEY,
        worker_id  TEXT    NOT NULL,
        timestamp  INTEGER NOT NULL,
        latitude   REAL    NOT NULL,
        longitude  REAL    NOT NULL,
        confidence REAL    NOT NULL,
        signature  TEXT    NOT NULL,
        synced     BOOLEAN DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_synced ON attendance_log(synced);
    """

    return sqlite3_exec(db, schema, nil, nil, nil) == SQLITE_OK
  }

  // MARK: insertEmbedding

  /// Inserts or replaces a worker's face embedding (array of Floats serialised as BLOB).
  func insertEmbedding(workerId: String, embedding: [Float]) -> Bool {
    guard let db = db else { return false }

    let sql = """
      INSERT OR REPLACE INTO embeddings (worker_id, embedding, enrolled_at)
      VALUES (?, ?, ?);
    """
    var stmt: OpaquePointer?
    guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return false }
    defer { sqlite3_finalize(stmt) }

    let blobData = embedding.withUnsafeBufferPointer { Data(buffer: $0) }
    let ts = Int64(Date().timeIntervalSince1970 * 1000)

    sqlite3_bind_text(stmt, 1, (workerId as NSString).utf8String, -1, nil)
    blobData.withUnsafeBytes { rawBytes in
      _ = sqlite3_bind_blob(stmt, 2, rawBytes.baseAddress, Int32(blobData.count), nil)
    }
    sqlite3_bind_int64(stmt, 3, ts)

    return sqlite3_step(stmt) == SQLITE_DONE
  }

  // MARK: queryAllEmbeddings

  /// Returns all stored worker embeddings as an array of (workerId, [Float]) tuples.
  func queryAllEmbeddings() -> [(workerId: String, embedding: [Float])] {
    guard let db = db else { return [] }

    let sql = "SELECT worker_id, embedding FROM embeddings;"
    var stmt: OpaquePointer?
    guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return [] }
    defer { sqlite3_finalize(stmt) }

    var results: [(workerId: String, embedding: [Float])] = []

    while sqlite3_step(stmt) == SQLITE_ROW {
      let workerId = String(cString: sqlite3_column_text(stmt, 1))
      let blobPtr  = sqlite3_column_blob(stmt, 2)
      let blobSize = sqlite3_column_bytes(stmt, 2)

      if let blobPtr = blobPtr, blobSize > 0 {
        let count = Int(blobSize) / MemoryLayout<Float>.size
        let floatBuffer = blobPtr.assumingMemoryBound(to: Float.self)
        let embedding = Array(UnsafeBufferPointer(start: floatBuffer, count: count))
        results.append((workerId: workerId, embedding: embedding))
      }
    }
    return results
  }

  // MARK: insertAttendance

  /// Inserts a single offline attendance record.
  func insertAttendance(id: String, workerId: String, timestamp: Int64,
                        lat: Double, lng: Double, confidence: Double,
                        signature: String) -> Bool {
    guard let db = db else { return false }

    let sql = """
      INSERT OR IGNORE INTO attendance_log
        (id, worker_id, timestamp, latitude, longitude, confidence, signature, synced)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0);
    """
    var stmt: OpaquePointer?
    guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return false }
    defer { sqlite3_finalize(stmt) }

    sqlite3_bind_text(stmt, 1, (id as NSString).utf8String, -1, nil)
    sqlite3_bind_text(stmt, 2, (workerId as NSString).utf8String, -1, nil)
    sqlite3_bind_int64(stmt, 3, timestamp)
    sqlite3_bind_double(stmt, 4, lat)
    sqlite3_bind_double(stmt, 5, lng)
    sqlite3_bind_double(stmt, 6, confidence)
    sqlite3_bind_text(stmt, 7, (signature as NSString).utf8String, -1, nil)

    return sqlite3_step(stmt) == SQLITE_DONE
  }

  // MARK: getPending

  /// Returns all unsynced attendance records as dictionaries suitable for JS consumption.
  func getPending() -> [[String: Any]] {
    guard let db = db else { return [] }

    let sql = """
      SELECT id, worker_id, timestamp, latitude, longitude, confidence, signature
      FROM attendance_log WHERE synced = 0;
    """
    var stmt: OpaquePointer?
    guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return [] }
    defer { sqlite3_finalize(stmt) }

    var records: [[String: Any]] = []

    while sqlite3_step(stmt) == SQLITE_ROW {
      let record: [String: Any] = [
        "id":         String(cString: sqlite3_column_text(stmt, 0)),
        "workerId":   String(cString: sqlite3_column_text(stmt, 1)),
        "timestamp":  sqlite3_column_int64(stmt, 2),
        "latitude":   sqlite3_column_double(stmt, 3),
        "longitude":  sqlite3_column_double(stmt, 4),
        "confidence": sqlite3_column_double(stmt, 5),
        "signature":  String(cString: sqlite3_column_text(stmt, 6))
      ]
      records.append(record)
    }
    return records
  }

  // MARK: markSynced

  /// Marks the given record IDs as synced in the database.
  func markSynced(ids: [String]) -> Bool {
    guard let db = db, !ids.isEmpty else { return true }

    // Build parameterised IN clause
    let placeholders = ids.map { _ in "?" }.joined(separator: ", ")
    let sql = "UPDATE attendance_log SET synced = 1 WHERE id IN (\(placeholders));"

    var stmt: OpaquePointer?
    guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return false }
    defer { sqlite3_finalize(stmt) }

    for (index, id) in ids.enumerated() {
      sqlite3_bind_text(stmt, Int32(index + 1), (id as NSString).utf8String, -1, nil)
    }

    return sqlite3_step(stmt) == SQLITE_DONE
  }

  deinit {
    if let db = db { sqlite3_close(db) }
  }
}

// MARK: - FaceEmbedder

/// Loads MobileFaceNet.mlmodel and produces L2-normalised 128-d face embeddings.
final class FaceEmbedder {

  var model: MLModel? = nil

  // MARK: load

  /// Attempts to load `MobileFaceNet.mlmodel` from the main bundle.
  /// Returns `true` on success.
  func load() -> Bool {
    guard let modelURL = Bundle.main.url(forResource: "MobileFaceNet",
                                         withExtension: "mlmodelc")
            ?? Bundle.main.url(forResource: "MobileFaceNet",
                               withExtension: "mlmodel") else {
      return false
    }

    do {
      model = try MLModel(contentsOf: modelURL)
      return true
    } catch {
      return false
    }
  }

  // MARK: embed

  /// Runs the CoreML model on a 112×112 pixel buffer and returns the L2-normalised embedding.
  /// Returns `nil` if the model isn't loaded or inference fails.
  func embed(pixelBuffer: CVPixelBuffer) -> [Float]? {
    guard let model = model else { return nil }

    // Resize to 112×112 using Vision
    guard let resized = resize(pixelBuffer: pixelBuffer, to: CGSize(width: 112, height: 112))
    else { return nil }

    // Build MLFeatureProvider from the pixel buffer
    guard let inputFeature = try? MLDictionaryFeatureProvider(
      dictionary: ["input": MLFeatureValue(pixelBuffer: resized)]
    ) else { return nil }

    guard let output = try? model.prediction(from: inputFeature) else { return nil }

    // Extract the first multi-array output feature
    var embedding: [Float] = []
    for featureName in output.featureNames {
      if let multiArray = output.featureValue(for: featureName)?.multiArrayValue {
        for i in 0 ..< multiArray.count {
          embedding.append(Float(truncating: multiArray[i]))
        }
        break
      }
    }

    guard !embedding.isEmpty else { return nil }
    return l2Normalize(embedding)
  }

  // MARK: - Private helpers

  private func resize(pixelBuffer: CVPixelBuffer, to size: CGSize) -> CVPixelBuffer? {
    var resized: CVPixelBuffer?
    CVPixelBufferCreate(kCFAllocatorDefault,
                        Int(size.width), Int(size.height),
                        kCVPixelFormatType_32BGRA,
                        nil, &resized)
    guard let dest = resized else { return nil }

    CVPixelBufferLockBaseAddress(pixelBuffer, .readOnly)
    CVPixelBufferLockBaseAddress(dest, [])
    defer {
      CVPixelBufferUnlockBaseAddress(pixelBuffer, .readOnly)
      CVPixelBufferUnlockBaseAddress(dest, [])
    }

    guard let srcBase = CVPixelBufferGetBaseAddress(pixelBuffer),
          let dstBase = CVPixelBufferGetBaseAddress(dest)
    else { return nil }

    let srcWidth  = CVPixelBufferGetWidth(pixelBuffer)
    let srcHeight = CVPixelBufferGetHeight(pixelBuffer)
    let srcBytes  = CVPixelBufferGetBytesPerRow(pixelBuffer)
    let dstBytes  = CVPixelBufferGetBytesPerRow(dest)

    let srcCtx = CGContext(data: srcBase,
                           width: srcWidth, height: srcHeight,
                           bitsPerComponent: 8, bytesPerRow: srcBytes,
                           space: CGColorSpaceCreateDeviceRGB(),
                           bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue)
    guard let srcImage = srcCtx?.makeImage() else { return nil }

    let dstCtx = CGContext(data: dstBase,
                           width: Int(size.width), height: Int(size.height),
                           bitsPerComponent: 8, bytesPerRow: dstBytes,
                           space: CGColorSpaceCreateDeviceRGB(),
                           bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue)
    dstCtx?.draw(srcImage, in: CGRect(origin: .zero, size: size))
    return dest
  }

  private func l2Normalize(_ vector: [Float]) -> [Float] {
    let magnitude = sqrt(vector.reduce(0) { $0 + $1 * $1 })
    guard magnitude > 0 else { return vector }
    return vector.map { $0 / magnitude }
  }
}

// MARK: - LivenessTracker

/// Frame-by-frame eye-aspect-ratio (EAR) blink counter for passive liveness detection.
final class LivenessTracker {

  let EAR_THRESHOLD: Float = 0.20
  let BLINK_MIN = 2

  private(set) var history: [(eyesOpen: Bool, timestamp: Date)] = []
  private(set) var blinkCount = 0
  private(set) var lastEyeState = true

  // MARK: updateFrame

  /// Feed each camera frame's per-eye openness scores (0.0 → closed, 1.0 → open).
  func updateFrame(leftEyeOpen: Float, rightEyeOpen: Float) {
    let avg = (leftEyeOpen + rightEyeOpen) / 2.0
    let eyesOpen = avg > EAR_THRESHOLD

    // Detect falling edge → blink
    if lastEyeState == true && eyesOpen == false {
      blinkCount += 1
    }
    lastEyeState = eyesOpen

    history.append((eyesOpen: eyesOpen, timestamp: Date()))

    // Keep only last 30 frames
    if history.count > 30 {
      history.removeFirst(history.count - 30)
    }
  }

  // MARK: isLive

  /// Returns `true` once the required minimum blink count has been observed.
  func isLive() -> Bool {
    return blinkCount >= BLINK_MIN
  }

  // MARK: reset

  /// Clears blink history — call between sessions.
  func reset() {
    blinkCount   = 0
    history      = []
    lastEyeState = true
  }
}

// MARK: - DatalakeBiometric (React Native Bridge)

@objc(DatalakeBiometric)
class DatalakeBiometric: NSObject {

  @objc static func moduleName() -> String! { return "DatalakeBiometric" }
  @objc static func requiresMainQueueSetup() -> Bool { return false }

  private let store      = EmbeddingStore()
  private let embedder   = FaceEmbedder()
  private let liveness   = LivenessTracker()
  private let keyVault   = KeyVault()
  private var initialized = false

  private let queue = DispatchQueue(label: "com.datalake.biometric", qos: .userInitiated)

  // MARK: - initialize

  @objc func initialize(
    _ resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    queue.async { [weak self] in
      guard let self = self else { return }

      let docs   = NSSearchPathForDirectoriesInDomains(.documentDirectory, .userDomainMask, true)[0]
      let dbPath = (docs as NSString).appendingPathComponent("biometric.db")

      let symKey     = self.keyVault.getOrCreateKey()
      let passphrase = symKey.withUnsafeBytes { Data($0) }.base64EncodedString()

      guard self.store.open(path: dbPath, passphrase: passphrase) else {
        reject("DB_OPEN_FAILED", "Failed to open encrypted database", nil)
        return
      }
      guard self.embedder.load() else {
        reject("MODEL_LOAD_FAILED", "MobileFaceNet.mlmodel not found in bundle", nil)
        return
      }
      self.initialized = true
      resolve(true)
    }
  }

  // MARK: - enrollWorker

  @objc func enrollWorker(
    _ workerId: String,
    frames: [String],
    hint: NSDictionary?,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    queue.async { [weak self] in
      guard let self = self, self.initialized else {
        reject("NOT_INITIALIZED", "Call initialize() first", nil)
        return
      }

      var embeddings: [[Float]] = []

      for base64 in frames {
        guard let data   = Data(base64Encoded: base64,
                                options: .ignoreUnknownCharacters),
              let image  = UIImage(data: data),
              let buffer = self.pixelBuffer(from: image, hint: hint, imageSize: image.size)
        else { continue }

        if let emb = self.embedder.embed(pixelBuffer: buffer) {
          embeddings.append(emb)
        }
      }

      guard !embeddings.isEmpty else {
        reject("NO_EMBEDDINGS", "No valid face frames could be embedded", nil)
        return
      }

      // Element-wise average
      let dim = embeddings[0].count
      var avg = [Float](repeating: 0, count: dim)
      for emb in embeddings {
        for i in 0 ..< dim { avg[i] += emb[i] }
      }
      let n = Float(embeddings.count)
      avg = avg.map { $0 / n }

      self.store.insertEmbedding(workerId: workerId, embedding: avg)
      resolve(["success": true, "framesUsed": frames.count])
    }
  }

  // MARK: - verifyWorker

  @objc func verifyWorker(
    _ base64Image: String,
    hint: NSDictionary?,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    queue.async { [weak self] in
      guard let self = self, self.initialized else {
        reject("NOT_INITIALIZED", "Call initialize() first", nil)
        return
      }

      guard let data   = Data(base64Encoded: base64Image,
                              options: .ignoreUnknownCharacters),
            let image  = UIImage(data: data),
            let buffer = self.pixelBuffer(from: image, hint: hint, imageSize: image.size),
            let queryEmbedding = self.embedder.embed(pixelBuffer: buffer)
      else {
        reject("DECODE_FAILED", "Cannot decode or embed the provided image", nil)
        return
      }

      let allEmbeddings = self.store.queryAllEmbeddings()
      var bestScore: Double = -1
      var bestWorkerId = ""

      for entry in allEmbeddings {
        let score = self.cosineSimilarity(queryEmbedding, entry.embedding)
        if score > bestScore {
          bestScore     = score
          bestWorkerId  = entry.workerId
        }
      }

      let THRESHOLD = 0.75
      if bestScore > THRESHOLD {
        resolve([
          "status":     "MATCH",
          "workerId":   bestWorkerId,
          "confidence": bestScore
        ])
      } else {
        resolve(["status": "NO_MATCH"])
      }
    }
  }

  // MARK: - logAttendance

  @objc func logAttendance(
    _ workerId: String,
    lat: Double,
    lng: Double,
    confidence: Double,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    queue.async { [weak self] in
      guard let self = self, self.initialized else {
        reject("NOT_INITIALIZED", "Call initialize() first", nil)
        return
      }

      let id        = UUID().uuidString
      let ts        = Int64(Date().timeIntervalSince1970 * 1000)
      let record    = "\(workerId)|\(ts)|\(lat)|\(lng)|\(confidence)"
      let signature = self.keyVault.signRecord(record)

      self.store.insertAttendance(
        id: id, workerId: workerId, timestamp: ts,
        lat: lat, lng: lng, confidence: confidence,
        signature: signature
      )
      resolve(NSNull())
    }
  }

  // MARK: - getPendingRecords

  @objc func getPendingRecords(
    _ resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    queue.async { [weak self] in
      guard let self = self else { return }
      resolve(self.store.getPending())
    }
  }

  // MARK: - markSynced

  @objc func markSynced(
    _ ids: [String],
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    queue.async { [weak self] in
      guard let self = self else { return }
      _ = self.store.markSynced(ids: ids)
      resolve(NSNull())
    }
  }

  // MARK: - Private helpers

  /// Converts UIImage → CVPixelBuffer, applying hint crop (normalised) or a centre crop.
  private func pixelBuffer(from image: UIImage,
                           hint: NSDictionary?,
                           imageSize: CGSize) -> CVPixelBuffer? {
    var cropRect: CGRect

    if let hint = hint,
       let nx = hint["nx"] as? CGFloat,
       let ny = hint["ny"] as? CGFloat,
       let nw = hint["nw"] as? CGFloat,
       let nh = hint["nh"] as? CGFloat {
      cropRect = CGRect(x: nx * imageSize.width,
                        y: ny * imageSize.height,
                        width: nw * imageSize.width,
                        height: nh * imageSize.height)
    } else {
      // Centre square crop
      let side = min(imageSize.width, imageSize.height)
      cropRect = CGRect(x: (imageSize.width  - side) / 2,
                        y: (imageSize.height - side) / 2,
                        width: side, height: side)
    }

    // Render cropped region into a new UIImage
    UIGraphicsBeginImageContextWithOptions(cropRect.size, false, 1.0)
    defer { UIGraphicsEndImageContext() }
    image.draw(at: CGPoint(x: -cropRect.origin.x, y: -cropRect.origin.y))
    guard let cropped = UIGraphicsGetImageFromCurrentImageContext(),
          let cgImage = cropped.cgImage
    else { return nil }

    var pixelBuffer: CVPixelBuffer?
    let attrs: [String: Any] = [
      kCVPixelBufferCGImageCompatibilityKey as String: true,
      kCVPixelBufferCGBitmapContextCompatibilityKey as String: true
    ]
    CVPixelBufferCreate(kCFAllocatorDefault,
                        cgImage.width, cgImage.height,
                        kCVPixelFormatType_32ARGB,
                        attrs as CFDictionary,
                        &pixelBuffer)

    guard let buffer = pixelBuffer else { return nil }
    CVPixelBufferLockBaseAddress(buffer, [])
    defer { CVPixelBufferUnlockBaseAddress(buffer, []) }

    guard let context = CGContext(
      data: CVPixelBufferGetBaseAddress(buffer),
      width: cgImage.width, height: cgImage.height,
      bitsPerComponent: 8,
      bytesPerRow: CVPixelBufferGetBytesPerRow(buffer),
      space: CGColorSpaceCreateDeviceRGB(),
      bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue
    ) else { return nil }

    context.draw(cgImage, in: CGRect(x: 0, y: 0,
                                     width: cgImage.width,
                                     height: cgImage.height))
    return buffer
  }

  /// Dot-product cosine similarity between two L2-normalised vectors.
  private func cosineSimilarity(_ a: [Float], _ b: [Float]) -> Double {
    guard a.count == b.count else { return -1 }
    var dot: Float = 0
    for i in 0 ..< a.count { dot += a[i] * b[i] }
    return Double(dot)
  }
}
