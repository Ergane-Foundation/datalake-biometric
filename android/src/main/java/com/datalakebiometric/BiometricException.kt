// SPDX-License-Identifier: Apache-2.0
package com.datalakebiometric

/**
 * An error with a stable [code] that is passed to JavaScript as the promise
 * rejection code, so apps can react to specific failures (for example
 * `MODEL_NOT_FOUND`) without parsing messages.
 */
internal class BiometricException(
  val code: String,
  message: String,
  cause: Throwable? = null
) : Exception(message, cause)
