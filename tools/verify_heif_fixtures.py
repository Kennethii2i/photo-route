"""Validate the HEIF container, HEVC coding markers and source EXIF fields."""

from __future__ import annotations

import hashlib
import json
import struct
from pathlib import Path

import pillow_heif
from PIL import ExifTags, Image


ROOT = Path(__file__).resolve().parents[1] / "fixtures" / "heif"


def coordinate(parts: tuple[object, object, object]) -> float:
    return float(parts[0]) + float(parts[1]) / 60 + float(parts[2]) / 3600


def boxes(data: bytes) -> dict[bytes, bytes]:
    result = {}
    offset = 0
    while offset + 8 <= len(data):
        size = struct.unpack(">I", data[offset:offset + 4])[0]
        kind = data[offset + 4:offset + 8]
        if size < 8 or offset + size > len(data):
            raise RuntimeError(f"Invalid HEIF box {kind!r} at {offset}")
        result[kind] = data[offset + 8:offset + size]
        offset += size
    if offset != len(data):
        raise RuntimeError("Trailing bytes after HEIF boxes")
    return result


def main() -> int:
    pillow_heif.register_heif_opener()
    manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    for record in manifest["files"]:
        name = record["file"]
        expected = record["expected"]
        path = ROOT / name
        payload = path.read_bytes()
        if len(payload) != record["byteLength"] or hashlib.sha256(payload).hexdigest() != record["sha256"]:
            raise RuntimeError(f"Byte length or hash mismatch: {name}")
        parsed = boxes(payload)
        ftyp = parsed.get(b"ftyp", b"")
        if ftyp[:4].decode("ascii") != expected["majorBrand"] or b"mif1" not in ftyp:
            raise RuntimeError(f"HEIF brand mismatch: {name}")
        meta = parsed.get(b"meta", b"")
        if b"hvc1" not in meta or b"hvcC" not in meta or not parsed.get(b"mdat"):
            raise RuntimeError(f"HEVC image coding markers absent: {name}")
        if not pillow_heif.is_supported(path) or pillow_heif.get_file_mimetype(path) != expected["fileType"]:
            raise RuntimeError(f"libheif rejects file type: {name}")
        source = pillow_heif.open_heif(path)
        source_exif = Image.Exif()
        if source.info.get("exif"):
            source_exif.load(source.info["exif"])
        if source_exif.get(ExifTags.Base.DateTimeOriginal) != expected["localClock"]:
            raise RuntimeError(f"Source date mismatch: {name}")
        if source_exif.get(ExifTags.Base.OffsetTimeOriginal) != expected["offset"]:
            raise RuntimeError(f"Source offset mismatch: {name}")
        if source_exif.get(ExifTags.Base.Orientation) != expected["rawExifOrientation"]:
            raise RuntimeError(f"Source orientation mismatch: {name}")
        gps = source_exif.get_ifd(ExifTags.Base.GPSInfo)
        expected_gps = expected["gps"]
        if expected_gps is None:
            if gps:
                raise RuntimeError(f"Unexpected source GPS: {name}")
        else:
            if coordinate(gps[2]) != expected_gps["latitude"] or coordinate(gps[4]) != expected_gps["longitude"]:
                raise RuntimeError(f"Source GPS mismatch: {name}")
            if float(gps[31]) != expected_gps["horizontalErrorMeters"]:
                raise RuntimeError(f"Source GPS accuracy mismatch: {name}")
        with Image.open(path) as decoded:
            decoded.load()
            if decoded.format != "HEIF" or list(decoded.size) != expected["decodedDimensionsAfterTransform"]:
                raise RuntimeError(f"Decode or dimensions mismatch: {name}")
            if decoded.getexif().get(ExifTags.Base.Orientation) != expected["pillowPluginOrientationAfterTransform"]:
                raise RuntimeError(f"Post-transform orientation mismatch: {name}")
        print(f"PASS {name}: heic/mif1, HEVC hvc1+hvcC, EXIF, decode")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
