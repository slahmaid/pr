import assert from 'node:assert/strict';
import test from 'node:test';
import { readImageSize } from '../src/build/image-size.mjs';
import { productFigure } from '../src/build/product-html.mjs';

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.write(type, 0);
  head.writeUInt32LE(data.length, 4);
  const pad = data.length % 2 ? Buffer.from([0]) : Buffer.alloc(0);
  return Buffer.concat([head, data, pad]);
}

function webp(...chunks) {
  const body = Buffer.concat(chunks);
  const head = Buffer.alloc(12);
  head.write('RIFF', 0);
  head.writeUInt32LE(4 + body.length, 4);
  head.write('WEBP', 8);
  return Buffer.concat([head, body]);
}

test('reads webp, png and jpeg dimensions', () => {
  const vp8x = Buffer.alloc(10);
  vp8x.writeUIntLE(1199, 4, 3);
  vp8x.writeUIntLE(749, 7, 3);
  assert.deepEqual(readImageSize(webp(chunk('VP8X', vp8x))), { width: 1200, height: 750 });

  const vp8 = Buffer.alloc(10);
  vp8[3] = 0x9d;
  vp8[4] = 0x01;
  vp8[5] = 0x2a;
  vp8.writeUInt16LE(640, 6);
  vp8.writeUInt16LE(480, 8);
  assert.deepEqual(readImageSize(webp(chunk('VP8 ', vp8))), { width: 640, height: 480 });

  const vp8l = Buffer.alloc(5);
  vp8l[0] = 0x2f;
  vp8l.writeUInt32LE((800 - 1) | ((600 - 1) << 14), 1);
  const padChunk = chunk('XXXX', Buffer.from([1]));
  assert.deepEqual(readImageSize(webp(padChunk, chunk('VP8L', vp8l))), { width: 800, height: 600 });

  const png = Buffer.alloc(24);
  png[0] = 0x89;
  png.write('PNG', 1);
  png.writeUInt32BE(320, 16);
  png.writeUInt32BE(200, 20);
  assert.deepEqual(readImageSize(png), { width: 320, height: 200 });

  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x00, 0x01, 0x40]);
  assert.deepEqual(readImageSize(jpeg), { width: 320, height: 256 });
  assert.equal(readImageSize(Buffer.from('nope')), null);
});

test('product figure keeps the placeholder and describes a real photo', () => {
  assert.equal(
    productFigure({ id: 'x', name: 'Nom' }),
    '<figure class="media ar-11"><div class="media__in"><img src="assets/img/blank-11.svg" alt="" loading="lazy" draggable="false"></div></figure>',
  );
  assert.equal(
    productFigure({ id: 'x', name: 'Câble & "R2V"', img: 'assets/img/produits/x.webp' }, { width: 1200, height: 750 }),
    '<figure class="media ar-11"><div class="media__in"><img src="assets/img/produits/x.webp" alt="Câble &amp; &quot;R2V&quot;" width="1200" height="750" loading="lazy"></div></figure>',
  );
});
