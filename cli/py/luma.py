#!/usr/bin/env python3
"""Coarse luma grids (32 wide, source aspect) for text legibility checks.

  luma.py IMAGE OUT.json                 one image
  luma.py FRAMES_DIR OUT.json --step N   every Nth frame of a JPEG sequence (0001.jpg…)

Writes {"w", "h", "step", "frames": [base64 of w*h bytes, …]}. Needs Pillow. Run by `onevideo depth`."""
import base64
import json
import os
import sys

from PIL import Image

W = 32


def grid(path):
    img = Image.open(path).convert("L")
    h = max(1, round(W * img.height / img.width))
    return img.resize((W, h), Image.BOX), h


def main(argv):
    if len(argv) < 2:
        sys.exit(__doc__)
    src, out = argv[:2]
    step = int(argv[argv.index("--step") + 1]) if "--step" in argv else 2
    files = [src] if os.path.isfile(src) else [os.path.join(src, f) for f in sorted(f for f in os.listdir(src) if f.endswith(".jpg"))][::step]
    frames, h = [], 1
    for f in files:
        g, h = grid(f)
        frames.append(base64.b64encode(g.tobytes()).decode("ascii"))
    with open(out, "w") as fh:
        json.dump({"w": W, "h": h, "step": 1 if os.path.isfile(src) else step, "frames": frames}, fh)
    print(json.dumps({"out": out, "frames": len(frames)}))


if __name__ == "__main__":
    main(sys.argv[1:])
