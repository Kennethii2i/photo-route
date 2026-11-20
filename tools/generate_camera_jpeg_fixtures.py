"""Reproducible, synthetic high-resolution JPEG import probes (Pillow 12.3.0)."""

from __future__ import annotations

import argparse
import hashlib
import json
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw, __version__ as pillow_version


ROOT = Path(__file__).resolve().parents[1] / "fixtures" / "camera"
CASES = (
    ("jpeg_12mp_orientation6.jpg", 4032, 3024, 6),
    ("jpeg_24mp.jpg", 6000, 4000, None),
    ("jpeg_48mp.jpg", 8000, 6000, None),
    ("jpeg_80mp_metadata_only.jpg", 10000, 8000, None),
)


def generate(name: str, width: int, height: int, orientation: int | None) -> bytes:
    image = Image.new("RGB", (width, height))
    draw = ImageDraw.Draw(image)
    colors = ((220, 20, 20), (20, 180, 20), (20, 20, 220), (220, 200, 20))
    for index, color in enumerate(colors):
        x = index % 2
        y = index // 2
        draw.rectangle((x * width // 2, y * height // 2, (x + 1) * width // 2 - 1, (y + 1) * height // 2 - 1), fill=color)
    exif = Image.Exif()
    if orientation is not None:
        exif[274] = orientation
    output = BytesIO()
    image.save(output, format="JPEG", quality=85, exif=exif)
    image.close()
    return output.getvalue()


def main() -> int:
    if pillow_version != "12.3.0":
        raise RuntimeError(f"Pillow 12.3.0 required; found {pillow_version}")
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    ROOT.mkdir(parents=True, exist_ok=True)
    records = []
    for name, width, height, orientation in CASES:
        payload = generate(name, width, height, orientation)
        path = ROOT / name
        if args.check:
            if not path.is_file() or path.read_bytes() != payload:
                raise RuntimeError(f"fixture differs: {name}")
        else:
            path.write_bytes(payload)
        records.append({"file": name, "sha256": hashlib.sha256(payload).hexdigest(), "byteLength": len(payload),
                        "expected": {"format": "JPEG", "width": width, "height": height, "pixels": width * height,
                                     "exifOrientation": orientation, "thumbnail": "available" if width * height <= 60_000_000 else "failed"}})
    manifest = {"generator": "tools/generate_camera_jpeg_fixtures.py", "requirements": {"python": "3.12.7", "Pillow": "12.3.0"},
                "source": "synthetic four-quadrant pixels; no real photo or GPS", "license": "repository-generated synthetic data; no third-party asset",
                "files": records}
    manifest_bytes = (json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode()
    manifest_path = ROOT / "manifest.json"
    if args.check:
        if not manifest_path.is_file() or manifest_path.read_bytes() != manifest_bytes:
            raise RuntimeError("fixture manifest differs")
    else:
        manifest_path.write_bytes(manifest_bytes)
    print(f"{'Verified' if args.check else 'Generated'} {len(CASES)} synthetic camera JPEG fixtures")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
