package com.datalakebiometric

import android.content.res.AssetManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Rect
import org.tensorflow.lite.DataType
import org.tensorflow.lite.Interpreter
import org.tensorflow.lite.Tensor
import java.io.FileInputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.MappedByteBuffer
import java.nio.channels.FileChannel
import kotlin.math.abs
import kotlin.math.sqrt

class TFLiteEngine(private val assetManager: AssetManager) {

    /**
     * Normalized (0..1) face box hint coming from the JS-side MLKit detector.
     * When supplied, `detectAndCrop` skips the center heuristic and crops a tight
     * square around this region (with a little padding for forehead and chin).
     */
    data class FaceHint(val nx: Float, val ny: Float, val nw: Float, val nh: Float)

    private val blazeFaceInterpreter: Interpreter
    private val mobileFaceNetInterpreter: Interpreter

    var lastInferenceMs: Long = 0L
        private set

    init {
        val options = Interpreter.Options().apply {
            numThreads = 4
            useXNNPACK = true
        }
        blazeFaceInterpreter = Interpreter(loadModelFromAssets("models/blazeface.tflite"), options)
        mobileFaceNetInterpreter = Interpreter(loadModelFromAssets("models/mobilefacenet_int8.tflite"), options)
    }

    private fun loadModelFromAssets(path: String): MappedByteBuffer {
        val fd = assetManager.openFd(path)
        val inputStream = FileInputStream(fd.fileDescriptor)
        val channel = inputStream.channel
        return channel.map(FileChannel.MapMode.READ_ONLY, fd.startOffset, fd.declaredLength)
    }

    fun detectAndCrop(bitmap: Bitmap, hint: FaceHint? = null): Bitmap? {
        val bw = bitmap.width
        val bh = bitmap.height

        // ── HINT path: MLKit face box from the JS frame processor. ──
        // We pad the box by 20% on each side so the crop includes forehead and
        // chin (MobileFaceNet was trained on faces with that headroom), then
        // square it off using the longer dimension.
        if (hint != null && hint.nw > 0f && hint.nh > 0f) {
            val pad = 0.20f
            val cx = (hint.nx + hint.nw / 2f).coerceIn(0f, 1f)
            val cy = (hint.ny + hint.nh / 2f).coerceIn(0f, 1f)
            val sideNorm = maxOf(hint.nw, hint.nh) * (1f + 2f * pad)
            val sidePx = (sideNorm * minOf(bw, bh)).toInt().coerceAtLeast(64)
            val cxPx = (cx * bw).toInt()
            val cyPx = (cy * bh).toInt()
            var x = (cxPx - sidePx / 2).coerceAtLeast(0)
            var y = (cyPx - sidePx / 2).coerceAtLeast(0)
            val side = minOf(sidePx, bw - x, bh - y).coerceAtLeast(64)
            // Re-clamp the top-left in case the side had to shrink to fit.
            x = x.coerceAtMost(bw - side)
            y = y.coerceAtMost(bh - side)

            android.util.Log.d(
                "DatalakeBM",
                "detectAndCrop HINT in=${bw}x${bh} norm=(${"%.2f".format(hint.nx)},${"%.2f".format(hint.ny)},${"%.2f".format(hint.nw)},${"%.2f".format(hint.nh)}) -> crop=${side}x$side @ ($x,$y)"
            )

            return try {
                val cropped = Bitmap.createBitmap(bitmap, x, y, side, side)
                val out = Bitmap.createScaledBitmap(cropped, 112, 112, true)
                if (cropped !== out) cropped.recycle()
                out
            } catch (e: Exception) {
                android.util.Log.e("DatalakeBM", "detectAndCrop hint crop failed: ${e.message}")
                null
            }
        }

        // ── FALLBACK path: center-biased heuristic. ──
        // BlazeFace's MediaPipe post-processing (anchor decoding + NMS + sigmoid)
        // is not implemented here, so we trust the upstream MLKit "Face detected"
        // indicator and take a center-biased square crop tuned for selfie capture
        // (60% of the smaller dim, upper-third biased on portrait shots).
        val side = (minOf(bw, bh) * 6) / 10
        if (side < 32) return null
        val x = ((bw - side) / 2).coerceAtLeast(0)
        val isPortrait = bh > bw
        val y = if (isPortrait) {
            ((bh - side) / 4).coerceAtLeast(0)
        } else {
            ((bh - side) / 2).coerceAtLeast(0)
        }

        android.util.Log.d(
            "DatalakeBM",
            "detectAndCrop FALLBACK in=${bw}x${bh} crop=${side}x$side @ ($x,$y) portrait=$isPortrait"
        )

        return try {
            val cropped = Bitmap.createBitmap(bitmap, x, y, side, side)
            Bitmap.createScaledBitmap(cropped, 112, 112, true)
        } catch (e: Exception) {
            android.util.Log.e("DatalakeBM", "detectAndCrop crop failed: ${e.message}")
            null
        }
    }

    fun embed(faceCrop: Bitmap): FloatArray {
        // Adapt to whatever MobileFaceNet variant is bundled: the output dimension
        // (128 / 192 / 512 ...) and the I/O dtype (float32, float16 -> float32, or
        // int8/uint8 quantized) are read from the model instead of being hard-coded.
        val inputTensor = mobileFaceNetInterpreter.getInputTensor(0)
        val outputTensor = mobileFaceNetInterpreter.getOutputTensor(0)
        val outShape = outputTensor.shape()
        val outDim = outShape[outShape.size - 1]

        val inputBuffer = faceInputBuffer(faceCrop, 112, 112, inputTensor)

        val start = System.currentTimeMillis()
        val embedding: FloatArray = if (outputTensor.dataType() == DataType.FLOAT32) {
            val out = Array(1) { FloatArray(outDim) }
            mobileFaceNetInterpreter.run(inputBuffer, out)
            out[0]
        } else {
            // Dequantize int8/uint8 output: real = (q - zeroPoint) * scale
            val out = Array(1) { ByteArray(outDim) }
            mobileFaceNetInterpreter.run(inputBuffer, out)
            val q = outputTensor.quantizationParams()
            val unsigned = outputTensor.dataType() == DataType.UINT8
            FloatArray(outDim) { i ->
                val raw = if (unsigned) (out[0][i].toInt() and 0xFF) else out[0][i].toInt()
                (raw - q.zeroPoint) * q.scale
            }
        }
        lastInferenceMs = System.currentTimeMillis() - start

        return l2Normalize(embedding)
    }

    /**
     * Builds the MobileFaceNet input buffer, matching the model's input dtype.
     * Pixels are normalized to [-1, 1]; for quantized models they are then mapped
     * into the tensor's quantization range.
     */
    private fun faceInputBuffer(bitmap: Bitmap, width: Int, height: Int, tensor: Tensor): ByteBuffer {
        val scaled = Bitmap.createScaledBitmap(bitmap, width, height, true)
        val pixels = IntArray(width * height)
        scaled.getPixels(pixels, 0, width, 0, 0, width, height)

        if (tensor.dataType() == DataType.FLOAT32) {
            val buffer = ByteBuffer.allocateDirect(4 * width * height * 3).order(ByteOrder.nativeOrder())
            for (pixel in pixels) {
                buffer.putFloat(((pixel shr 16 and 0xFF) / 127.5f) - 1f)
                buffer.putFloat(((pixel shr 8 and 0xFF) / 127.5f) - 1f)
                buffer.putFloat(((pixel and 0xFF) / 127.5f) - 1f)
            }
            buffer.rewind()
            return buffer
        }

        // Quantized input (int8 / uint8)
        val q = tensor.quantizationParams()
        val unsigned = tensor.dataType() == DataType.UINT8
        val buffer = ByteBuffer.allocateDirect(width * height * 3).order(ByteOrder.nativeOrder())
        for (pixel in pixels) {
            val channels = intArrayOf(pixel shr 16 and 0xFF, pixel shr 8 and 0xFF, pixel and 0xFF)
            for (c in channels) {
                val norm = (c / 127.5f) - 1f
                val quantized = Math.round(norm / q.scale + q.zeroPoint)
                val clamped = if (unsigned) quantized.coerceIn(0, 255) else quantized.coerceIn(-128, 127)
                buffer.put(clamped.toByte())
            }
        }
        buffer.rewind()
        return buffer
    }

    fun scoreQuality(bitmap: Bitmap): Float {
        // Always score against a small fixed-size copy so cost is O(TARGET^2),
        // independent of the source resolution. The previous implementation
        // allocated IntArray(width*height) (~50 MB on a 12 MP frame) and a
        // boxed mutableListOf<Double>() that grew to width*height entries
        // (~200 MB peak) — that OOMed the verify pipeline silently.
        // 256x256 retains enough high-frequency edge content for a meaningful
        // Laplacian-variance blur estimate.
        val target = 256
        val scaled = Bitmap.createScaledBitmap(bitmap, target, target, true)
        val pixels = IntArray(target * target) // 256 KB — safe
        scaled.getPixels(pixels, 0, target, 0, 0, target, target)
        if (scaled !== bitmap) scaled.recycle()

        var brightnessSum = 0.0
        // Streaming accumulator: mean of squared Laplacians, no list growth.
        var lapSqSum = 0.0
        var lapCount = 0L

        for (y in 1 until target - 1) {
            val rowBase = y * target
            for (x in 1 until target - 1) {
                val c = luma(pixels[rowBase + x])
                brightnessSum += c

                val t = luma(pixels[rowBase - target + x])
                val b = luma(pixels[rowBase + target + x])
                val l = luma(pixels[rowBase + x - 1])
                val r = luma(pixels[rowBase + x + 1])
                val lap = c * 4 - t - b - l - r

                lapSqSum += lap * lap
                lapCount++
            }
        }

        val meanBrightness = brightnessSum / (target * target)
        val exposureScore = if (meanBrightness < 40 || meanBrightness > 220) 0.2f
        else (1.0f - (abs(meanBrightness - 130.0) / 130.0).toFloat())

        val laplacianVariance = if (lapCount > 0L) lapSqSum / lapCount else 0.0
        val blurScore = (laplacianVariance / (laplacianVariance + 500.0)).toFloat().coerceIn(0f, 1f)

        val result = (0.5f * blurScore + 0.5f * exposureScore).coerceIn(0f, 1f)
        android.util.Log.d(
            "DatalakeBM",
            "scoreQuality bright=${"%.1f".format(meanBrightness)} lapVar=${"%.1f".format(laplacianVariance)} expo=${"%.2f".format(exposureScore)} blur=${"%.2f".format(blurScore)} -> ${"%.2f".format(result)}"
        )
        return result
    }

    private fun luma(pixel: Int): Double {
        val r = ((pixel shr 16) and 0xFF).toDouble()
        val g = ((pixel shr 8) and 0xFF).toDouble()
        val b = (pixel and 0xFF).toDouble()
        return 0.299.toDouble() * r + 0.587.toDouble() * g + 0.114.toDouble() * b
    }

    private fun bitmapToBuffer(bitmap: Bitmap, width: Int, height: Int): ByteBuffer {
        val buffer = ByteBuffer.allocateDirect(4 * width * height * 3)
        buffer.order(ByteOrder.nativeOrder())

        val pixels = IntArray(width * height)
        bitmap.getPixels(pixels, 0, width, 0, 0, width, height)

        for (pixel in pixels) {
            val r = ((pixel shr 16) and 0xFF) / 127.5f - 1f
            val g = ((pixel shr 8) and 0xFF) / 127.5f - 1f
            val b = (pixel and 0xFF) / 127.5f - 1f
            buffer.putFloat(r)
            buffer.putFloat(g)
            buffer.putFloat(b)
        }

        buffer.rewind()
        return buffer
    }

    private fun l2Normalize(embedding: FloatArray): FloatArray {
        val norm = sqrt(embedding.fold(0f) { acc, v -> acc + v * v })
        if (norm == 0f) return embedding
        return FloatArray(embedding.size) { embedding[it] / norm }
    }

    fun close() {
        blazeFaceInterpreter.close()
        mobileFaceNetInterpreter.close()
    }
}
