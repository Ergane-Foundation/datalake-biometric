// SPDX-License-Identifier: Apache-2.0
package com.faceproof

/**
 * Face bounding box in normalized image coordinates (0..1, origin top-left).
 * Comes either from the app (for example an ML Kit box) or from [BlazeFaceDetector].
 */
internal data class FaceBox(val nx: Float, val ny: Float, val nw: Float, val nh: Float) {
  val centerX get() = nx + nw / 2f
  val centerY get() = ny + nh / 2f

  fun contains(x: Float, y: Float) = x in nx..(nx + nw) && y in ny..(ny + nh)
}

/**
 * A face found by BlazeFace: its box, its keypoints as normalized x, y pairs
 * (order as in [BlazeFaceDecoder.NUM_KEYPOINTS]) and the detection score.
 */
internal class FaceDetection(val box: FaceBox, val keypoints: FloatArray, val score: Float)
