// SPDX-License-Identifier: Apache-2.0
package com.faceproof

import kotlin.math.exp
import kotlin.math.max
import kotlin.math.min

/**
 * Turns the raw outputs of MediaPipe's BlazeFace short-range model into face boxes.
 *
 * The model scores 896 fixed anchor positions and predicts a box offset for
 * each. The anchor layout and decoding constants follow MediaPipe's
 * `face_detection_short_range` graph: SSD anchors over a 128x128 input with
 * strides 8, 16, 16, 16, fixed anchor size, sigmoid scores with a 0.5 cut-off,
 * and weighted non-maximum suppression at IoU 0.3.
 *
 * Pure Kotlin with no Android types, so it is unit-tested on the JVM.
 */
internal object BlazeFaceDecoder {
  const val INPUT_SIZE = 128
  const val NUM_ANCHORS = 896
  const val NUM_COORDS = 16

  /**
   * Keypoints per face, in this order (left and right from the person's view):
   * right eye, left eye, nose tip, mouth center, right ear, left ear.
   */
  const val NUM_KEYPOINTS = 6

  private val STRIDES = intArrayOf(8, 16, 16, 16)
  private const val MIN_SCORE = 0.5f
  private const val SCORE_CLIP = 100f
  private const val NMS_IOU_THRESHOLD = 0.3f

  /**
   * A face in normalized coordinates of the 128x128 model input. [keypoints]
   * holds x, y pairs for the [NUM_KEYPOINTS] points, or is empty.
   */
  data class Detection(
    val score: Float,
    val xMin: Float,
    val yMin: Float,
    val width: Float,
    val height: Float,
    val keypoints: FloatArray = FloatArray(0)
  )

  /** Anchor center in normalized model-input coordinates. */
  data class Anchor(val xCenter: Float, val yCenter: Float)

  val anchors: List<Anchor> by lazy { generateAnchors() }

  /**
   * Builds the anchor grid in the model's output order: per feature map, row by
   * row, cell by cell. Consecutive layers with the same stride share one
   * feature map, and each layer adds two anchors per cell (aspect ratio 1 plus
   * one interpolated scale). With a fixed anchor size the scales do not affect
   * decoding, so only the count per cell matters: 16x16x2 + 8x8x6 = 896.
   */
  fun generateAnchors(): List<Anchor> {
    val result = ArrayList<Anchor>(NUM_ANCHORS)
    var layer = 0
    while (layer < STRIDES.size) {
      val stride = STRIDES[layer]
      var anchorsPerCell = 0
      var next = layer
      while (next < STRIDES.size && STRIDES[next] == stride) {
        anchorsPerCell += 2
        next++
      }
      val gridSize = (INPUT_SIZE + stride - 1) / stride
      for (y in 0 until gridSize) {
        for (x in 0 until gridSize) {
          val anchor = Anchor((x + 0.5f) / gridSize, (y + 0.5f) / gridSize)
          repeat(anchorsPerCell) { result.add(anchor) }
        }
      }
      layer = next
    }
    return result
  }

  /**
   * Decodes every anchor whose score passes [minScore].
   *
   * @param boxes Flat regressor output, [NUM_ANCHORS] x [NUM_COORDS]. Per anchor:
   *   x-center, y-center, width and height, then six keypoint x, y pairs, all in
   *   input pixels relative to the anchor.
   * @param scores Flat classifier logits, one per anchor.
   */
  fun decode(boxes: FloatArray, scores: FloatArray, minScore: Float = MIN_SCORE): List<Detection> {
    require(boxes.size == NUM_ANCHORS * NUM_COORDS) { "Expected ${NUM_ANCHORS * NUM_COORDS} box values" }
    require(scores.size == NUM_ANCHORS) { "Expected $NUM_ANCHORS scores" }
    val scale = INPUT_SIZE.toFloat()
    val result = ArrayList<Detection>()
    for (i in 0 until NUM_ANCHORS) {
      val logit = scores[i].coerceIn(-SCORE_CLIP, SCORE_CLIP)
      val score = 1f / (1f + exp(-logit))
      if (score < minScore) continue
      val anchor = anchors[i]
      val base = i * NUM_COORDS
      val xCenter = boxes[base] / scale + anchor.xCenter
      val yCenter = boxes[base + 1] / scale + anchor.yCenter
      val width = boxes[base + 2] / scale
      val height = boxes[base + 3] / scale
      val keypoints = FloatArray(NUM_KEYPOINTS * 2) { j ->
        boxes[base + 4 + j] / scale + if (j % 2 == 0) anchor.xCenter else anchor.yCenter
      }
      result.add(Detection(score, xCenter - width / 2f, yCenter - height / 2f, width, height, keypoints))
    }
    return result
  }

  /**
   * Weighted non-maximum suppression, as in MediaPipe. Overlapping boxes are
   * merged into one score-weighted average box instead of being dropped, which
   * gives steadier boxes than plain NMS. Result is sorted by score, best first.
   */
  fun weightedNms(detections: List<Detection>, iouThreshold: Float = NMS_IOU_THRESHOLD): List<Detection> {
    var remaining = detections.sortedByDescending { it.score }
    val result = ArrayList<Detection>()
    while (remaining.isNotEmpty()) {
      val top = remaining.first()
      // `it === top` keeps a degenerate zero-area box from looping forever.
      val (overlapping, rest) = remaining.partition { it === top || iou(top, it) > iouThreshold }
      val totalScore = overlapping.sumOf { it.score.toDouble() }.toFloat()
      fun weighted(value: (Detection) -> Float) =
        overlapping.sumOf { (value(it) * it.score).toDouble() }.toFloat() / totalScore
      val xMin = weighted { it.xMin }
      val yMin = weighted { it.yMin }
      val xMax = weighted { it.xMin + it.width }
      val yMax = weighted { it.yMin + it.height }
      val keypoints = FloatArray(top.keypoints.size) { j -> weighted { it.keypoints[j] } }
      result.add(Detection(top.score, xMin, yMin, xMax - xMin, yMax - yMin, keypoints))
      remaining = rest
    }
    return result
  }

  fun iou(a: Detection, b: Detection): Float {
    val left = max(a.xMin, b.xMin)
    val top = max(a.yMin, b.yMin)
    val right = min(a.xMin + a.width, b.xMin + b.width)
    val bottom = min(a.yMin + a.height, b.yMin + b.height)
    val intersection = max(0f, right - left) * max(0f, bottom - top)
    val union = a.width * a.height + b.width * b.height - intersection
    return if (union <= 0f) 0f else intersection / union
  }

  /**
   * How a source image is fitted into the square model input: scaled to fit
   * while keeping its aspect ratio, then centered with padding. Faces would be
   * distorted, and detected less reliably, if the image were stretched instead.
   */
  data class Letterbox(
    val sourceWidth: Int,
    val sourceHeight: Int,
    val scale: Float,
    val padX: Float,
    val padY: Float
  ) {
    /** Maps a detection back to normalized coordinates of the source image. */
    fun toSource(d: Detection): FaceDetection {
      val size = INPUT_SIZE.toFloat()
      val box = FaceBox(
        (d.xMin * size - padX) / scale / sourceWidth,
        (d.yMin * size - padY) / scale / sourceHeight,
        d.width * size / scale / sourceWidth,
        d.height * size / scale / sourceHeight
      )
      val keypoints = FloatArray(d.keypoints.size) { j ->
        if (j % 2 == 0) {
          (d.keypoints[j] * size - padX) / scale / sourceWidth
        } else {
          (d.keypoints[j] * size - padY) / scale / sourceHeight
        }
      }
      return FaceDetection(box, keypoints, d.score)
    }
  }

  fun letterbox(sourceWidth: Int, sourceHeight: Int): Letterbox {
    require(sourceWidth > 0 && sourceHeight > 0) { "Image size must be positive" }
    val size = INPUT_SIZE.toFloat()
    val scale = min(size / sourceWidth, size / sourceHeight)
    return Letterbox(
      sourceWidth,
      sourceHeight,
      scale,
      padX = (size - sourceWidth * scale) / 2f,
      padY = (size - sourceHeight * scale) / 2f
    )
  }
}
