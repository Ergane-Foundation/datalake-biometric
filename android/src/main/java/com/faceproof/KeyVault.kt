// SPDX-License-Identifier: Apache-2.0
package com.faceproof

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.GeneralSecurityException
import java.security.KeyStore
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Holds the two long-lived secrets of the SDK: the database passphrase and the
 * record-signing (HMAC) key. Both are random 32-byte values.
 *
 * Each secret is encrypted with an AES-256-GCM key that lives in the Android
 * Keystore and cannot be exported, then stored in private SharedPreferences.
 * So the app's data directory alone is not enough to decrypt the database: an
 * attacker also needs this device's Keystore.
 *
 * Uninstalling the app or clearing its data destroys the secrets, and with them
 * the stored templates. If app data is restored from a backup onto another
 * device, the secrets cannot be decrypted; apps should exclude the SDK's files
 * from backup (see docs/PRIVACY.md).
 */
internal object KeyVault {
  private const val KEYSTORE = "AndroidKeyStore"
  private const val MASTER_ALIAS = "faceproof_master_v1"
  private const val PREFS = "faceproof_keys_v1"
  private const val GCM_TAG_BITS = 128
  private const val SECRET_BYTES = 32

  private val random = SecureRandom()

  fun dbPassphrase(context: Context): ByteArray = secret(context, "db_passphrase")

  fun hmacKey(context: Context): ByteArray = secret(context, "hmac_key")

  @Synchronized
  private fun secret(context: Context, name: String): ByteArray {
    val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    prefs.getString(name, null)?.let { return unwrap(it) }

    val fresh = ByteArray(SECRET_BYTES).also { random.nextBytes(it) }
    // commit(), not apply(): the secret must be on disk before anything is
    // encrypted with it, or a crash could leave data nobody can decrypt.
    if (!prefs.edit().putString(name, wrap(fresh)).commit()) {
      throw BiometricException("KEYSTORE_ERROR", "Could not store a new key.")
    }
    return fresh
  }

  private fun keyStore(): KeyStore = KeyStore.getInstance(KEYSTORE).apply { load(null) }

  private fun masterKey(): SecretKey {
    (keyStore().getKey(MASTER_ALIAS, null) as? SecretKey)?.let { return it }
    val spec = KeyGenParameterSpec.Builder(
      MASTER_ALIAS,
      KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
    )
      .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
      .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
      .setKeySize(256)
      .build()
    return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
      .apply { init(spec) }
      .generateKey()
  }

  /** Encrypts with a fresh random IV chosen by the Keystore; stores "iv:ciphertext". */
  private fun wrap(plain: ByteArray): String {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, masterKey())
    val encoded = { bytes: ByteArray -> Base64.encodeToString(bytes, Base64.NO_WRAP) }
    return encoded(cipher.iv) + ":" + encoded(cipher.doFinal(plain))
  }

  private fun unwrap(stored: String): ByteArray {
    val parts = stored.split(":")
    if (parts.size != 2) {
      throw BiometricException("KEYSTORE_ERROR", "Stored key data is corrupted.")
    }
    try {
      val iv = Base64.decode(parts[0], Base64.NO_WRAP)
      val data = Base64.decode(parts[1], Base64.NO_WRAP)
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.DECRYPT_MODE, masterKey(), GCMParameterSpec(GCM_TAG_BITS, iv))
      return cipher.doFinal(data)
    } catch (e: GeneralSecurityException) {
      throw BiometricException(
        "KEYSTORE_ERROR",
        "Stored keys cannot be decrypted on this device, for example after restoring app " +
          "data from a backup. Clear the app's data to start over.",
        e
      )
    } catch (e: IllegalArgumentException) {
      throw BiometricException("KEYSTORE_ERROR", "Stored key data is corrupted.", e)
    }
  }
}
