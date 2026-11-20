"""Verify generated fixture bytes and embedded metadata, without app parsing code."""

from __future__ import annotations

import hashlib
import json
import struct
from pathlib import Path

from PIL import ExifTags, Image, UnidentifiedImageError


ROOT = Path(__file__).resolve().parents[1] / "fixtures" / "generated"
FORMAT_NAMES = {"JPEG": "JPEG", "PNG": "PNG", "WebP": "WEBP"}


def coordinate(values: tuple[object, object, object]) -> float:
    return float(values[0]) + float(values[1]) / 60 + float(values[2]) / 3600


def main() -> int:
    manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    for record in manifest["files"]:
        name = record["file"]
        expected = record["expected"]
        payload = (ROOT / name).read_bytes()
        if hashlib.sha256(payload).hexdigest() != record["sha256"]:
            raise RuntimeError(f"hash mismatch: {name}")
        if len(payload) != record["byteLength"]:
            raise RuntimeError(f"length mismatch: {name}")
        signature = expected["signature"]
        actual_signature = (
            "JPEG" if payload.startswith(b"\xff\xd8\xff") else
            "PNG" if payload.startswith(b"\x89PNG\r\n\x1a\n") else
            "WebP" if payload.startswith(b"RIFF") and payload[8:12] == b"WEBP" else
            None
        )
        if actual_signature != signature:
            raise RuntimeError(f"signature mismatch: {name}")
        if "declaredDimensions" in expected:
            dimensions = struct.unpack(">II", payload[16:24])
            if list(dimensions) != expected["declaredDimensions"]:
                raise RuntimeError(f"oversized header mismatch: {name}")
            continue  # Never decode the intentionally oversized header.
        if expected["decode"] == "must fail":
            try:
                Image.open(ROOT / name).load()
            except (OSError, UnidentifiedImageError, ValueError):
                continue
            raise RuntimeError(f"corrupt file unexpectedly decoded: {name}")
        with Image.open(ROOT / name) as image:
            image.load()
            if image.format != FORMAT_NAMES[signature]:
                raise RuntimeError(f"format mismatch: {name}")
            exif = image.getexif()
            if exif.get(ExifTags.Base.DateTimeOriginal) != expected["localClock"]:
                raise RuntimeError(f"clock mismatch: {name}")
            if exif.get(ExifTags.Base.OffsetTimeOriginal) != expected.get("offset"):
                raise RuntimeError(f"offset mismatch: {name}")
            if exif.get(ExifTags.Base.Orientation) != expected.get("orientation"):
                raise RuntimeError(f"orientation mismatch: {name}")
            gps = exif.get_ifd(ExifTags.Base.GPSInfo)
            expected_gps = expected["gps"]
            if expected_gps is None:
                if gps:
                    raise RuntimeError(f"unexpected GPS: {name}")
                continue
            latitude = coordinate(gps[2]) * (1 if gps[1] == "N" else -1)
            longitude = coordinate(gps[4]) * (1 if gps[3] == "E" else -1)
            if latitude != expected_gps["latitude"] or longitude != expected_gps["longitude"]:
                raise RuntimeError(f"coordinate mismatch: {name}")
            if gps.get(18) != expected_gps.get("datum", "WGS-84"):
                raise RuntimeError(f"datum mismatch: {name}")
            error = float(gps[31]) if 31 in gps else None
            if error != expected_gps.get("horizontalErrorMeters", 7.5):
                raise RuntimeError(f"accuracy mismatch: {name}")
    print(f"Verified signatures, hashes, EXIF fields, and safe decode for {len(manifest['files'])} fixtures")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
