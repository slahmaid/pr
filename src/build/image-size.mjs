// Reads width and height from PNG, JPEG, GIF and WebP bytes. No dependencies.
export function readImageSize(input) {
  if (!input || input.length < 10) return null;
  const buf = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const u8 = (o) => buf[o];
  const u16 = (o, le) => (o + 2 <= buf.length ? view.getUint16(o, le) : null);
  const u32 = (o, le) => (o + 4 <= buf.length ? view.getUint32(o, le) : null);
  const ascii = (o, n) => {
    if (o + n > buf.length) return '';
    let s = '';
    for (let i = 0; i < n; i++) s += String.fromCharCode(buf[o + i]);
    return s;
  };
  const box = (width, height) => (
    Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 && width < 20000 && height < 20000
      ? { width, height }
      : null
  );

  if (u8(0) === 0x89 && ascii(1, 3) === 'PNG') {
    return box(u32(16, false), u32(20, false));
  }
  if (ascii(0, 3) === 'GIF') {
    return box(u16(6, true), u16(8, true));
  }
  if (u8(0) === 0xff && u8(1) === 0xd8) {
    let o = 2;
    while (o + 8 < buf.length) {
      if (u8(o) !== 0xff) { o += 1; continue; }
      const marker = u8(o + 1);
      if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
        return box(u16(o + 7, false), u16(o + 5, false));
      }
      const size = u16(o + 2, false);
      if (!size || size < 2) return null;
      o += 2 + size;
    }
    return null;
  }
  if (ascii(0, 4) !== 'RIFF' || ascii(8, 4) !== 'WEBP') return null;
  let o = 12;
  while (o + 8 <= buf.length) {
    const type = ascii(o, 4);
    const size = u32(o + 4, true);
    if (size == null || size > buf.length) return null;
    const data = o + 8;
    if (data + size > buf.length) return null;
    if (type === 'VP8X' && size >= 10) {
      const width = 1 + (u8(data + 4) | (u8(data + 5) << 8) | (u8(data + 6) << 16));
      const height = 1 + (u8(data + 7) | (u8(data + 8) << 8) | (u8(data + 9) << 16));
      return box(width, height);
    }
    if (type === 'VP8 ' && size >= 10) {
      return box(u16(data + 6, true) & 0x3fff, u16(data + 8, true) & 0x3fff);
    }
    if (type === 'VP8L' && size >= 5 && u8(data) === 0x2f) {
      const bits = u32(data + 1, true);
      return box((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
    }
    o = data + size + (size % 2);
  }
  return null;
}
