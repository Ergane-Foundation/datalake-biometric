// SPDX-License-Identifier: Apache-2.0
package com.faceproof

import java.util.Locale

/**
 * Canonical text that is HMAC-signed for each attendance record.
 *
 * Format (version 1), fields joined by `|`:
 * `v1|id|workerId|timestamp|latitude|longitude|confidence|deviceId`
 *
 * - `timestamp` is milliseconds since the Unix epoch.
 * - `latitude` and `longitude` have 7 decimals, or are empty when absent.
 * - `confidence` has 6 decimals.
 * - Numbers always use `.` as the decimal separator, whatever the device locale.
 *
 * iOS builds exactly the same string, so a server that knows a device's key
 * can verify records from both platforms. Keep the two in sync.
 */
internal object AttendanceSignature {
  fun payload(
    id: String,
    workerId: String,
    timestampMs: Long,
    latitude: Double?,
    longitude: Double?,
    confidence: Double,
    deviceId: String
  ): String {
    fun coordinate(v: Double?) = if (v == null) "" else String.format(Locale.ROOT, "%.7f", v)
    return listOf(
      "v1",
      id,
      workerId,
      timestampMs.toString(),
      coordinate(latitude),
      coordinate(longitude),
      String.format(Locale.ROOT, "%.6f", confidence),
      deviceId
    ).joinToString("|")
  }
}
