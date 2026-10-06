// SPDX-License-Identifier: Apache-2.0
package com.datalakebiometric

import kotlin.math.sqrt

/**
 * Experimental blink counter over 468-point MediaPipe Face Mesh landmarks,
 * using the eye aspect ratio (EAR): the eye's height relative to its width,
 * which drops sharply while the eye is closed.
 *
 * Nothing in this package produces Face Mesh landmarks yet. The recommended
 * liveness path is the detector-agnostic session in `src/liveness.ts`.
 */
internal class LivenessEngine {

  data class Result(
    val isLive: Boolean,
    val isBlink: Boolean,
    val blinkCount: Int,
    val averageEar: Float
  )

  // Face Mesh indices of six points around each eye, in EAR order p0..p5.
  private val leftEye = intArrayOf(362, 385, 387, 263, 373, 380)
  private val rightEye = intArrayOf(33, 160, 158, 133, 153, 144)

  private var blinkCount = 0
  private var eyeWasClosed = false
  private val earHistory = ArrayDeque<Float>()

  fun evaluate(landmarks: Array<FloatArray>): Result {
    if (landmarks.size < FACE_MESH_POINTS) return Result(false, false, 0, 0f)

    val ear = (eyeAspectRatio(landmarks, leftEye) + eyeAspectRatio(landmarks, rightEye)) / 2f
    if (earHistory.size >= HISTORY_FRAMES) earHistory.removeFirst()
    earHistory.addLast(ear)

    val closed = ear < EAR_CLOSED
    // Counted on re-opening, so a still photo with closed eyes never counts.
    val isBlink = eyeWasClosed && !closed
    if (isBlink) blinkCount++
    eyeWasClosed = closed

    // A replayed loop tends to show near-constant EAR between blinks; real eyes jitter.
    val isLive = blinkCount >= REQUIRED_BLINKS && variance(earHistory) > MIN_EAR_VARIANCE
    return Result(isLive, isBlink, blinkCount, ear)
  }

  fun reset() {
    blinkCount = 0
    eyeWasClosed = false
    earHistory.clear()
  }

  /** EAR = (|p1 - p5| + |p2 - p4|) / (2 * |p0 - p3|). */
  private fun eyeAspectRatio(points: Array<FloatArray>, idx: IntArray): Float {
    val width = distance(points[idx[0]], points[idx[3]])
    if (width == 0f) return 0f
    return (distance(points[idx[1]], points[idx[5]]) + distance(points[idx[2]], points[idx[4]])) / (2f * width)
  }

  private fun distance(a: FloatArray, b: FloatArray): Float {
    val dx = a[0] - b[0]
    val dy = a[1] - b[1]
    return sqrt(dx * dx + dy * dy)
  }

  private fun variance(values: Collection<Float>): Float {
    if (values.isEmpty()) return 0f
    val mean = values.sum() / values.size
    return values.fold(0f) { acc, v -> acc + (v - mean) * (v - mean) } / values.size
  }

  companion object {
    private const val FACE_MESH_POINTS = 468
    private const val HISTORY_FRAMES = 30
    private const val EAR_CLOSED = 0.20f
    private const val REQUIRED_BLINKS = 2
    private const val MIN_EAR_VARIANCE = 0.0005f
  }
}
