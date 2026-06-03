package com.datalakebiometric

import android.content.ContentValues
import android.content.Context
import android.provider.Settings
import android.util.Base64
import com.facebook.react.bridge.WritableNativeArray
import com.facebook.react.bridge.WritableNativeMap
import net.sqlcipher.database.SQLiteDatabase
import net.sqlcipher.database.SQLiteOpenHelper
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.UUID
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * On-device storage for face embeddings and offline attendance records.
 *
 * Backed by **SQLCipher 4 (AES-256 CBC)** — the entire `biometric.db` file is
 * encrypted at rest. The passphrase comes from [KeyVault] and is itself
 * protected by an Android Keystore master key, so an attacker with raw access
 * to the device's app sandbox still cannot read embeddings or signed records.
 *
 * Each queued attendance record is signed with HMAC-SHA256 using a separate
 * Keystore-backed key, so the AWS sync handler can detect tampering before
 * accepting a row into DynamoDB.
 */
class EmbeddingStore(context: Context) : SQLiteOpenHelper(context, DB_NAME, null, DB_VERSION) {

    private val deviceId: String = Settings.Secure.getString(
        context.contentResolver,
        Settings.Secure.ANDROID_ID
    ) ?: "unknown"

    private val passphrase: String = KeyVault.dbPassphrase(context)
    private val hmacKey: ByteArray = KeyVault.hmacKey(context)

    init {
        // Idempotent — loads the SQLCipher native libs the first time it's called.
        SQLiteDatabase.loadLibs(context)
    }

    /** The encrypted, opened database. Opened lazily on first use. */
    private val db: SQLiteDatabase by lazy { getWritableDatabase(passphrase) }

    /**
     * Opens (and creates if needed) the encrypted database. Use this from
     * `BiometricSDK.initialize()` so that key derivation and any one-time DB
     * setup costs are paid up-front, not on the first enrolment.
     */
    fun ensureOpen() {
        db
    }

    data class MatchResult(val workerId: String, val similarity: Float)

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

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {}

    fun save(workerId: String, embedding: FloatArray) {
        val values = ContentValues().apply {
            put("worker_id", workerId)
            put("embedding", floatArrayToBytes(embedding))
            put("enrolled_at", System.currentTimeMillis())
        }
        db.insertWithOnConflict("embeddings", null, values, SQLiteDatabase.CONFLICT_REPLACE)
    }

    fun findMatch(query: FloatArray, threshold: Float): MatchResult? {
        val cursor = db.query("embeddings", arrayOf("worker_id", "embedding"), null, null, null, null, null)

        var bestMatch: MatchResult? = null
        var bestSimilarity = threshold
        var topSimilarity = -Float.MAX_VALUE
        var topWorker: String? = null
        var enrolled = 0

        cursor.use {
            while (it.moveToNext()) {
                enrolled++
                val workerId = it.getString(0)
                val embeddingBytes = it.getBlob(1)
                val stored = bytesToFloatArray(embeddingBytes)

                val similarity = dotProduct(query, stored)
                if (similarity > topSimilarity) {
                    topSimilarity = similarity
                    topWorker = workerId
                }
                if (similarity > bestSimilarity) {
                    bestSimilarity = similarity
                    bestMatch = MatchResult(workerId, similarity)
                }
            }
        }

        android.util.Log.d(
            "DatalakeBM",
            "findMatch enrolled=$enrolled threshold=$threshold queryDim=${query.size} top=${topWorker ?: "-"}@${"%.3f".format(topSimilarity)} -> ${bestMatch?.let { "MATCH ${it.workerId}" } ?: "NO_MATCH"}"
        )
        return bestMatch
    }

    fun queueAttendanceRecord(
        workerId: String,
        latitude: Double,
        longitude: Double,
        confidence: Float
    ) {
        val id = UUID.randomUUID().toString()
        val timestamp = System.currentTimeMillis()

        val signatureInput = "$workerId|$timestamp|$latitude|$longitude|$confidence|$deviceId"
        val signature = hmacSha256(signatureInput)

        val values = ContentValues().apply {
            put("id", id)
            put("worker_id", workerId)
            put("timestamp", timestamp)
            put("latitude", latitude)
            put("longitude", longitude)
            put("confidence", confidence)
            put("device_id", deviceId)
            put("signature", signature)
            put("synced", 0)
        }
        db.insert("attendance_log", null, values)
    }

    fun getPendingRecords(): WritableNativeArray {
        val result = WritableNativeArray()

        val cursor = db.query(
            "attendance_log",
            null,
            "synced = 0",
            null, null, null, null
        )

        cursor.use {
            while (it.moveToNext()) {
                val map = WritableNativeMap().apply {
                    putString("id", it.getString(it.getColumnIndexOrThrow("id")))
                    putString("workerId", it.getString(it.getColumnIndexOrThrow("worker_id")))
                    putDouble("timestamp", it.getLong(it.getColumnIndexOrThrow("timestamp")).toDouble())
                    putDouble("latitude", it.getDouble(it.getColumnIndexOrThrow("latitude")))
                    putDouble("longitude", it.getDouble(it.getColumnIndexOrThrow("longitude")))
                    putDouble("confidence", it.getDouble(it.getColumnIndexOrThrow("confidence")))
                    putString("deviceId", it.getString(it.getColumnIndexOrThrow("device_id")))
                    putString("signature", it.getString(it.getColumnIndexOrThrow("signature")))
                }
                result.pushMap(map)
            }
        }

        return result
    }

    fun markSynced(ids: List<String>) {
        if (ids.isEmpty()) return
        val placeholders = ids.joinToString(",") { "?" }
        db.execSQL(
            "UPDATE attendance_log SET synced=1 WHERE id IN ($placeholders)",
            ids.toTypedArray()
        )
    }

    /** Deletes all records that have already been synced to AWS, satisfying the local-purge requirement. */
    fun purgeSynced() {
        db.execSQL("DELETE FROM attendance_log WHERE synced=1")
    }

    private fun floatArrayToBytes(floats: FloatArray): ByteArray {
        val buffer = ByteBuffer.allocate(floats.size * 4).order(ByteOrder.nativeOrder())
        floats.forEach { buffer.putFloat(it) }
        return buffer.array()
    }

    private fun bytesToFloatArray(bytes: ByteArray): FloatArray {
        val buffer = ByteBuffer.wrap(bytes).order(ByteOrder.nativeOrder())
        return FloatArray(bytes.size / 4) { buffer.float }
    }

    private fun dotProduct(a: FloatArray, b: FloatArray): Float {
        var sum = 0f
        val len = minOf(a.size, b.size)
        for (i in 0 until len) sum += a[i] * b[i]
        return sum
    }

    private fun hmacSha256(data: String): String {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(hmacKey, "HmacSHA256"))
        val bytes = mac.doFinal(data.toByteArray(Charsets.UTF_8))
        return Base64.encodeToString(bytes, Base64.NO_WRAP)
    }

    companion object {
        private const val DB_NAME = "biometric.db"
        private const val DB_VERSION = 1
    }
}
