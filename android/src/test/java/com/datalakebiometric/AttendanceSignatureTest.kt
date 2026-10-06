// SPDX-License-Identifier: Apache-2.0
package com.datalakebiometric

import org.junit.Assert.assertEquals
import org.junit.Test
import java.util.Locale

class AttendanceSignatureTest {

  @Test
  fun formatsAllFields() {
    assertEquals(
      "v1|rec-1|W-1|1700000000000|10.1234567|-20.0000000|0.912345|dev",
      AttendanceSignature.payload("rec-1", "W-1", 1_700_000_000_000L, 10.1234567, -20.0, 0.9123451, "dev")
    )
  }

  @Test
  fun leavesMissingLocationEmpty() {
    assertEquals(
      "v1|rec-1|W-1|5|||0.500000|dev",
      AttendanceSignature.payload("rec-1", "W-1", 5L, null, null, 0.5, "dev")
    )
  }

  @Test
  fun ignoresTheDeviceLocale() {
    val saved = Locale.getDefault()
    try {
      // German uses a comma as decimal separator.
      Locale.setDefault(Locale.GERMANY)
      assertEquals(
        "v1|a|b|1|1.5000000|2.0000000|0.250000|d",
        AttendanceSignature.payload("a", "b", 1L, 1.5, 2.0, 0.25, "d")
      )
    } finally {
      Locale.setDefault(saved)
    }
  }
}
