package com.datalakebiometric

import android.content.Context
import android.content.SharedPreferences
import android.util.Base64
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.security.SecureRandom

/**
 * Android-Keystore-backed secret vault.
 *
 * Holds two long-lived secrets used by the biometric SDK:
 *
 *   - **dbPassphrase()** — random 32-byte passphrase used to open the
 *     SQLCipher-encrypted embedding/attendance database. Stored encrypted by
 *     `EncryptedSharedPreferences`, whose master key lives in the
 *     hardware-backed Android Keystore (alias "biometric_db_key", AES-256-GCM).
 *     The raw passphrase never appears on disk in clear text.
 *
 *   - **hmacKey()** — random 32-byte key used to HMAC-SHA256 each attendance
 *     record. Same storage path as the DB passphrase. Replaces the earlier
 *     deviceId-derived key (which was not a secret).
 *
 * Both secrets are generated lazily on first use and persist across app launches.
 * Wiping app data (or uninstalling) destroys them — and with them, the ability
 * to read the encrypted DB or verify signatures, which is the desired behavior.
 */
internal object KeyVault {
    private const val PREFS_NAME = "datalake_biometric_vault"
    private const val KEYSTORE_ALIAS = "biometric_db_key"
    private const val KEY_DB_PASSPHRASE = "db_passphrase_b64"
    private const val KEY_HMAC = "hmac_key_b64"
    private const val SECRET_BYTES = 32

    private val random = SecureRandom()

    @Volatile private var cachedPrefs: SharedPreferences? = null

    private fun prefs(context: Context): SharedPreferences {
        cachedPrefs?.let { return it }
        synchronized(this) {
            cachedPrefs?.let { return it }
            val masterKey = MasterKey.Builder(context.applicationContext, KEYSTORE_ALIAS)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()
            val sp = EncryptedSharedPreferences.create(
                context.applicationContext,
                PREFS_NAME,
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            )
            cachedPrefs = sp
            return sp
        }
    }

    /** SQLCipher passphrase as a base64 string (URL-safe characters only). */
    fun dbPassphrase(context: Context): String {
        val sp = prefs(context)
        sp.getString(KEY_DB_PASSPHRASE, null)?.let { return it }
        val fresh = Base64.encodeToString(randomBytes(), Base64.NO_WRAP or Base64.URL_SAFE)
        sp.edit().putString(KEY_DB_PASSPHRASE, fresh).apply()
        return fresh
    }

    /** Raw bytes of the HMAC-SHA256 signing key. */
    fun hmacKey(context: Context): ByteArray {
        val sp = prefs(context)
        sp.getString(KEY_HMAC, null)?.let { return Base64.decode(it, Base64.NO_WRAP) }
        val fresh = randomBytes()
        sp.edit().putString(KEY_HMAC, Base64.encodeToString(fresh, Base64.NO_WRAP)).apply()
        return fresh
    }

    private fun randomBytes(): ByteArray = ByteArray(SECRET_BYTES).also { random.nextBytes(it) }
}
