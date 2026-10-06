// SPDX-License-Identifier: Apache-2.0
package com.datalakebiometric

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class BlazeFaceDecoderTest {
  private val eps = 1e-5f

  @Test
  fun anchorGridMatchesTheModelOutputLayout() {
    val anchors = BlazeFaceDecoder.generateAnchors()
    assertEquals(896, anchors.size)
    // 16x16 grid, 2 anchors per cell, then 8x8 grid, 6 anchors per cell.
    assertEquals(BlazeFaceDecoder.Anchor(0.03125f, 0.03125f), anchors[0])
    assertEquals(anchors[0], anchors[1])
    assertEquals(BlazeFaceDecoder.Anchor(0.09375f, 0.03125f), anchors[2])
    assertEquals(BlazeFaceDecoder.Anchor(0.0625f, 0.0625f), anchors[512])
    assertTrue((512..517).all { anchors[it] == anchors[512] })
    assertEquals(BlazeFaceDecoder.Anchor(0.9375f, 0.9375f), anchors[895])
  }

  @Test
  fun decodesOffsetsRelativeToTheAnchor() {
    val boxes = FloatArray(896 * 16)
    val scores = FloatArray(896) { -10f }
    val i = 600
    scores[i] = 3f // sigmoid(3) = 0.953
    boxes[i * 16] = 6.4f // +0.05 of the input width
    boxes[i * 16 + 1] = 0f
    boxes[i * 16 + 2] = 32f // width 0.25
    boxes[i * 16 + 3] = 64f // height 0.5
    boxes[i * 16 + 4] = -12.8f // right eye: 0.1 left of the anchor
    boxes[i * 16 + 5] = 6.4f // and 0.05 below it

    val detections = BlazeFaceDecoder.decode(boxes, scores)
    assertEquals(1, detections.size)
    val d = detections[0]
    val anchor = BlazeFaceDecoder.anchors[i]
    assertEquals(0.9526f, d.score, 1e-3f)
    assertEquals(anchor.xCenter + 0.05f - 0.125f, d.xMin, eps)
    assertEquals(anchor.yCenter - 0.25f, d.yMin, eps)
    assertEquals(0.25f, d.width, eps)
    assertEquals(0.5f, d.height, eps)
    assertEquals(12, d.keypoints.size)
    assertEquals(anchor.xCenter - 0.1f, d.keypoints[0], eps)
    assertEquals(anchor.yCenter + 0.05f, d.keypoints[1], eps)
  }

  @Test
  fun dropsLowScores() {
    val scores = FloatArray(896) { -1f } // sigmoid(-1) = 0.27
    assertTrue(BlazeFaceDecoder.decode(FloatArray(896 * 16), scores).isEmpty())
  }

  @Test
  fun weightedNmsMergesOverlapsAndKeepsSeparateFaces() {
    val a = BlazeFaceDecoder.Detection(0.9f, 0.10f, 0.10f, 0.20f, 0.20f)
    val b = BlazeFaceDecoder.Detection(0.6f, 0.12f, 0.10f, 0.20f, 0.20f)
    val far = BlazeFaceDecoder.Detection(0.8f, 0.70f, 0.70f, 0.20f, 0.20f)

    val result = BlazeFaceDecoder.weightedNms(listOf(b, far, a))
    assertEquals(2, result.size)
    assertEquals(0.9f, result[0].score, eps)
    // Score-weighted x: (0.10 * 0.9 + 0.12 * 0.6) / 1.5 = 0.108
    assertEquals(0.108f, result[0].xMin, eps)
    assertEquals(far.score, result[1].score, eps)
    assertEquals(far.xMin, result[1].xMin, eps)
    assertEquals(far.width, result[1].width, eps)
  }

  @Test
  fun weightedNmsAveragesKeypointsByScore() {
    val a = BlazeFaceDecoder.Detection(0.75f, 0.1f, 0.1f, 0.2f, 0.2f, floatArrayOf(0.2f, 0.2f))
    val b = BlazeFaceDecoder.Detection(0.25f, 0.1f, 0.1f, 0.2f, 0.2f, floatArrayOf(0.4f, 0.2f))
    val merged = BlazeFaceDecoder.weightedNms(listOf(a, b)).single()
    assertEquals(0.25f, merged.keypoints[0], eps) // 0.2 * 0.75 + 0.4 * 0.25
    assertEquals(0.2f, merged.keypoints[1], eps)
  }

  @Test
  fun weightedNmsTerminatesOnZeroAreaBoxes() {
    val flat = BlazeFaceDecoder.Detection(0.9f, 0.5f, 0.5f, 0f, 0f)
    assertEquals(2, BlazeFaceDecoder.weightedNms(listOf(flat, flat.copy(score = 0.8f))).size)
  }

  @Test
  fun iouOfIdenticalAndDisjointBoxes() {
    val a = BlazeFaceDecoder.Detection(1f, 0f, 0f, 0.5f, 0.5f)
    assertEquals(1f, BlazeFaceDecoder.iou(a, a), eps)
    assertEquals(0f, BlazeFaceDecoder.iou(a, a.copy(xMin = 0.6f)), eps)
  }

  @Test
  fun letterboxMapsBackToSourceCoordinates() {
    // 720x1280 portrait: scaled by 0.1 to 72x128, centered with 28 px left padding.
    val lb = BlazeFaceDecoder.letterbox(720, 1280)
    assertEquals(0.1f, lb.scale, eps)
    assertEquals(28f, lb.padX, eps)
    assertEquals(0f, lb.padY, eps)

    val wholeImage = BlazeFaceDecoder.Detection(1f, 28f / 128f, 0f, 72f / 128f, 1f)
    val box = lb.toSource(wholeImage).box
    assertEquals(0f, box.nx, eps)
    assertEquals(0f, box.ny, eps)
    assertEquals(1f, box.nw, eps)
    assertEquals(1f, box.nh, eps)
  }
}
