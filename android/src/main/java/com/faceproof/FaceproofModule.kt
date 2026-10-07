// SPDX-License-Identifier: Apache-2.0
package com.faceproof

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.util.Base64
import androidx.exifinterface.media.ExifInterface
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableNativeArray
import com.facebook.react.bridge.WritableNativeMap
import java.io.ByteArrayInputStream
import java.io.Closeable
import java.security.SecureRandom

/**
 * React Native entry point. Every method decodes its input, runs the on-device
 * pipeline and settles the promise; nothing is sent over the network and no
 * image is written to disk or to the log.
 *
 * Calls run on React Native's native-modules thread. A lock still guards the
 * engines because [invalidate] can run on another thread during reload.
 */
class FaceproofModule(reactContext: ReactApplicationContext) :
  NativeFaceproofSpec(reactContext) {

  private class Engines(
    val embedder: TFLiteEngine,
    val detector: BlazeFaceDetector,
    val store: EmbeddingStore
  ) {
    fun close() {
      embedder.close()
      detector.close()
      store.close()
    }
  }

  private val lock = Any()
  private var engines: Engines? = null
  private var matchThreshold = DEFAULT_MATCH_THRESHOLD
  private var minQuality = DEFAULT_MIN_QUALITY
  private val secureRandom = SecureRandom()

  /** Creates the engines on first use. Errors propagate to the caller's promise. */
  private fun engines(): Engines = synchronized(lock) {
    engines ?: run {
      val context = reactApplicationContext
      // If a later step fails, close what was already created.
      val created = mutableListOf<Closeable>()
      try {
        val embedder = TFLiteEngine(context.assets).also { created.add(it) }
        val detector = BlazeFaceDetector(context.assets).also { created.add(it) }
        val store = EmbeddingStore.create(context).also { created.add(it) }
        Engines(embedder, detector, store).also { engines = it }
      } catch (e: Exception) {
        created.forEach { runCatching { it.close() } }
        throw e
      }
    }
  }

  override fun invalidate() {
    synchronized(lock) {
      engines?.close()
      engines = null
    }
    super.invalidate()
  }

  override fun initialize(options: ReadableMap?, promise: Promise) = settle(promise) {
    options?.let {
      if (it.hasKey("matchThreshold") && !it.isNull("matchThreshold")) {
        matchThreshold = unitInterval(it.getDouble("matchThreshold"), "matchThreshold")
      }
      if (it.hasKey("minQuality") && !it.isNull("minQuality")) {
        minQuality = unitInterval(it.getDouble("minQuality"), "minQuality")
      }
    }
    engines().store.ensureOpen()
    true
  }

  override fun enrollWorker(
    workerId: String,
    base64Frames: ReadableArray,
    hint: ReadableMap?,
    promise: Promise
  ) = settle(promise) {
    requireValidId(workerId)
    val e = engines()
    val box = readFaceBox(hint)
    val embeddings = mutableListOf<FloatArray>()
    for (i in 0 until base64Frames.size()) {
      val frame = decodeFrame(base64Frames.getString(i) ?: continue) ?: continue
      // Frames with no face, or with several faces and no box, are skipped.
      val face = if (box != null) e.detector.detectNear(frame, box) else e.detector.detect(frame).singleOrNull()
      val aligned = face?.let { e.embedder.alignFace(frame, it) }
      frame.recycle()
      if (aligned != null) {
        embeddings.add(e.embedder.embed(aligned))
        aligned.recycle()
      }
    }
    if (embeddings.isEmpty()) {
      throw BiometricException("NO_FACE", "No single face was found in any of the frames.")
    }
    e.store.saveTemplate(workerId, EmbeddingMath.averageTemplate(embeddings))
    WritableNativeMap().apply {
      putBoolean("success", true)
      putInt("framesUsed", embeddings.size)
    }
  }

  override fun verifyWorker(base64Image: String, hint: ReadableMap?, promise: Promise) = settle(promise) {
    val start = System.nanoTime()
    val e = engines()
    val result = WritableNativeMap()
    fun finish(status: String): WritableNativeMap {
      result.putString("status", status)
      result.putInt("totalMs", ((System.nanoTime() - start) / 1_000_000).toInt())
      return result
    }

    val frame = decodeFrame(base64Image) ?: return@settle finish("NO_FACE")
    try {
      val quality = e.embedder.scoreQuality(frame)
      result.putDouble("quality", quality.toDouble())
      if (quality < minQuality) return@settle finish("POOR_QUALITY")

      // BlazeFace always runs, because its keypoints are needed for alignment.
      // An app-provided box only says which face to use.
      val box = readFaceBox(hint)
      val face = if (box != null) {
        e.detector.detectNear(frame, box)
      } else {
        val faces = e.detector.detect(frame)
        if (faces.size > 1) return@settle finish("MULTIPLE_FACES")
        faces.firstOrNull()
      } ?: return@settle finish("NO_FACE")
      val aligned = e.embedder.alignFace(frame, face) ?: return@settle finish("NO_FACE")
      val embedding = try {
        e.embedder.embed(aligned)
      } finally {
        aligned.recycle()
      }
      result.putInt("inferenceMs", e.embedder.lastInferenceMs.toInt())

      val match = e.store.findBestMatch(embedding, matchThreshold.toFloat())
        ?: return@settle finish("NO_MATCH")
      result.putString("workerId", match.workerId)
      result.putDouble("confidence", match.similarity.toDouble())
      finish("MATCH")
    } finally {
      frame.recycle()
    }
  }

  override fun checkLiveness(landmarks: ReadableArray, promise: Promise) = settle(promise) {
    val points = Array(landmarks.size()) { i ->
      val p = landmarks.getArray(i)
      if (p == null || p.size() < 2) {
        FloatArray(3)
      } else {
        floatArrayOf(p.getDouble(0).toFloat(), p.getDouble(1).toFloat(), if (p.size() > 2) p.getDouble(2).toFloat() else 0f)
      }
    }
    val r = synchronized(lock) { landmarkLiveness.evaluate(points) }
    WritableNativeMap().apply {
      putBoolean("isLive", r.isLive)
      putBoolean("isBlink", r.isBlink)
      putInt("blinkCount", r.blinkCount)
      putDouble("earValue", r.averageEar.toDouble())
    }
  }

  override fun logAndQueueAttendance(
    workerId: String,
    confidence: Double,
    location: ReadableMap?,
    promise: Promise
  ) = settle(promise) {
    requireValidId(workerId)
    var latitude: Double? = null
    var longitude: Double? = null
    if (location != null) {
      latitude = location.getDouble("latitude")
      longitude = location.getDouble("longitude")
      if (latitude !in -90.0..90.0 || longitude !in -180.0..180.0) {
        throw BiometricException("INVALID_ARGUMENT", "Location is out of range.")
      }
    }
    engines().store.queueAttendance(workerId, confidence, latitude, longitude)
    true
  }

  override fun getPendingAttendanceRecords(promise: Promise) = settle(promise) {
    engines().store.pendingRecords()
  }

  override fun markRecordsSynced(recordIds: ReadableArray, promise: Promise) = settle(promise) {
    val ids = (0 until recordIds.size()).mapNotNull { recordIds.getString(it) }
    engines().store.markSynced(ids)
    true
  }

  override fun purgeSyncedRecords(promise: Promise) = settle(promise) {
    engines().store.purgeSynced()
    true
  }

  override fun getSecureRandomBytes(count: Double, promise: Promise) = settle(promise) {
    val n = count.toInt()
    if (n < 1 || n > MAX_RANDOM_BYTES) {
      throw BiometricException("INVALID_ARGUMENT", "count must be from 1 to $MAX_RANDOM_BYTES.")
    }
    val bytes = ByteArray(n).also { secureRandom.nextBytes(it) }
    WritableNativeArray().apply { bytes.forEach { pushInt(it.toInt() and 0xFF) } }
  }

  // --- Helpers ---------------------------------------------------------------

  private val landmarkLiveness = LivenessEngine()

  /** Resolves with the block's value, or rejects with a stable error code. */
  private inline fun settle(promise: Promise, block: () -> Any) {
    try {
      promise.resolve(block())
    } catch (e: BiometricException) {
      promise.reject(e.code, e.message, e)
    } catch (e: OutOfMemoryError) {
      promise.reject("OUT_OF_MEMORY", "Not enough memory to process the image.", e)
    } catch (e: Exception) {
      promise.reject("NATIVE_ERROR", e.message ?: e.javaClass.simpleName, e)
    }
  }

  private fun unitInterval(value: Double, name: String): Double {
    if (value.isNaN() || value < 0.0 || value > 1.0) {
      throw BiometricException("INVALID_ARGUMENT", "$name must be from 0 to 1.")
    }
    return value
  }

  /**
   * IDs are stored and signed as given. `|` is rejected because it separates
   * fields in the signed payload; control characters are rejected so IDs stay
   * printable in exports.
   */
  private fun requireValidId(id: String) {
    if (id.isBlank() || id.length > 128 || id.any { it == '|' || it.isISOControl() }) {
      throw BiometricException(
        "INVALID_ARGUMENT",
        "workerId must be 1 to 128 printable characters and must not contain '|'."
      )
    }
  }

  private fun readFaceBox(hint: ReadableMap?): FaceBox? {
    if (hint == null) return null
    val keys = listOf("nx", "ny", "nw", "nh")
    if (keys.any { !hint.hasKey(it) || hint.isNull(it) }) return null
    return FaceBox(
      hint.getDouble("nx").toFloat(),
      hint.getDouble("ny").toFloat(),
      hint.getDouble("nw").toFloat(),
      hint.getDouble("nh").toFloat()
    )
  }

  /**
   * Decodes a base64 JPEG in memory and applies its EXIF orientation. Camera
   * libraries often store rotation as EXIF instead of rotating the pixels, and
   * front cameras use the mirrored variants, so all eight cases are handled.
   * The result is downscaled to at most [MAX_SIDE] px, which is plenty for a
   * face crop and avoids running out of memory on 12+ MP photos.
   */
  private fun decodeFrame(base64: String): Bitmap? {
    val bytes = try {
      Base64.decode(base64, Base64.DEFAULT)
    } catch (e: IllegalArgumentException) {
      return null
    }
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
    // Power-of-two subsampling while decoding keeps peak memory low.
    var sample = 1
    while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= MAX_SIDE) sample *= 2
    val decoded = BitmapFactory.decodeByteArray(
      bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample }
    ) ?: return null

    val orientation = ExifInterface(ByteArrayInputStream(bytes))
      .getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
    val matrix = Matrix()
    when (orientation) {
      ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.setScale(-1f, 1f)
      ExifInterface.ORIENTATION_ROTATE_180 -> matrix.setRotate(180f)
      ExifInterface.ORIENTATION_FLIP_VERTICAL -> {
        matrix.setRotate(180f)
        matrix.postScale(-1f, 1f)
      }
      ExifInterface.ORIENTATION_TRANSPOSE -> {
        matrix.setRotate(90f)
        matrix.postScale(-1f, 1f)
      }
      ExifInterface.ORIENTATION_ROTATE_90 -> matrix.setRotate(90f)
      ExifInterface.ORIENTATION_TRANSVERSE -> {
        matrix.setRotate(-90f)
        matrix.postScale(-1f, 1f)
      }
      ExifInterface.ORIENTATION_ROTATE_270 -> matrix.setRotate(-90f)
    }
    val longest = maxOf(decoded.width, decoded.height)
    if (longest > MAX_SIDE) {
      val s = MAX_SIDE.toFloat() / longest
      matrix.postScale(s, s)
    }
    if (matrix.isIdentity) return decoded
    val upright = Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, matrix, true)
    if (upright !== decoded) decoded.recycle()
    return upright
  }

  companion object {
    const val NAME = NativeFaceproofSpec.NAME
    // Calibrated on LFW for a false accept rate of 1e-4 per comparison; see docs/BENCHMARKS.md.
    const val DEFAULT_MATCH_THRESHOLD = 0.54
    const val DEFAULT_MIN_QUALITY = 0.5
    private const val MAX_SIDE = 720
    private const val MAX_RANDOM_BYTES = 1024
  }
}
