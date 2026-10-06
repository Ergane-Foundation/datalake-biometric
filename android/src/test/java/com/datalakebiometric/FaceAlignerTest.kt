// SPDX-License-Identifier: Apache-2.0
package com.datalakebiometric

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import kotlin.math.cos
import kotlin.math.sin

class FaceAlignerTest {

  private fun apply(t: FloatArray, points: FloatArray) = FloatArray(points.size) { i ->
    val x = points[i - i % 2]
    val y = points[i - i % 2 + 1]
    if (i % 2 == 0) t[0] * x + t[1] * y + t[2] else t[3] * x + t[4] * y + t[5]
  }

  @Test
  fun templateMapsToItself() {
    val t = FaceAligner.similarity(FaceAligner.TEMPLATE)!!
    assertArrayEquals(floatArrayOf(1f, 0f, 0f, 0f, 1f, 0f), t, 1e-4f)
  }

  @Test
  fun undoesRotationScaleAndShift() {
    // Build a face that is the template rotated by 30 degrees, scaled by 3 and moved.
    val angle = Math.toRadians(30.0)
    val face = FloatArray(8) { i ->
      val x = FaceAligner.TEMPLATE[i - i % 2].toDouble()
      val y = FaceAligner.TEMPLATE[i - i % 2 + 1].toDouble()
      (if (i % 2 == 0) 3 * (x * cos(angle) - y * sin(angle)) + 200 else 3 * (x * sin(angle) + y * cos(angle)) + 50).toFloat()
    }
    val t = FaceAligner.similarity(face)!!
    assertArrayEquals(FaceAligner.TEMPLATE, apply(t, face), 1e-3f)
    // Pure similarity: the 2x2 part is [a, -b; b, a].
    assertEquals(t[0], t[4], 1e-6f)
    assertEquals(-t[1], t[3], 1e-6f)
  }

  @Test
  fun rejectsCoincidentPoints() {
    assertNull(FaceAligner.similarity(FloatArray(8) { 5f }))
  }
}
