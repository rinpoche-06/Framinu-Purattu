/**
 * SPIKE helper - writes a crude PNG so the vision endpoint can be tested
 * without a real photo on hand.
 *
 * This validates the API contract: auth, path, image encoding, JSON schema.
 * It does NOT validate how good the model is at reading real photographs.
 * That needs a real photo and a human looking at the result.
 *
 * Minimal PNG writer: signature + IHDR + IDAT + IEND, no dependencies.
 */

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "out");
const WIDTH = 480;
const HEIGHT = 640;

const crcTable = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

/** RGB canvas with the simplest possible drawing helpers. */
const pixels = Buffer.alloc(WIDTH * HEIGHT * 3);

function setPixel(x, y, [r, g, b]) {
  if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return;
  const i = (y * WIDTH + x) * 3;
  pixels[i] = r;
  pixels[i + 1] = g;
  pixels[i + 2] = b;
}

function fillRect(x0, y0, w, h, colour) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) setPixel(x, y, colour);
  }
}

const WALL = [138, 154, 143];
const PLASTIC = [232, 223, 201];
const SHADOW = [176, 165, 140];
const LEG = [180, 168, 138];

fillRect(0, 0, WIDTH, HEIGHT, WALL);
// backrest
fillRect(96, 80, 288, 260, PLASTIC);
fillRect(140, 110, 200, 18, SHADOW);
// seat
fillRect(72, 340, 336, 70, PLASTIC);
fillRect(72, 400, 336, 12, SHADOW);
// legs
fillRect(104, 412, 22, 170, LEG);
fillRect(354, 412, 22, 170, LEG);
fillRect(160, 412, 18, 150, LEG);
fillRect(302, 412, 18, 150, LEG);

// PNG scanlines need a filter byte per row.
const raw = Buffer.alloc(HEIGHT * (1 + WIDTH * 3));
for (let y = 0; y < HEIGHT; y++) {
  const rowStart = y * (1 + WIDTH * 3);
  raw[rowStart] = 0;
  pixels.copy(raw, rowStart + 1, y * WIDTH * 3, (y + 1) * WIDTH * 3);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(WIDTH, 0);
ihdr.writeUInt32BE(HEIGHT, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 2; // colour type: truecolour RGB
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

mkdirSync(OUT_DIR, { recursive: true });
const file = join(OUT_DIR, "test-chair.png");
writeFileSync(file, png);
console.log(`wrote ${file} (${WIDTH}x${HEIGHT}, ${(png.length / 1024).toFixed(1)} KB)`);
