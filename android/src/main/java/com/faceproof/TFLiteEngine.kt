// SPDX-License-Identifier: Apache-2.0
package com.faceproof

import android.content.res.AssetManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Matrix
import android.graphics.Paint
import org.tensorflow.lite.DataType
import org.tensorflow.lite.Interpreter
import org.tensorflow.lite.Tensor
import java.io.Closeable
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * Face embedding with MobileFaceNet, plus the face alignment and frame-quality
 * checks that run before it.
 *
 * The bundled model is float32 with a 112x112 RGB input and a 192-value output.
 * Input and output shapes and types are read from the model, so a different
 * MobileFaceNet export (other output size, int8 quantized) also works; stored
 * templates from another model are then ignored by the size check in [EmbeddingMath.cosine].
 *
 * Not thread-safe: callers serialize access.
 */
internal class TFLiteEngine(assets: AssetManager) : Closeable {
  private val interpreter = Interpreter(
    ModelAssets.load(assets, ModelAssets.MOBILEFACENET),
    ModelAssets.interpreterOptions()
  )

  /** Duration of the last [embed] model run, in milliseconds. */
  var lastInferenceMs: Long = 0L
    private set

  /**
   * Warps the face into the 112x112 layout the model was trained on, using the
   * eyes, nose and mouth keypoints (see [FaceAligner]). Returns null if the
   * keypoints are missing or degenerate.
   */
  fun alignFace(bitmap: Bitmap, face: FaceDetection): Bitmap? {
    if (face.keypoints.size < 8) return null
    val w = bitmap.width
    val h = bitmap.height
    // The first four keypoints, in pixels: right eye, left eye, nose tip, mouth center.
    val points = FloatArray(8) { i -> face.keypoints[i] * if (i % 2 == 0) w else h }
    val t = FaceAligner.similarity(points) ?: return null
    val matrix = Matrix().apply { setValues(floatArrayOf(t[0], t[1], t[2], t[3], t[4], t[5], 0f, 0f, 1f)) }
    val aligned = Bitmap.createBitmap(INPUT_SIZE, INPUT_SIZE, Bitmap.Config.ARGB_8888)
    Canvas(aligned).drawBitmap(bitmap, matrix, Paint(Paint.FILTER_BITMAP_FLAG))
    return aligned
  }

  /** Returns the L2-normalized embedding of an aligned face from [alignFace]. */
  fun embed(faceCrop: Bitmap): FloatArray {
    val inputTensor = interpreter.getInputTensor(0)
    val outputTensor = interpreter.getOutputTensor(0)
    val outDim = outputTensor.shape().last()
    val input = toInputBuffer(faceCrop, inputTensor)

    val start = System.nanoTime()
    val raw = if (outputTensor.dataType() == DataType.FLOAT32) {
      val out = Array(1) { FloatArray(outDim) }
      interpreter.run(input, out)
      out[0]
    } else {
      // Quantized output: real = (q - zeroPoint) * scale.
      val out = Array(1) { ByteArray(outDim) }
      interpreter.run(input, out)
      val q = outputTensor.quantizationParams()
      val unsigned = outputTensor.dataType() == DataType.UINT8
      FloatArray(outDim) { i ->
        val v = if (unsigned) out[0][i].toInt() and 0xFF else out[0][i].toInt()
        (v - q.zeroPoint) * q.scale
      }
    }
    lastInferenceMs = (System.nanoTime() - start) / 1_000_000
    return EmbeddingMath.l2Normalize(raw)
  }

  /** Pixels scaled to [-1, 1], then quantized if the model input is int8 or uint8. */
  private fun toInputBuffer(bitmap: Bitmap, tensor: Tensor): ByteBuffer {
    val pixels = IntArray(INPUT_SIZE * INPUT_SIZE)
    bitmap.getPixels(pixels, 0, INPUT_SIZE, 0, 0, INPUT_SIZE, INPUT_SIZE)

    if (tensor.dataType() == DataType.FLOAT32) {
      val buffer = ByteBuffer.allocateDirect(4 * pixels.size * 3).order(ByteOrder.nativeOrder())
      for (p in pixels) {
        buffer.putFloat(((p shr 16) and 0xFF) / 127.5f - 1f)
        buffer.putFloat(((p shr 8) and 0xFF) / 127.5f - 1f)
        buffer.putFloat((p and 0xFF) / 127.5f - 1f)
      }
      return buffer.rewind() as ByteBuffer
    }

    val q = tensor.quantizationParams()
    val unsigned = tensor.dataType() == DataType.UINT8
    val buffer = ByteBuffer.allocateDirect(pixels.size * 3).order(ByteOrder.nativeOrder())
    for (p in pixels) {
      for (channel in intArrayOf((p shr 16) and 0xFF, (p shr 8) and 0xFF, p and 0xFF)) {
        val quantized = ((channel / 127.5f - 1f) / q.scale + q.zeroPoint).roundToInt()
        buffer.put((if (unsigned) quantized.coerceIn(0, 255) else quantized.coerceIn(-128, 127)).toByte())
      }
    }
    return buffer.rewind() as ByteBuffer
  }

  /**
   * Frame quality from 0 to 1: the mean of a sharpness score (variance of the
   * Laplacian, low for blurred frames) and an exposure score (penalizes very
   * dark or very bright frames). Computed on a 256x256 copy, so the cost does
   * not depend on camera resolution.
   */
  fun scoreQuality(bitmap: Bitmap): Float {
    val size = QUALITY_SIZE
    val scaled = Bitmap.createScaledBitmap(bitmap, size, size, true)
    val pixels = IntArray(size * size)
    scaled.getPixels(pixels, 0, size, 0, 0, size, size)
    if (scaled !== bitmap) scaled.recycle()

    var brightnessSum = 0.0
    var laplacianSquaredSum = 0.0
    var count = 0
    for (y in 1 until size - 1) {
      val row = y * size
      for (x in 1 until size - 1) {
        val c = luma(pixels[row + x])
        brightnessSum += c
        val laplacian = 4 * c - luma(pixels[row - size + x]) - luma(pixels[row + size + x]) -
          luma(pixels[row + x - 1]) - luma(pixels[row + x + 1])
        laplacianSquaredSum += laplacian * laplacian
        count++
      }
    }

    val meanBrightness = brightnessSum / count
    val exposure = if (meanBrightness < 40 || meanBrightness > 220) {
      0.2f
    } else {
      (1.0 - abs(meanBrightness - 130.0) / 130.0).toFloat()
    }
    val laplacianVariance = laplacianSquaredSum / count
    // Maps variance to 0..1; 500 is where a frame starts to look sharp.
    val sharpness = (laplacianVariance / (laplacianVariance + 500.0)).toFloat()
    return (0.5f * sharpness + 0.5f * exposure).coerceIn(0f, 1f)
  }

  private fun luma(pixel: Int): Double =
    0.299 * ((pixel shr 16) and 0xFF) + 0.587 * ((pixel shr 8) and 0xFF) + 0.114 * (pixel and 0xFF)

  override fun close() {
    interpreter.close()
  }

  companion object {
    const val INPUT_SIZE = FaceAligner.SIZE
    private const val QUALITY_SIZE = 256
  }
}
