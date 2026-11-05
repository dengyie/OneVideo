#!/usr/bin/env python3
"""Relative depth maps (near = white) with Depth Anything V2 Small (ONNX, CPU).

  depth.py MODEL IMAGE OUT.png                 one image
  depth.py MODEL FRAMES_DIR OUT_DIR --step N   every Nth frame of a JPEG sequence (0001.jpg…)

Needs onnxruntime, numpy and Pillow. Run by `onevideo depth`; the model file lives outside the
repo (ONEVIDEO_DEPTH_MODEL)."""
import json
import os
import sys

import numpy as np
import onnxruntime as ort
from PIL import Image, ImageFilter

MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)


def session(model):
    opts = ort.SessionOptions()
    opts.intra_op_num_threads = os.cpu_count() or 2
    return ort.InferenceSession(model, opts, providers=["CPUExecutionProvider"])


def infer(sess, img, short=518):
    # Short side 518, both sides multiples of 14 (the ViT patch size).
    w, h = img.size
    k = short / min(w, h)
    W, H = max(14, round(w * k / 14) * 14), max(14, round(h * k / 14) * 14)
    x = (np.asarray(img.convert("RGB").resize((W, H), Image.BICUBIC), dtype=np.float32) / 255.0 - MEAN) / STD
    x = x.transpose(2, 0, 1)[None].astype(np.float32)
    name = sess.get_inputs()[0].name
    d = sess.run(None, {name: x})[0]
    return d.reshape(d.shape[-2], d.shape[-1])


def to_png(d, size, lo, hi, out):
    v = np.clip((d - lo) / max(1e-6, hi - lo), 0, 1)
    im = Image.fromarray((v * 255).astype(np.uint8), "L").resize(size, Image.BILINEAR).filter(ImageFilter.GaussianBlur(1.2))
    im.save(out, optimize=True)


def main(argv):
    if len(argv) < 3:
        sys.exit(__doc__)
    model, src, out = argv[:3]
    step = int(argv[argv.index("--step") + 1]) if "--step" in argv else 2
    sess = session(model)
    if os.path.isfile(src):
        img = Image.open(src)
        d = infer(sess, img)
        to_png(d, (img.width // 2, img.height // 2), *np.percentile(d, [2, 98]), out)
        print(json.dumps({"out": out}))
        return
    frames = sorted(f for f in os.listdir(src) if f.endswith(".jpg"))
    os.makedirs(out, exist_ok=True)
    lo = hi = None
    n = 0
    for i in range(0, len(frames), step):
        img = Image.open(os.path.join(src, frames[i]))
        d = infer(sess, img)
        a, b = np.percentile(d, [2, 98])
        # Smooth the normalisation range over time so the map doesn't flicker frame to frame.
        lo = a if lo is None else 0.8 * lo + 0.2 * a
        hi = b if hi is None else 0.8 * hi + 0.2 * b
        n += 1
        to_png(d, (img.width // 2, img.height // 2), lo, hi, os.path.join(out, f"{n:04d}.png"))
        if n % 20 == 0:
            print(f"{n} / {(len(frames) + step - 1) // step}", file=sys.stderr, flush=True)
    with open(os.path.join(out, "meta.json"), "w") as f:
        json.dump({"step": step, "frames": n}, f)
    print(json.dumps({"out": out, "frames": n, "step": step}))


if __name__ == "__main__":
    main(sys.argv[1:])
