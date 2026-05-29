package com.datalakebiometric

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
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

  override fun multiply(a: Double, b: Double): Double {
    return a * b
  }

  @ReactMethod
  override fun initialize(promise: Promise) {
    try {
      // Engines initialized in constructor
      embeddingStore?.writableDatabase?.close() // Force DB initialization
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("INIT_ERROR", e.message, e)
    }
  }

  @ReactMethod
  override fun enrollWorker(
    workerId: String,
    base64Frames: ReadableArray,
    promise: Promise
  ) {
    try {
      var successCount = 0
      val embeddings = mutableListOf<FloatArray>()

      for (i in 0 until base64Frames.size()) {
        val base64 = base64Frames.getString(i) ?: continue
        val bitmap = decodeBase64ToBitmap(base64)
        if (bitmap != null) {
          val embedding = tfliteEngine?.embed(bitmap)
          if (embedding != null) {
            embeddings.add(embedding)
            successCount++
          }
          bitmap.recycle()
        }
      }

      if (successCount > 0) {
        // Average embeddings
        val avgEmbedding = averageEmbeddings(embeddings)
        embeddingStore?.save(workerId, avgEmbedding)
        
        val result = WritableNativeMap().apply {
          putBoolean("success", true)
          putInt("framesUsed", successCount)
        }
        promise.resolve(result)
      } else {
        promise.reject("ENROLL_FAILED", "No valid frames to enroll")
      }
    } catch (e: Exception) {
      promise.reject("ENROLL_ERROR", e.message, e)
    }
  }

  @ReactMethod
  override fun verifyWorker(base64Image: String, promise: Promise) {
    try {
      val bitmap = decodeBase64ToBitmap(base64Image)
      if (bitmap == null) {
        val result = WritableNativeMap().apply {
          putString("status", "NO_FACE")
        }
        promise.resolve(result)
        return
      }

      val startMs = System.currentTimeMillis()
      
      // Check quality
      val quality = tfliteEngine?.scoreQuality(bitmap) ?: 0f
      if (quality < 0.5f) {
        bitmap.recycle()
        val result = WritableNativeMap().apply {
          putString("status", "POOR_QUALITY")
          putDouble("quality", quality.toDouble())
          putInt("totalMs", (System.currentTimeMillis() - startMs).toInt())
        }
        promise.resolve(result)
        return
      }

      // Get embedding
      val embedding = tfliteEngine?.embed(bitmap)
      if (embedding == null) {
        bitmap.recycle()
        val result = WritableNativeMap().apply {
          putString("status", "NO_FACE")
        }
        promise.resolve(result)
        return
      }

      // Match
      val match = embeddingStore?.findMatch(embedding, 0.6f)
      bitmap.recycle()

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
      BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
    } catch (e: Exception) {
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
