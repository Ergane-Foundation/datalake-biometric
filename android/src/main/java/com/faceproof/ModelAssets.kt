// SPDX-License-Identifier: Apache-2.0
package com.faceproof

import android.content.res.AssetManager
import org.tensorflow.lite.Interpreter
import java.io.FileInputStream
import java.io.FileNotFoundException
import java.nio.MappedByteBuffer
import java.nio.channels.FileChannel

/** Model files bundled from `android/src/main/assets`, written by `yarn setup:models`. */
internal object ModelAssets {
  const val BLAZEFACE = "models/blazeface.tflite"
  const val MOBILEFACENET = "models/mobilefacenet.tflite"

  /**
   * Memory-maps a model so it is not copied onto the Java heap. This needs the
   * asset to be stored uncompressed (`noCompress "tflite"` in build.gradle).
   */
  fun load(assets: AssetManager, path: String): MappedByteBuffer {
    val descriptor = try {
      assets.openFd(path)
    } catch (e: FileNotFoundException) {
      throw BiometricException(
        "MODEL_NOT_FOUND",
        "Model asset '$path' is missing. Run `yarn setup:models` and rebuild the app.",
        e
      )
    }
    descriptor.use { fd ->
      FileInputStream(fd.fileDescriptor).use { stream ->
        // The mapping stays valid after the stream is closed.
        return stream.channel.map(FileChannel.MapMode.READ_ONLY, fd.startOffset, fd.declaredLength)
      }
    }
  }

  /** CPU inference with XNNPACK; four threads suit mid-range phones. */
  fun interpreterOptions(): Interpreter.Options = Interpreter.Options().apply {
    numThreads = 4
    useXNNPACK = true
  }
}
