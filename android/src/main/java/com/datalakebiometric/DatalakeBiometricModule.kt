package com.datalakebiometric

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import com.facebook.react.bridge.WritableNativeMap
import com.facebook.react.bridge.WritableNativeArray
import kotlin.math.sqrt

class DatalakeBiometricModule(reactContext: ReactApplicationContext) :
  NativeDatalakeBiometricSpec(reactContext) {

  private var tfliteEngine: TFLiteEngine? = null
  private var livenessEngine: LivenessEngine? = null
  private var embeddingStore: EmbeddingStore? = null

  init {
    try {
      tfliteEngine = TFLiteEngine(reactContext.assets)
      livenessEngine = LivenessEngine()
      embeddingStore = EmbeddingStore(reactContext)
    } catch (e: Exception) {
      e.printStackTrace()
    }
  }

  @ReactMethod
  override fun initialize(promise: Promise) {
    try {
      // Engines are initialized in the constructor; this just forces the
      // SQLCipher DB to open (and triggers Keystore key derivation) so the
      // first enrolment doesn't pay that cost.
      embeddingStore?.ensureOpen()
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("INIT_ERROR", e.message, e)
    }
  }

  @ReactMethod
  override fun enrollWorker(
    workerId: String,
    base64Frames: ReadableArray,
    hint: ReadableMap?,
    promise: Promise
  ) {
    try {
      val faceHint = readFaceHint(hint)
      var successCount = 0
      val embeddings = mutableListOf<FloatArray>()

      for (i in 0 until base64Frames.size()) {
        val base64 = base64Frames.getString(i) ?: continue
        val raw = decodeBase64ToBitmap(base64) ?: continue
        // Cap working resolution so scoreQuality / detect / embed don't try to
        // chew through 12 MP per frame. 720 long-side keeps the face at ~300 px.
        val working = downscaleForProcessing(raw)
        // MLKit hint (if JS provided one) gives a tight face box; otherwise we
        // fall back to the center-biased heuristic inside detectAndCrop.
        val faceCrop = tfliteEngine?.detectAndCrop(working, faceHint)
        working.recycle()
        if (faceCrop != null) {
          val embedding = tfliteEngine?.embed(faceCrop)
          faceCrop.recycle()
          if (embedding != null) {
            embeddings.add(embedding)
            successCount++
          }
        }
      }

      if (successCount > 0) {
        val avgEmbedding = averageEmbeddings(embeddings)
        embeddingStore?.save(workerId, avgEmbedding)

        val result = WritableNativeMap().apply {
          putBoolean("success", true)
          putInt("framesUsed", successCount)
        }
        promise.resolve(result)
      } else {
        promise.reject("ENROLL_FAILED", "No face detected in any of the captured frames")
      }
    } catch (e: Exception) {
      promise.reject("ENROLL_ERROR", e.message, e)
    }
  }

  @ReactMethod
  override fun verifyWorker(base64Image: String, hint: ReadableMap?, promise: Promise) {
    val startMs = System.currentTimeMillis()
    try {
      val raw = decodeBase64ToBitmap(base64Image)
      if (raw == null) {
        val result = WritableNativeMap().apply {
          putString("status", "NO_FACE")
          putInt("totalMs", (System.currentTimeMillis() - startMs).toInt())
        }
        promise.resolve(result)
        return
      }
      // Cap the working bitmap before any per-pixel work runs.
      val working = downscaleForProcessing(raw)

      // Quick blur/exposure gate (runs on the downscaled frame)
      val quality = tfliteEngine?.scoreQuality(working) ?: 0f
      if (quality < 0.5f) {
        working.recycle()
        val result = WritableNativeMap().apply {
          putString("status", "POOR_QUALITY")
          putDouble("quality", quality.toDouble())
          putInt("totalMs", (System.currentTimeMillis() - startMs).toInt())
        }
        promise.resolve(result)
        return
      }

      // Tight face crop — MLKit hint preferred, center-heuristic as fallback.
      val faceHint = readFaceHint(hint)
      val faceCrop = tfliteEngine?.detectAndCrop(working, faceHint)
      working.recycle()
      if (faceCrop == null) {
        val result = WritableNativeMap().apply {
          putString("status", "NO_FACE")
          putDouble("quality", quality.toDouble())
          putInt("totalMs", (System.currentTimeMillis() - startMs).toInt())
        }
        promise.resolve(result)
        return
      }

      val embedding = tfliteEngine?.embed(faceCrop)
      faceCrop.recycle()
      if (embedding == null) {
        val result = WritableNativeMap().apply {
          putString("status", "NO_FACE")
          putDouble("quality", quality.toDouble())
          putInt("totalMs", (System.currentTimeMillis() - startMs).toInt())
        }
        promise.resolve(result)
        return
      }

      val match = embeddingStore?.findMatch(embedding, 0.65f)

      val result = WritableNativeMap().apply {
        if (match != null) {
          putString("status", "MATCH")
          putString("workerId", match.workerId)
          putDouble("confidence", match.similarity.toDouble())
        } else {
          putString("status", "NO_MATCH")
        }
        putInt("inferenceMs", tfliteEngine?.lastInferenceMs?.toInt() ?: 0)
        putInt("totalMs", (System.currentTimeMillis() - startMs).toInt())
        putDouble("quality", quality.toDouble())
      }
      promise.resolve(result)
    } catch (e: Exception) {
      promise.reject("VERIFY_ERROR", e.message, e)
    }
  }

  @ReactMethod
  override fun checkLiveness(landmarks: ReadableArray, promise: Promise) {
    try {
      val landmarksArray = Array(landmarks.size()) { FloatArray(3) }
      for (i in 0 until landmarks.size()) {
        val point = landmarks.getArray(i)
        if (point != null) {
          landmarksArray[i][0] = point.getDouble(0).toFloat()
          landmarksArray[i][1] = point.getDouble(1).toFloat()
          landmarksArray[i][2] = point.getDouble(2).toFloat()
        }
      }

      val result = livenessEngine?.evaluate(landmarksArray)

      val response = WritableNativeMap().apply {
        putBoolean("isLive", result?.get(0) == true)
        putBoolean("isBlink", result?.get(1) == true)
        putInt("blinkCount", (result?.get(2) as? Number)?.toInt() ?: 0)
        putDouble("earValue", (result?.get(3) as? Number)?.toDouble() ?: 0.0)
      }
      promise.resolve(response)
    } catch (e: Exception) {
      promise.reject("LIVENESS_ERROR", e.message, e)
    }
  }

  @ReactMethod
  override fun logAndQueueAttendance(
    workerId: String,
    latitude: Double,
    longitude: Double,
    confidence: Double,
    promise: Promise
  ) {
    try {
      embeddingStore?.queueAttendanceRecord(
        workerId,
        latitude,
        longitude,
        confidence.toFloat()
      )
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("LOG_ERROR", e.message, e)
    }
  }

  @ReactMethod
  override fun getPendingAttendanceRecords(promise: Promise) {
    try {
      val result = embeddingStore?.getPendingRecords() ?: WritableNativeArray()
      promise.resolve(result)
    } catch (e: Exception) {
      promise.reject("GET_RECORDS_ERROR", e.message, e)
    }
  }

  @ReactMethod
  override fun markRecordsSynced(recordIds: ReadableArray, promise: Promise) {
    try {
      val ids = mutableListOf<String>()
      for (i in 0 until recordIds.size()) {
        val id = recordIds.getString(i)
        if (id != null) ids.add(id)
      }
      embeddingStore?.markSynced(ids)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("MARK_SYNCED_ERROR", e.message, e)
    }
  }

  // â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  private fun decodeBase64ToBitmap(base64: String): Bitmap? {
    return try {
      val bytes = Base64.decode(base64, Base64.DEFAULT)
      val raw = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return null
      val rawW = raw.width
      val rawH = raw.height

      // Vision Camera writes JPEGs with an EXIF orientation tag instead of
      // pre-rotating pixels. Front-camera selfies on most Android phones come
      // back with orientation 5 or 7 (rotate + mirror), so a simple ROTATE_90
      // case isn't enough — we apply the full 8-value EXIF transform matrix.
      val exif = androidx.exifinterface.media.ExifInterface(java.io.ByteArrayInputStream(bytes))
      val orientation = exif.getAttributeInt(
        androidx.exifinterface.media.ExifInterface.TAG_ORIENTATION,
        androidx.exifinterface.media.ExifInterface.ORIENTATION_NORMAL
      )
      val matrix = android.graphics.Matrix()
      when (orientation) {
        androidx.exifinterface.media.ExifInterface.ORIENTATION_FLIP_HORIZONTAL ->
          matrix.setScale(-1f, 1f)
        androidx.exifinterface.media.ExifInterface.ORIENTATION_ROTATE_180 ->
          matrix.setRotate(180f)
        androidx.exifinterface.media.ExifInterface.ORIENTATION_FLIP_VERTICAL -> {
          matrix.setRotate(180f); matrix.postScale(-1f, 1f)
        }
        androidx.exifinterface.media.ExifInterface.ORIENTATION_TRANSPOSE -> {
          matrix.setRotate(90f); matrix.postScale(-1f, 1f)
        }
        androidx.exifinterface.media.ExifInterface.ORIENTATION_ROTATE_90 ->
          matrix.setRotate(90f)
        androidx.exifinterface.media.ExifInterface.ORIENTATION_TRANSVERSE -> {
          matrix.setRotate(-90f); matrix.postScale(-1f, 1f)
        }
        androidx.exifinterface.media.ExifInterface.ORIENTATION_ROTATE_270 ->
          matrix.setRotate(-90f)
      }
      val upright = if (matrix.isIdentity) {
        raw
      } else {
        val rotated = android.graphics.Bitmap.createBitmap(
          raw, 0, 0, rawW, rawH, matrix, true
        )
        if (rotated !== raw) raw.recycle()
        rotated
      }
      android.util.Log.d(
        "DatalakeBM",
        "decodeBase64ToBitmap raw=${rawW}x${rawH} exif=$orientation -> upright=${upright.width}x${upright.height}"
      )
      upright
    } catch (e: Exception) {
      android.util.Log.e("DatalakeBM", "decodeBase64ToBitmap failed: ${e.message}")
      null
    }
  }

  /**
   * Caps a freshly decoded camera bitmap at `maxSide` px on the longer edge. The
   * native pipeline (scoreQuality, BlazeFace, MobileFaceNet) never needs more
   * than this — running quality scoring on a 12 MP raw bitmap previously caused
   * OutOfMemoryError. Bitmap.createScaledBitmap is a Skia native call, fast.
   */
  private fun downscaleForProcessing(bitmap: Bitmap, maxSide: Int = 720): Bitmap {
    val w = bitmap.width
    val h = bitmap.height
    val longest = maxOf(w, h)
    if (longest <= maxSide) return bitmap
    val scale = maxSide.toFloat() / longest
    val nw = (w * scale).toInt().coerceAtLeast(1)
    val nh = (h * scale).toInt().coerceAtLeast(1)
    val scaled = Bitmap.createScaledBitmap(bitmap, nw, nh, true)
    if (scaled !== bitmap) bitmap.recycle()
    android.util.Log.d("DatalakeBM", "downscaleForProcessing ${w}x${h} -> ${nw}x${nh}")
    return scaled
  }

  /**
   * Pulls a normalized face box (0..1 coords) out of the JS hint map, if any.
   * Returning null falls back to the center-biased crop heuristic.
   */
  private fun readFaceHint(hint: ReadableMap?): TFLiteEngine.FaceHint? {
    if (hint == null) return null
    return try {
      TFLiteEngine.FaceHint(
        nx = hint.getDouble("nx").toFloat(),
        ny = hint.getDouble("ny").toFloat(),
        nw = hint.getDouble("nw").toFloat(),
        nh = hint.getDouble("nh").toFloat()
      )
    } catch (e: Exception) {
      android.util.Log.w("DatalakeBM", "readFaceHint failed: ${e.message}")
      null
    }
  }

  private fun averageEmbeddings(embeddings: List<FloatArray>): FloatArray {
    if (embeddings.isEmpty()) return FloatArray(512)
    val avg = FloatArray(embeddings[0].size)
    for (embedding in embeddings) {
      for (i in embedding.indices) {
        avg[i] += embedding[i]
      }
    }
    for (i in avg.indices) {
      avg[i] /= embeddings.size
    }
    // L2 normalize
    var norm = 0f
    for (v in avg) norm += v * v
    norm = sqrt(norm)
    if (norm > 0) {
      for (i in avg.indices) avg[i] /= norm
    }
    return avg
  }

  companion object {
    const val NAME = NativeDatalakeBiometricSpec.NAME
  }
}
