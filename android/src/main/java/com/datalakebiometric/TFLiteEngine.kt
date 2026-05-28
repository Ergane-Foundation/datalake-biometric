package com.datalakebiometric

import android.content.res.AssetManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Rect
import org.tensorflow.lite.Interpreter
import java.io.FileInputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.MappedByteBuffer
import java.nio.channels.FileChannel
import kotlin.math.abs
import kotlin.math.sqrt

class TFLiteEngine(private val assetManager: AssetManager) {

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

    fun detectAndCrop(bitmap: Bitmap): Bitmap? {
        val resized = Bitmap.createScaledBitmap(bitmap, 128, 128, true)
        val inputBuffer = bitmapToBuffer(resized, 128, 128)

        // boxes: [1][896][16], scores: [1][896][1]
        val boxes = Array(1) { Array(896) { FloatArray(16) } }
        val scores = Array(1) { Array(896) { FloatArray(1) } }

        val outputs = mapOf(0 to boxes, 1 to scores)
        blazeFaceInterpreter.runForMultipleInputsOutputs(arrayOf(inputBuffer), outputs)

        var bestScore = 0.6f
        var bestBox: FloatArray? = null

        for (i in 0 until 896) {
            val score = scores[0][i][0]
            if (score > bestScore) {
                bestScore = score
                bestBox = boxes[0][i]
            }
        }

        bestBox ?: return null

        // BlazeFace box format: [ymin, xmin, ymax, xmax, ...]
        val yMin = (bestBox[0] * bitmap.height).toInt().coerceIn(0, bitmap.height)
        val xMin = (bestBox[1] * bitmap.width).toInt().coerceIn(0, bitmap.width)
        val yMax = (bestBox[2] * bitmap.height).toInt().coerceIn(0, bitmap.height)
        val xMax = (bestBox[3] * bitmap.width).toInt().coerceIn(0, bitmap.width)

        if (xMax <= xMin || yMax <= yMin) return null

        val cropped = Bitmap.createBitmap(bitmap, xMin, yMin, xMax - xMin, yMax - yMin)
        return Bitmap.createScaledBitmap(cropped, 112, 112, true)
    }

    fun embed(faceCrop: Bitmap): FloatArray {
        val inputBuffer = bitmapToBuffer(faceCrop, 112, 112)

        val output = Array(1) { FloatArray(512) }

        val start = System.currentTimeMillis()
        mobileFaceNetInterpreter.run(inputBuffer, output)
        lastInferenceMs = System.currentTimeMillis() - start

        return l2Normalize(output[0])
    }

    fun scoreQuality(bitmap: Bitmap): Float {
        val width = bitmap.width
        val height = bitmap.height
        val pixels = IntArray(width * height)
        bitmap.getPixels(pixels, 0, width, 0, 0, width, height)

        var totalBrightness = 0.0
        val laplacianValues = mutableListOf<Double>()

        for (y in 1 until height - 1) {
            for (x in 1 until width - 1) {
                val pixel = pixels[y * width + x]
                val r = (pixel shr 16) and 0xFF
                val g = (pixel shr 8) and 0xFF
                val b = pixel and 0xFF
                val gray = 0.299 * r + 0.587 * g + 0.114 * b
                totalBrightness += gray

                // Laplacian kernel: center*4 - neighbors
                val grayTop = luma(pixels[(y - 1) * width + x])
                val grayBottom = luma(pixels[(y + 1) * width + x])
                val grayLeft = luma(pixels[y * width + (x - 1)])
                val grayRight = luma(pixels[y * width + (x + 1)])
                val lap = gray * 4 - grayTop - grayBottom - grayLeft - grayRight
                laplacianValues.add(lap * lap)
            }
        }

        val meanBrightness = totalBrightness / (width * height)
        val exposureScore = if (meanBrightness < 40 || meanBrightness > 220) 0.2f
        else 1.0f - abs(meanBrightness - 130) / 130f

        val laplacianVariance = if (laplacianValues.isEmpty()) 0.0
        else laplacianValues.average()

        val blurScore = (laplacianVariance / (laplacianVariance + 500.0)).toFloat().coerceIn(0f, 1f)

        return (0.5f * blurScore + 0.5f * exposureScore).coerceIn(0f, 1f)
    }

    private fun luma(pixel: Int): Double {
        val r = (pixel shr 16) and 0xFF
        val g = (pixel shr 8) and 0xFF
        val b = pixel and 0xFF
        return 0.299 * r + 0.587 * g + 0.114 * b
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
