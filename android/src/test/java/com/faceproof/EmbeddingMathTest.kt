// SPDX-License-Identifier: Apache-2.0
package com.faceproof

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class EmbeddingMathTest {
  private val eps = 1e-6f

  @Test
  fun normalizesToUnitLength() {
    assertArrayEquals(floatArrayOf(0.6f, 0.8f), EmbeddingMath.l2Normalize(floatArrayOf(3f, 4f)), eps)
    assertArrayEquals(floatArrayOf(0f, 0f), EmbeddingMath.l2Normalize(floatArrayOf(0f, 0f)), eps)
  }

  @Test
  fun averageTemplateIsNormalized() {
    val t = EmbeddingMath.averageTemplate(listOf(floatArrayOf(1f, 0f), floatArrayOf(0f, 1f)))
    assertArrayEquals(floatArrayOf(0.70710677f, 0.70710677f), t, eps)
  }

  @Test(expected = IllegalArgumentException::class)
  fun averageTemplateRejectsMixedSizes() {
    EmbeddingMath.averageTemplate(listOf(floatArrayOf(1f), floatArrayOf(1f, 0f)))
  }

  @Test
  fun cosineOfUnitVectors() {
    assertEquals(1f, EmbeddingMath.cosine(floatArrayOf(0.6f, 0.8f), floatArrayOf(0.6f, 0.8f))!!, eps)
    assertEquals(0f, EmbeddingMath.cosine(floatArrayOf(1f, 0f), floatArrayOf(0f, 1f))!!, eps)
  }

  @Test
  fun cosineIsNullForDifferentModels() {
    assertNull(EmbeddingMath.cosine(FloatArray(192), FloatArray(512)))
  }
}
