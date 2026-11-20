"""Create genuine, synthetic HEVC-in-HEIF fixtures using isolated tooling."""

from __future__ import annotations

import argparse
import hashlib
import io
import json
from pathlib import Path

import pillow_heif
from PIL import ExifTags, Image, TiffImagePlugin, __version__ as pillow_version

from generate_fixtures import sample_image


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "fixtures" / "heif"
PILLOW_VERSION = "12.3.0"
PILLOW_HEIF_VERSION = "1.8.1"


def captured_exif() -> Image.Exif:
    rational = TiffImagePlugin.IFDRational
    exif = Image.Exif()
    exif[ExifTags.Base.DateTimeOriginal] = "2020:02:03 04:05:06"
    exif[ExifTags.Base.OffsetTimeOriginal] = "+09:00"
    exif[ExifTags.Base.Orientation] = 6
    exif[ExifTags.Base.GPSInfo] = {
        1: "N",
        2: (rational(35, 1), rational(30, 1), rational(0, 1)),
        3: "E",
        4: (rational(139, 1), rational(30, 1), rational(0, 1)),
        18: "WGS-84",
        31: rational(15, 2),
    }
    return exif


def encode(exif: Image.Exif | None) -> bytes:
    output = io.BytesIO()
    options = {"exif": exif.tobytes()} if exif is not None else {}
    sample_image().save(output, format="HEIF", quality=90, **options)
    return output.getvalue()


def build_outputs() -> dict[str, bytes]:
    if pillow_version != PILLOW_VERSION or pillow_heif.__version__ != PILLOW_HEIF_VERSION:
        raise RuntimeError(
            f"Expected Pillow {PILLOW_VERSION} and pillow-heif {PILLOW_HEIF_VERSION}; "
            f"found {pillow_version} and {pillow_heif.__version__}"
        )
    pillow_heif.register_heif_opener()
    cases = [
        (
            "synthetic_gps_offset_orientation.heic",
            encode(captured_exif()),
            {
                "fileType": "image/heic",
                "majorBrand": "heic",
                "codec": "HEVC (hvc1 with hvcC)",
                "localClock": "2020:02:03 04:05:06",
                "offset": "+09:00",
                "gps": {"latitude": 35.5, "longitude": 139.5, "horizontalErrorMeters": 7.5},
                "rawExifOrientation": 6,
                "pillowPluginOrientationAfterTransform": 1,
                "decodedDimensionsAfterTransform": [12, 16],
                "expectedUtcIfOffsetAccepted": "2020-02-02T19:05:06Z",
            },
        ),
        (
            "synthetic_no_metadata.heif",
            encode(None),
            {
                "fileType": "image/heic",
                "majorBrand": "heic",
                "codec": "HEVC (hvc1 with hvcC)",
                "localClock": None,
                "offset": None,
                "gps": None,
                "rawExifOrientation": None,
                "pillowPluginOrientationAfterTransform": None,
                "decodedDimensionsAfterTransform": [16, 12],
            },
        ),
    ]
    records = []
    outputs = {}
    for name, payload, expected in cases:
        outputs[name] = payload
        records.append(
            {
                "file": name,
                "sha256": hashlib.sha256(payload).hexdigest(),
                "byteLength": len(payload),
                "expected": expected,
            }
        )
    manifest = {
        "schemaVersion": 1,
        "source": "fully synthetic pixels and metadata from tools/generate_heif_fixtures.py; no device-origin photos",
        "thirdPartyImageLicense": "not applicable: no third-party images",
        "generatorRequirements": {"Python": "3.12", "Pillow": PILLOW_VERSION, "pillow-heif": PILLOW_HEIF_VERSION},
        "encoderFormat": "HEIF container with HEVC image coding; verify independently",
        "files": records,
    }
    outputs["manifest.json"] = (json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")
    return outputs


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    outputs = build_outputs()
    if args.check:
        actual_names = {path.name for path in OUTPUT.iterdir() if path.is_file()} if OUTPUT.exists() else set()
        mismatches = sorted(actual_names ^ set(outputs))
        mismatches += sorted(
            name for name, data in outputs.items()
            if (OUTPUT / name).is_file() and (OUTPUT / name).read_bytes() != data
        )
        if mismatches:
            print("HEIF fixture mismatch:", ", ".join(mismatches))
            return 1
        print("Verified two reproducible HEIF files and manifest")
        return 0
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for name, data in outputs.items():
        (OUTPUT / name).write_bytes(data)
    print("Generated two HEIF files and manifest")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
