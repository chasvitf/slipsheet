// Shared Node OCR helper: same engine + languages as the browser page.
import { createWorker } from "tesseract.js";
import { readFileSync } from "node:fs";
import { PNG } from "pngjs";
import jsQR from "jsqr";

export async function makeWorker() {
  return createWorker(["tha", "eng"], 1, { cachePath: new URL("../.cache/", import.meta.url).pathname });
}

export async function ocrLines(worker, file) {
  const { data } = await worker.recognize(file, {}, { blocks: true, text: true });
  const lines = [];
  for (const b of data.blocks || []) for (const p of b.paragraphs) for (const l of p.lines)
    lines.push({ text: l.text.trim(), bbox: l.bbox });
  return lines.filter((l) => l.text);
}

import jpeg from "jpeg-js";
export function decodeQR(file) {
  const buf = readFileSync(file);
  const img = /\.png$/i.test(file) ? PNG.sync.read(buf) : jpeg.decode(buf, { useTArray: true });
  const hit = jsQR(new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.data.length), img.width, img.height);
  return hit ? hit.data : null;
}
