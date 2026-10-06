# Third-party notices

This project is licensed under the Apache License 2.0. It depends on, downloads
or includes the third-party components below, which keep their own licenses.

## Models (downloaded by `yarn setup:models`, not stored in this repository)

### BlazeFace short-range

- Source: Google MediaPipe, `blaze_face_short_range.tflite`
- License: Apache License 2.0
- Details: docs/MODELS.md

### MobileFaceNet (`mobilefacenet.tflite`)

- Downloaded from: https://github.com/MCarlomagno/FaceRecognitionAuth (`assets/mobilefacenet.tflite`)
- License of that repository: BSD 3-Clause, reproduced below.
- The original training of these weights is not documented by that repository.
  See docs/MODELS.md for the likely origin and the concerns about its training data.

```
BSD 3-Clause License

Copyright (c) 2020, Marcos Carlomagno
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

## Native libraries (fetched by Gradle or CocoaPods at build time)

| Component | License |
|-----------|---------|
| LiteRT (`com.google.ai.edge.litert:litert`) | Apache License 2.0 |
| SQLCipher for Android (`net.zetetic:sqlcipher-android`) and SQLCipher pod | BSD 3-Clause style (Zetetic LLC) |
| AndroidX SQLite, AndroidX ExifInterface | Apache License 2.0 |

## Files included in this repository

| Path | Origin | License |
|------|--------|---------|
| `example/android/gradlew`, `gradlew.bat`, `example/android/gradle/wrapper/` | Gradle wrapper | Apache License 2.0 |
| `.yarn/releases/yarn-4.11.0.cjs` | Yarn | BSD 2-Clause |
| `example/android/app/src/main/res/drawable/rn_edit_text_material.xml` | Android Open Source Project, via the React Native template | Apache License 2.0 |

## Example app dependencies (not part of the SDK)

The example app uses React Native Vision Camera, react-native-vision-camera-face-detector,
react-native-worklets-core, react-native-blob-util and others, each under its own
license (see `example/package.json`). Its face detection uses Google ML Kit, which
is covered by Google's ML Kit terms, not by an open-source license.
