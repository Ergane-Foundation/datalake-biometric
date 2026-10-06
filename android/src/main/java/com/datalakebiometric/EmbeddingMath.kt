// SPDX-License-Identifier: Apache-2.0
package com.datalakebiometric

import kotlin.math.sqrt

/** Vector helpers for face embeddings. Pure Kotlin, unit-tested on the JVM. */
internal object EmbeddingMath {

  /** Scales a vector to unit length so a dot product equals cosine similarity. */
  fun l2Normalize(vector: FloatArray): FloatArray {
    var sum = 0f
    for (v in vector) sum += v * v
    val norm = sqrt(sum)
    if (norm == 0f) return vector.copyOf()
    return FloatArray(vector.size) { vector[it] / norm }
  }

  /**
   * Averages several embeddings of the same person into one template and
   * re-normalizes it. Averaging smooths out pose and lighting noise between
   * the enrollment frames.
   */
  fun averageTemplate(embeddings: List<FloatArray>): FloatArray {
    require(embeddings.isNotEmpty()) { "At least one embedding is required" }
    val dim = embeddings[0].size
    require(embeddings.all { it.size == dim }) { "Embeddings have different sizes" }
    val sum = FloatArray(dim)
    for (e in embeddings) for (i in 0 until dim) sum[i] += e[i]
    return l2Normalize(sum)
  }

  /**
   * Cosine similarity of two unit vectors, or null when their sizes differ.
   * A size mismatch means the template was made by a different model, and
   * comparing only the overlapping part would give a meaningless score.
   */
  fun cosine(a: FloatArray, b: FloatArray): Float? {
    if (a.size != b.size) return null
    var dot = 0f
    for (i in a.indices) dot += a[i] * b[i]
    return dot
  }
}
