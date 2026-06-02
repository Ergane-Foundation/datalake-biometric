package com.datalakebiometric

import kotlin.math.sqrt

class LivenessEngine {

    private val leftEye = listOf(362, 385, 387, 263, 373, 380)
    private val rightEye = listOf(33, 160, 158, 133, 153, 144)

    private val EAR_THRESHOLD = 0.20f

    private var blinkCount: Int = 0
    private var wasEyeClosed: Boolean = false
    private val earHistory: ArrayDeque<Float> = ArrayDeque()

    data class LivenessResult(
        val isLive: Boolean,
        val isBlink: Boolean,
        val blinkCount: Int,
        val avgEar: Float
    )

    fun evaluate(landmarks: Array<FloatArray>): Array<Any?> {
        if (landmarks.size < 468) {
            return arrayOf(false, false, 0, 0f)
        }

        val earLeft = computeEAR(landmarks, leftEye)
        val earRight = computeEAR(landmarks, rightEye)
        val avgEAR = (earLeft + earRight) / 2f

        if (earHistory.size >= 30) earHistory.removeFirst()
        earHistory.addLast(avgEAR)

        val isEyeClosed = avgEAR < EAR_THRESHOLD
        // Count a blink on the re-open transition (closed → open), not on close.
        // This matches the JS ML Kit state machine and prevents a static
        // closed-eye photo from producing unbounded blink counts.
        val isBlink = wasEyeClosed && !isEyeClosed
        if (isBlink) blinkCount++
        wasEyeClosed = isEyeClosed

        val earVariance = computeVariance(earHistory)
        val isLive = blinkCount >= 2 && earVariance > 0.0005f

        return arrayOf(isLive, isBlink, blinkCount, avgEAR)
    }

    private fun computeEAR(landmarks: Array<FloatArray>, indices: List<Int>): Float {
        // EAR = (dist(p1,p5) + dist(p2,p4)) / (2 * dist(p0,p3))
        val p0 = landmarks[indices[0]]
        val p1 = landmarks[indices[1]]
        val p2 = landmarks[indices[2]]
        val p3 = landmarks[indices[3]]
        val p4 = landmarks[indices[4]]
        val p5 = landmarks[indices[5]]

        val horizontal = dist(p0, p3)
        if (horizontal == 0f) return 0f

        return (dist(p1, p5) + dist(p2, p4)) / (2f * horizontal)
    }

    private fun dist(a: FloatArray, b: FloatArray): Float {
        val dx = a[0] - b[0]
        val dy = a[1] - b[1]
        return sqrt(dx * dx + dy * dy)
    }

    private fun computeVariance(values: ArrayDeque<Float>): Float {
        if (values.isEmpty()) return 0f
        val mean = values.sum() / values.size
        return values.fold(0f) { acc, v -> acc + (v - mean) * (v - mean) } / values.size
    }

    fun reset() {
        blinkCount = 0
        wasEyeClosed = false
        earHistory.clear()
    }
}
