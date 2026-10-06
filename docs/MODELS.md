# Models

The Android library uses two TFLite models. They are not stored in git.
`yarn setup:models` downloads them into `android/src/main/assets/models/` and
checks each file against the SHA-256 hash below. If an upstream file ever
changes, the script refuses it.

| File | Role | Size | SHA-256 |
|------|------|------|---------|
| `blazeface.tflite` | Face detection | 229,746 bytes | `b4578f35940bf5a1a655214a1cce5cab13eba73c1297cd78e1a04c2380b0152f` |
| `mobilefacenet.tflite` | Face embedding | 5,233,552 bytes | `be4bc7cfc53f7bc336d0f28b1ab92535f618c913a422b683210750f6b5354854` |

To inspect a model's inputs and outputs yourself, see [ml_prep/README.md](../ml_prep/README.md).

## BlazeFace short-range (face detection)

- **What it does:** finds faces and returns a box and six keypoints (eyes, nose
  tip, mouth center, ears) for each. On Android it always runs: the eye, nose
  and mouth keypoints are used to align the face before embedding. When the app
  passes a face box, it only decides which detected face to use.
- **Input / output:** float32 image `[1, 128, 128, 3]` scaled to [-1, 1];
  outputs `[1, 896, 16]` values (box plus six keypoints) and `[1, 896, 1]`
  scores for 896 fixed anchors. Weights are stored as float16.
- **Range:** made for faces within about 2 m of the camera, as in a selfie. Faces
  that are small in the frame are not detected.
- **Source:** Google MediaPipe,
  `https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite`
- **Documentation:** [BlazeFace short-range model card](https://storage.googleapis.com/mediapipe-assets/MediaPipe%20BlazeFace%20Model%20Card%20(Short%20Range).pdf)
- **License:** Apache License 2.0, as published by MediaPipe.

## MobileFaceNet (face embedding)

- **What it does:** turns an aligned 112x112 face into 192 numbers (an embedding).
  Two crops of the same person give embeddings that point in a similar
  direction; the library compares them with cosine similarity.
- **Input / output:** float32 `[1, 112, 112, 3]` scaled to [-1, 1]; output
  float32 `[1, 192]`. The model is not quantized. (Earlier versions of this
  project called the file `mobilefacenet_int8.tflite`; that name was wrong.)
- **Architecture:** MobileFaceNet, Chen et al., 2018,
  [arXiv:1804.07573](https://arxiv.org/abs/1804.07573).
- **Where the file comes from:** downloaded from the
  [MCarlomagno/FaceRecognitionAuth](https://github.com/MCarlomagno/FaceRecognitionAuth)
  repository (BSD-3-Clause license, archived in 2023), file `assets/mobilefacenet.tflite`.
  That repository does not say how the model was trained.
- **Likely origin (not confirmed):** this widely shared 192-dimension file
  matches exports of [sirius-ai/MobileFaceNet_TF](https://github.com/sirius-ai/MobileFaceNet_TF)
  (Apache License 2.0), which is trained on MS1M-refine, a cleaned version of
  the MS-Celeb-1M dataset.

### Accuracy

The model must get aligned faces: eyes, nose and mouth at the positions of the
standard 112x112 template. Plain box crops make it much worse (see
[BENCHMARKS.md](BENCHMARKS.md)).

The MobileFaceNet paper reports 99.55% on LFW and 96.07% on AgeDB-30. Those
numbers are for the authors' own trained model and protocol, not for this file.
This project's own LFW measurement, with the method and its caveats, is in
[BENCHMARKS.md](BENCHMARKS.md). LFW is not your users: before relying on the SDK,
measure false accept and false reject rates on data that looks like yours, and
choose `matchThreshold` from those results (`ml_prep/calibrate_threshold.py`
shows how).

### Training data concern

MS-Celeb-1M was built from web images of about 100,000 people, collected without
their consent. Microsoft withdrew the dataset in 2019. Models trained on it, or
on versions derived from it, are widely used in research, but their status for
commercial use is unclear, and the people in the dataset never agreed to it.

What this means for you:

- Treat the bundled model as a starting point for evaluation and prototypes.
- For production, prefer a face embedding model whose training data was collected
  with consent and whose license clearly covers your use.
- This is not legal advice. Check with someone qualified for your jurisdiction.

Replacing the model with one trained on consented data is an open project goal.

## Replacing a model

1. Put the new `.tflite` file at the same path and update the hash in
   `scripts/setup-models.mjs`.
2. The embedding model must take a 112x112 RGB input, aligned to the template in
   `FaceAligner.kt`. The output size can differ
   (128, 192, 512 and so on), and int8/uint8 quantized models are supported.
3. Templates are only comparable when made by the same model. After changing the
   embedding model, everyone must be enrolled again. Old templates of a
   different size are ignored, so they cannot cause false matches.
4. Update this file with the new source, license and hash.

## iOS

iOS is experimental and does not use these files. Its code expects a Core ML
model named `MobileFaceNet.mlmodelc` in the app bundle, which this repository
does not provide yet. Converting the same MobileFaceNet model to Core ML, so both
platforms produce the same embeddings, is an open task.

iOS has no face alignment yet, so even with a Core ML model its accuracy would be
much lower than Android's until alignment is ported.
