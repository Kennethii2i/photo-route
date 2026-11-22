// Browser-generated synthetic pixels; no Pillow or real photos are required.
export async function largeJpegBase(width = 16000, height = 3000): Promise<Blob> {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d')!;
  for (const [index, color] of ['rgb(220,20,20)', 'rgb(20,180,20)', 'rgb(20,20,220)', 'rgb(220,200,20)'].entries()) {
    context.fillStyle = color; context.fillRect((index % 2) * width / 2, Math.floor(index / 2) * height / 2, width / 2, height / 2);
  }
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Synthetic JPEG encoding failed')), 'image/jpeg', 0.85));
  canvas.width = 0; canvas.height = 0;
  return blob;
}

export async function orientedJpeg(base: Blob, orientation: number, name = `synthetic-${orientation}.jpg`, fixture = 'jpeg_gps_offset_orientation6.jpg'): Promise<File> {
  const bytes = new Uint8Array(await (await fetch(`/fixtures/generated/${fixture}`)).arrayBuffer());
  let at = 2;
  while (bytes[at + 1] !== 225) at += 2 + bytes[at + 2]! * 256 + bytes[at + 3]!;
  const end = at + 2 + bytes[at + 2]! * 256 + bytes[at + 3]!;
  const exif = bytes.slice(at, end), view = new DataView(exif.buffer), tiff = 10, little = exif[tiff] === 73;
  const ifd = tiff + view.getUint32(tiff + 4, little), count = view.getUint16(ifd, little);
  for (let index = 0; index < count; index++) {
    const entry = ifd + 2 + index * 12;
    if (view.getUint16(entry, little) === 0x112) view.setUint16(entry + 8, orientation, little);
  }
  return new File([base.slice(0, 2), exif, base.slice(2)], name, { type: 'image/jpeg' });
}

export const expectedTopRight = [[20, 180, 20], [220, 20, 20], [20, 20, 220], [220, 200, 20], [20, 20, 220], [220, 20, 20], [20, 180, 20], [220, 200, 20]];
