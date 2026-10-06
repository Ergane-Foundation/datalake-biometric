// SPDX-License-Identifier: Apache-2.0
package com.datalakebiometric

import android.content.res.AssetManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import org.tensorflow.lite.Interpreter
import java.io.Closeable
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * On-device face detection with BlazeFace short-range, used when the app does
 * not pass a face box. Best for faces within about two meters of the camera,
 * which suits selfie-style capture.
 *
 * Not thread-safe: the input and output buffers are reused between calls.
 */
internal class BlazeFaceDetector(assets: AssetManager) : Closeable {
  private val interpreter = Interpreter(
    ModelAssets.load(assets, ModelAssets.BLAZEFACE),
    ModelAssets.interpreterOptions()
  )
  private val size = BlazeFaceDecoder.INPUT_SIZE
  private val input = ByteBuffer.allocateDirect(4 * size * size * 3).order(ByteOrder.nativeOrder())
  private val pixels = IntArray(size * size)
  private val canvasBitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
  private val paint = Paint(Paint.FILTER_BITMAP_FLAG)

  // The model has two outputs; find them by shape instead of trusting the order.
  private val boxesIndex: Int
  private val scoresIndex: Int

  init {
    val first = interpreter.getOutputTensor(0).shape()
    boxesIndex = if (first.last() == BlazeFaceDecoder.NUM_COORDS) 0 else 1
    scoresIndex = 1 - boxesIndex
  }

  /** Detects faces and returns them in source-image coordinates, best first. */
  fun detect(bitmap: Bitmap): List<FaceDetection> {
    val letterbox = BlazeFaceDecoder.letterbox(bitmap.width, bitmap.height)
    fillInput(bitmap, letterbox)

    val boxes = Array(1) { Array(BlazeFaceDecoder.NUM_ANCHORS) { FloatArray(BlazeFaceDecoder.NUM_COORDS) } }
    val scores = Array(1) { Array(BlazeFaceDecoder.NUM_ANCHORS) { FloatArray(1) } }
    val outputs = mapOf<Int, Any>(boxesIndex to boxes, scoresIndex to scores)
    input.rewind()
    interpreter.runForMultipleInputsOutputs(arrayOf<Any>(input), outputs)

    val flatBoxes = FloatArray(BlazeFaceDecoder.NUM_ANCHORS * BlazeFaceDecoder.NUM_COORDS)
    val flatScores = FloatArray(BlazeFaceDecoder.NUM_ANCHORS)
    for (i in 0 until BlazeFaceDecoder.NUM_ANCHORS) {
      boxes[0][i].copyInto(flatBoxes, i * BlazeFaceDecoder.NUM_COORDS)
      flatScores[i] = scores[0][i][0]
    }
    val detections = BlazeFaceDecoder.weightedNms(BlazeFaceDecoder.decode(flatBoxes, flatScores))
    return detections.map { letterbox.toSource(it) }
  }

  /**
   * Finds the face inside an app-provided box (for example from ML Kit), to get
   * its keypoints for alignment. Detection runs on a crop twice the size of the
   * box, so small faces in a large frame are seen at a usable resolution.
   * Returns the best detection whose center lies inside [hint], or null.
   */
  fun detectNear(bitmap: Bitmap, hint: FaceBox): FaceDetection? {
    val w = bitmap.width
    val h = bitmap.height
    val side = (maxOf(hint.nw * w, hint.nh * h) * 2f).toInt().coerceIn(1, minOf(w, h))
    val left = (hint.centerX * w - side / 2f).toInt().coerceIn(0, w - side)
    val top = (hint.centerY * h - side / 2f).toInt().coerceIn(0, h - side)
    val region = Bitmap.createBitmap(bitmap, left, top, side, side)
    val found = try {
      detect(region)
    } finally {
      if (region !== bitmap) region.recycle()
    }
    // Map from region coordinates back to the full image.
    fun x(v: Float) = (left + v * side) / w
    fun y(v: Float) = (top + v * side) / h
    return found
      .map { d ->
        FaceDetection(
          FaceBox(x(d.box.nx), y(d.box.ny), d.box.nw * side / w, d.box.nh * side / h),
          FloatArray(d.keypoints.size) { j -> if (j % 2 == 0) x(d.keypoints[j]) else y(d.keypoints[j]) },
          d.score
        )
      }
      .firstOrNull { hint.contains(it.box.centerX, it.box.centerY) }
  }

  /** Letterboxes the bitmap into the 128x128 input, scaled to [-1, 1] as the model expects. */
  private fun fillInput(bitmap: Bitmap, letterbox: BlazeFaceDecoder.Letterbox) {
    val canvas = Canvas(canvasBitmap)
    canvas.drawColor(Color.BLACK)
    val matrix = Matrix().apply {
      setScale(letterbox.scale, letterbox.scale)
      postTranslate(letterbox.padX, letterbox.padY)
    }
    canvas.drawBitmap(bitmap, matrix, paint)
    canvasBitmap.getPixels(pixels, 0, size, 0, 0, size, size)

    input.rewind()
    for (pixel in pixels) {
      input.putFloat(((pixel shr 16) and 0xFF) / 127.5f - 1f)
      input.putFloat(((pixel shr 8) and 0xFF) / 127.5f - 1f)
      input.putFloat((pixel and 0xFF) / 127.5f - 1f)
    }
  }

  override fun close() {
    interpreter.close()
    canvasBitmap.recycle()
  }
}
