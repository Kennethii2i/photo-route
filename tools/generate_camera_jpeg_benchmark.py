"""Generate a realistic-size local-only JPEG load probe; output stays gitignored."""

from __future__ import annotations

import hashlib
import argparse
import random
from pathlib import Path

from PIL import Image


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--quality", type=int, choices=(90, 95), default=90)
    args = parser.parse_args()
    width, height = 8000, 6000
    output = Path(__file__).resolve().parents[1] / "coverage" / f"camera-benchmark-48mp-q{args.quality}.jpg"
    output.parent.mkdir(parents=True, exist_ok=True)
    pixels = random.Random(20261116).randbytes(width * height * 3)
    image = Image.frombytes("RGB", (width, height), pixels)
    image.save(output, format="JPEG", quality=args.quality)
    image.close()
    print(f"Generated synthetic 48MP JPEG: {output.stat().st_size} bytes; SHA-256 {hashlib.sha256(output.read_bytes()).hexdigest()}")


if __name__ == "__main__":
    main()
