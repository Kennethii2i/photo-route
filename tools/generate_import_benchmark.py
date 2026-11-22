"""Generate a deterministic synthetic 24MP JPEG near 7.7MB; never use real photos."""
from io import BytesIO
from pathlib import Path
import random

from PIL import Image

output = Path(__file__).resolve().parents[1] / 'coverage' / 'import-benchmark-24mp.jpg'
image = Image.frombytes('RGB', (6000, 4000), random.Random(20261122).randbytes(6000 * 4000 * 3))
buffer = BytesIO()
image.save(buffer, format='JPEG', quality=36)
image.close()
payload = buffer.getvalue()
output.parent.mkdir(parents=True, exist_ok=True)
if output.exists():
    if output.read_bytes() != payload:
        raise RuntimeError('Existing benchmark differs; refusing to overwrite it')
else:
    output.write_bytes(payload)
print(f'Generated synthetic 6000x4000 JPEG: {len(payload)} bytes')
