"""Reproducible, fully synthetic 2048x2048 HEIC stress fixture for P0-T04 follow-up."""

from __future__ import annotations

import argparse
import hashlib
import io
from pathlib import Path

import pillow_heif
from PIL import Image, ImageDraw, __version__ as pillow_version

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "spikes" / "p0-t04-followup" / "fixtures" / "synthetic_2048.heic"


def generated_bytes() -> bytes:
    if pillow_version != "12.3.0" or pillow_heif.__version__ != "1.8.1":
        raise RuntimeError("Use the pinned .venv-heif generator environment")
    pillow_heif.register_heif_opener()
    image = Image.new("RGB", (2048, 2048), (220, 231, 239))
    ImageDraw.Draw(image).rectangle((0, 0, 512, 512), fill=(220, 50, 50))
    output = io.BytesIO()
    image.save(output, format="HEIF", quality=80)
    return output.getvalue()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    data = generated_bytes()
    if args.check:
        if TARGET.read_bytes() != data:
            raise SystemExit("Large HEIC fixture differs from pinned generator")
        if data[4:12] != b"ftypheic" or b"hvc1" not in data or b"hvcC" not in data:
            raise SystemExit("Large fixture is not HEVC-in-HEIF")
        with Image.open(TARGET) as decoded:
            decoded.load()
            if decoded.format != "HEIF" or decoded.size != (2048, 2048):
                raise SystemExit("Large fixture decode/dimensions mismatch")
    else:
        TARGET.parent.mkdir(parents=True, exist_ok=True)
        TARGET.write_bytes(data)
    print(f"{'verified' if args.check else 'generated'} {TARGET.name}: {len(data)} B, sha256={hashlib.sha256(data).hexdigest()}")


if __name__ == "__main__":
    main()
