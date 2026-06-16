// Generates build/icon.png (512×512) with no external deps — draws the app mark
// (terracotta rounded square + white ring + plus) and encodes a PNG via zlib.
import zlib from 'node:zlib'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const S = 512
const px = Buffer.alloc(S * S * 4) // RGBA, transparent

const ACCENT = [204, 120, 92] // #cc785c
const WHITE = [255, 255, 255]

const set = (x, y, [r, g, b], a = 255) => {
  if (x < 0 || y < 0 || x >= S || y >= S) return
  const i = (y * S + x) * 4
  px[i] = r
  px[i + 1] = g
  px[i + 2] = b
  px[i + 3] = a
}

// Rounded-square background.
const margin = 20
const rad = 104
const lo = margin
const hi = S - 1 - margin
const inRounded = (x, y) => {
  if (x < lo || x > hi || y < lo || y > hi) return false
  const cxl = lo + rad
  const cxr = hi - rad
  const cyt = lo + rad
  const cyb = hi - rad
  const nx = x < cxl ? cxl : x > cxr ? cxr : x
  const ny = y < cyt ? cyt : y > cyb ? cyb : y
  const dx = x - nx
  const dy = y - ny
  return dx * dx + dy * dy <= rad * rad
}

const cx = 256
const cy = 256
const ringR = 150
const ringHalf = 9 // half thickness
const barHalf = 9 // half width of plus bars
const armEnd = 84 // plus arm reaches to ±172 from center

for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    if (!inRounded(x, y)) continue
    set(x, y, ACCENT)
    const d = Math.hypot(x - cx, y - cy)
    const onRing = Math.abs(d - ringR) <= ringHalf
    const onVert = Math.abs(x - cx) <= barHalf && Math.abs(y - cy) <= ringR - armEnd + 78
    const onHorz = Math.abs(y - cy) <= barHalf && Math.abs(x - cx) <= ringR - armEnd + 78
    if (onRing || onVert || onHorz) set(x, y, WHITE)
  }
}

// ── PNG encode ──
const crcTable = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
const crc32 = (buf) => {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crc])
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(S, 0)
ihdr.writeUInt32BE(S, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // color type RGBA
const raw = Buffer.alloc(S * (S * 4 + 1))
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0 // filter: none
  px.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4)
}
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
])

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'build')
fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(path.join(outDir, 'icon.png'), png)
console.log('wrote build/icon.png', png.length, 'bytes')
