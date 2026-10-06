// SPDX-License-Identifier: Apache-2.0
package com.datalakebiometric

import android.annotation.SuppressLint
import android.content.ContentValues
import android.content.Context
import android.provider.Settings
import android.util.Base64
import com.facebook.react.bridge.WritableNativeArray
import com.facebook.react.bridge.WritableNativeMap
import net.zetetic.database.sqlcipher.SQLiteDatabase
import net.zetetic.database.sqlcipher.SQLiteOpenHelper
import java.io.Closeable
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.UUID
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * Encrypted on-device storage for face templates and queued attendance records.
 *
 * The whole database file is encrypted with SQLCipher (AES-256). Its passphrase
 * and the record-signing key come from [KeyVault] and never leave the device.
 * Only templates (embedding vectors) are stored, never images.
 */
internal class EmbeddingStore private constructor(context: Context, passphrase: ByteArray) :
  SQLiteOpenHelper(context, DB_NAME, passphrase, null, DB_VERSION, 0, null, null, false),
  Closeable {

  /**
   * Per-app, per-device identifier (Settings.Secure.ANDROID_ID). It identifies
   * the installation in synced records; it is not a hardware ID.
   */
  @SuppressLint("HardwareIds")
  private val deviceId: String =
    Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID) ?: "unknown"

  private val hmacKey: ByteArray = KeyVault.hmacKey(context)

  private val db: SQLiteDatabase by lazy { writableDatabase }

  /** Opens the database now, so key setup cost and errors surface in initialize(). */
  fun ensureOpen() {
    db
  }

  data class Match(val workerId: String, val similarity: Float)

  override fun onCreate(db: SQLiteDatabase) {
    db.execSQL(
      """CREATE TABLE IF NOT EXISTS embeddings (
          worker_id TEXT PRIMARY KEY,
          embedding BLOB,
          enrolled_at INTEGER
      )"""
    )
    db.execSQL(
      """CREATE TABLE IF NOT EXISTS attendance_log (
          id TEXT PRIMARY KEY,
          worker_id TEXT,
          timestamp INTEGER,
          latitude REAL,
          longitude REAL,
          confidence REAL,
          device_id TEXT,
          signature TEXT,
          synced INTEGER DEFAULT 0
      )"""
    )
  }

  override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
    // Version 1 is the only schema so far.
  }

  /** Stores or replaces the template for [workerId]. */
  fun saveTemplate(workerId: String, embedding: FloatArray) {
    val values = ContentValues().apply {
      put("worker_id", workerId)
      put("embedding", toBytes(embedding))
      put("enrolled_at", System.currentTimeMillis())
    }
    db.insertWithOnConflict("embeddings", null, values, SQLiteDatabase.CONFLICT_REPLACE)
  }

  /**
   * Linear 1:N search: returns the most similar template if it reaches
   * [threshold], else null. Templates of another embedding size (made by a
   * different model) are skipped; re-enroll those people after a model change.
   */
  fun findBestMatch(query: FloatArray, threshold: Float): Match? {
    var best: Match? = null
    db.query("embeddings", arrayOf("worker_id", "embedding"), null, null, null, null, null).use { c ->
      while (c.moveToNext()) {
        val similarity = EmbeddingMath.cosine(query, toFloats(c.getBlob(1))) ?: continue
        if (similarity >= threshold && similarity > (best?.similarity ?: Float.NEGATIVE_INFINITY)) {
          best = Match(c.getString(0), similarity)
        }
      }
    }
    return best
  }

  /** Queues a signed attendance record. Location is optional. */
  fun queueAttendance(workerId: String, confidence: Double, latitude: Double?, longitude: Double?) {
    val id = UUID.randomUUID().toString()
    val timestamp = System.currentTimeMillis()
    val payload = AttendanceSignature.payload(
      id, workerId, timestamp, latitude, longitude, confidence, deviceId
    )
    val values = ContentValues().apply {
      put("id", id)
      put("worker_id", workerId)
      put("timestamp", timestamp)
      if (latitude != null) put("latitude", latitude) else putNull("latitude")
      if (longitude != null) put("longitude", longitude) else putNull("longitude")
      put("confidence", confidence)
      put("device_id", deviceId)
      put("signature", hmacSha256(payload))
      put("synced", 0)
    }
    db.insertOrThrow("attendance_log", null, values)
  }

  fun pendingRecords(): WritableNativeArray {
    val result = WritableNativeArray()
    db.query("attendance_log", null, "synced = 0", null, null, null, "timestamp ASC").use { c ->
      val lat = c.getColumnIndexOrThrow("latitude")
      val lng = c.getColumnIndexOrThrow("longitude")
      while (c.moveToNext()) {
        result.pushMap(
          WritableNativeMap().apply {
            putString("id", c.getString(c.getColumnIndexOrThrow("id")))
            putString("workerId", c.getString(c.getColumnIndexOrThrow("worker_id")))
            putDouble("timestamp", c.getLong(c.getColumnIndexOrThrow("timestamp")).toDouble())
            if (!c.isNull(lat)) putDouble("latitude", c.getDouble(lat))
            if (!c.isNull(lng)) putDouble("longitude", c.getDouble(lng))
            putDouble("confidence", c.getDouble(c.getColumnIndexOrThrow("confidence")))
            putString("deviceId", c.getString(c.getColumnIndexOrThrow("device_id")))
            putString("signature", c.getString(c.getColumnIndexOrThrow("signature")))
          }
        )
      }
    }
    return result
  }

  fun markSynced(ids: List<String>) {
    if (ids.isEmpty()) return
    val placeholders = ids.joinToString(",") { "?" }
    db.execSQL("UPDATE attendance_log SET synced = 1 WHERE id IN ($placeholders)", ids.toTypedArray())
  }

  fun purgeSynced() {
    db.execSQL("DELETE FROM attendance_log WHERE synced = 1")
  }

  private fun hmacSha256(data: String): String {
    val mac = Mac.getInstance("HmacSHA256")
    mac.init(SecretKeySpec(hmacKey, "HmacSHA256"))
    return Base64.encodeToString(mac.doFinal(data.toByteArray(Charsets.UTF_8)), Base64.NO_WRAP)
  }

  private fun toBytes(floats: FloatArray): ByteArray {
    val buffer = ByteBuffer.allocate(floats.size * 4).order(ByteOrder.LITTLE_ENDIAN)
    floats.forEach { buffer.putFloat(it) }
    return buffer.array()
  }

  private fun toFloats(bytes: ByteArray): FloatArray {
    val buffer = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
    return FloatArray(bytes.size / 4) { buffer.float }
  }

  companion object {
    private const val DB_NAME = "biometric.db"
    private const val DB_VERSION = 1

    /**
     * Creates the store. Data from versions before 0.2.0 is removed first,
     * because its keys cannot be read any more (see [KeyVault.resetLegacyInstall]).
     */
    fun create(context: Context): EmbeddingStore {
      KeyVault.resetLegacyInstall(context, DB_NAME)
      System.loadLibrary("sqlcipher")
      return EmbeddingStore(context, KeyVault.dbPassphrase(context))
    }
  }
}
