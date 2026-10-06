# ml_prep

Small Python tools for looking at the models. You do not need them to build or
use the SDK: `yarn setup:models` downloads the models.

| Script | What it does |
|--------|--------------|
| `inspect_model.py` | Prints input and output names, shapes, types and quantization of one or all `.tflite` files. |
| `verify_models.py` | Loads each model, runs one inference on random input and reports pass or fail. The time it prints is from your computer's CPU, not a phone. |

## Setup

Python 3.10 or newer. In a virtual environment:

```sh
python -m venv .venv
# Windows: .venv\Scripts\activate    macOS/Linux: source .venv/bin/activate
pip install tensorflow
```

## Usage

```sh
python ml_prep/inspect_model.py
python ml_prep/inspect_model.py android/src/main/assets/models/mobilefacenet.tflite
python ml_prep/verify_models.py
```

Paths are resolved relative to the script, so these commands work from any folder
and on Windows, macOS and Linux.
