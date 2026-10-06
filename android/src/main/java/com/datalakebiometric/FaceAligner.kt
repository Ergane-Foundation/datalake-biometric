// SPDX-License-Identifier: Apache-2.0
package com.datalakebiometric

/**
 * Computes the transform that aligns a face for the embedding model.
 *
 * MobileFaceNet was trained on 112x112 crops in which the eyes, nose and mouth
 * sit at fixed positions. Feeding it unaligned crops makes different people look
 * alike: on a preliminary LFW subset, alignment raised 10-fold accuracy from
 * about 78% to about 99% with the same model (see docs/BENCHMARKS.md).
 *
 * Pure Kotlin, unit-tested on the JVM.
 */
internal object FaceAligner {
  const val SIZE = 112

  /**
   * Target positions in the 112x112 crop for the right eye, left eye, nose tip
   * and mouth center (left and right from the person's view, so the right eye is
   * on the image's left). These are the widely used ArcFace/insightface
   * reference points; the mouth center is the midpoint of its two mouth corners.
   */
  val TEMPLATE = floatArrayOf(
    38.2946f, 51.6963f,
    73.5318f, 51.5014f,
    56.0252f, 71.7366f,
    56.1396f, 92.2848f
  )

  /**
   * Least-squares similarity transform (rotation, uniform scale, translation, no
   * mirroring) that maps [src] points onto [dst] points. Both are flat x, y
   * arrays of the same length.
   *
   * Returns the row-major 2x3 matrix `[a, -b, tx, b, a, ty]`, meaning
   * `x' = a*x - b*y + tx` and `y' = b*x + a*y + ty`, or null if the source points
   * all coincide.
   */
  fun similarity(src: FloatArray, dst: FloatArray = TEMPLATE): FloatArray? {
    require(src.size == dst.size && src.size >= 4 && src.size % 2 == 0) { "Need matching point lists" }
    val n = src.size / 2
    var sx = 0.0
    var sy = 0.0
    var dx = 0.0
    var dy = 0.0
    for (i in 0 until n) {
      sx += src[2 * i]
      sy += src[2 * i + 1]
      dx += dst[2 * i]
      dy += dst[2 * i + 1]
    }
    sx /= n
    sy /= n
    dx /= n
    dy /= n

    // Closed form for a 2D similarity: with centered points p and q,
    // a = sum(p . q) / sum(|p|^2) and b = sum(p x q) / sum(|p|^2).
    var dot = 0.0
    var cross = 0.0
    var norm = 0.0
    for (i in 0 until n) {
      val px = src[2 * i] - sx
      val py = src[2 * i + 1] - sy
      val qx = dst[2 * i] - dx
      val qy = dst[2 * i + 1] - dy
      dot += px * qx + py * qy
      cross += px * qy - py * qx
      norm += px * px + py * py
    }
    if (norm <= 1e-12) return null
    val a = dot / norm
    val b = cross / norm
    val tx = dx - (a * sx - b * sy)
    val ty = dy - (b * sx + a * sy)
    return floatArrayOf(a.toFloat(), (-b).toFloat(), tx.toFloat(), b.toFloat(), a.toFloat(), ty.toFloat())
  }
}
