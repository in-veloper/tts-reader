import sharp from 'sharp';
import path from 'node:path';

const SRC = process.argv[2];
const OUT = process.argv[3];
const SIZE = 1024;
// 어댑티브 아이콘의 안전 영역은 가운데 66%. 그림(사람/파형/길)은 여기 안에 둔다.
const SAFE = Math.round(SIZE * 0.74);

const img = sharp(SRC).ensureAlpha();
const meta = await img.metadata();
const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
const { width: W, height: H, channels: C } = info;

const at = (x, y) => {
  const i = (y * W + x) * C;
  return [data[i], data[i + 1], data[i + 2]];
};

// 채도가 있는 픽셀 = 청록 원. 흰 카드/그림자는 무채색이라 걸러진다.
let left = W, right = 0, top = H, bottom = 0;
for (let y = 0; y < H; y += 1) {
  for (let x = 0; x < W; x += 1) {
    const [r, g, b] = at(x, y);
    if (Math.max(r, g, b) - Math.min(r, g, b) > 28) {
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
}

const cx = (left + right) / 2;
const cy = (top + bottom) / 2;
const side = Math.max(right - left, bottom - top) + 1;
const crop = {
  left: Math.max(0, Math.round(cx - side / 2)),
  top: Math.max(0, Math.round(cy - side / 2)),
  width: Math.min(W, side),
  height: Math.min(H, side),
};

// 원 안쪽에서 흰 그림을 피해 배경 그라데이션 색을 뽑는다.
function sampleGradient(fx, fy) {
  const radius = side / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;

  for (let dy = -12; dy <= 12; dy += 3) {
    for (let dx = -12; dx <= 12; dx += 3) {
      const x = Math.round(cx + fx * radius) + dx;
      const y = Math.round(cy + fy * radius) + dy;
      if (x < 0 || y < 0 || x >= W || y >= H) continue;

      const [pr, pg, pb] = at(x, y);
      // 흰 요소는 제외하고 순수 배경색만 평균낸다.
      if (Math.min(pr, pg, pb) > 150) continue;

      r += pr;
      g += pg;
      b += pb;
      n += 1;
    }
  }

  if (!n) return '#3f9e8f';
  const hex = (v) => Math.round(v / n).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

const cTop = sampleGradient(-0.5, -0.55);
const cBottom = sampleGradient(0.55, 0.5);

// 배경 — 원 색을 그대로 이어받은 풀블리드 그라데이션. 마스크가 어디를 잘라도 여백이 없다.
const backgroundSvg = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">
     <defs>
       <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
         <stop offset="0%" stop-color="${cTop}"/>
         <stop offset="100%" stop-color="${cBottom}"/>
       </linearGradient>
     </defs>
     <rect width="${SIZE}" height="${SIZE}" fill="url(#g)"/>
   </svg>`
);

await sharp(backgroundSvg)
  .png()
  .toFile(path.join(OUT, 'android-icon-background.png'));

// 원 안의 밝은 요소(사람·파형·길)만 알파로 남긴다. 배경 그라데이션은 버린다.
const flat = await sharp(SRC)
  .extract(crop)
  .resize(SAFE, SAFE, { fit: 'cover' })
  .raw()
  .toBuffer({ resolveWithObject: true });

const radius = (SAFE / 2) * 0.985;
const artwork = Buffer.alloc(SAFE * SAFE * 4);
const silhouette = Buffer.alloc(SAFE * SAFE * 4);

for (let y = 0; y < SAFE; y += 1) {
  for (let x = 0; x < SAFE; x += 1) {
    const src = (y * SAFE + x) * flat.info.channels;
    const dst = (y * SAFE + x) * 4;
    const dx = x - SAFE / 2;
    const dy = y - SAFE / 2;

    let alpha = 0;
    if (dx * dx + dy * dy <= radius * radius) {
      const lowest = Math.min(
        flat.data[src],
        flat.data[src + 1],
        flat.data[src + 2]
      );
      alpha = Math.max(0, Math.min(255, Math.round((lowest - 140) * 3)));
    }

    // 전경은 원래 색을 살려서(연한 파란 길이 그대로 남는다) 알파만 씌운다.
    artwork[dst] = flat.data[src];
    artwork[dst + 1] = flat.data[src + 1];
    artwork[dst + 2] = flat.data[src + 2];
    artwork[dst + 3] = alpha;

    // 테마 아이콘은 시스템이 알파만 보고 색을 입히므로 흰 실루엣으로.
    silhouette[dst] = 255;
    silhouette[dst + 1] = 255;
    silhouette[dst + 2] = 255;
    silhouette[dst + 3] = alpha;
  }
}

const onCanvas = (raw) =>
  sharp({
    create: {
      width: SIZE,
      height: SIZE,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      { input: raw, raw: { width: SAFE, height: SAFE, channels: 4 }, gravity: 'center' },
    ])
    .png();

await onCanvas(artwork).toFile(path.join(OUT, 'android-icon-foreground.png'));
await onCanvas(silhouette).toFile(path.join(OUT, 'android-icon-monochrome.png'));

// 레거시 런처용 단일 이미지 — 두 층을 미리 합쳐 둔다.
await sharp(backgroundSvg)
  .composite([{ input: await onCanvas(artwork).toBuffer() }])
  .png()
  .toFile(path.join(OUT, 'icon.png'));

console.log('source     :', `${meta.width}x${meta.height}`);
console.log('circle bbox:', crop);
console.log('gradient   :', cTop, '->', cBottom);
console.log('written    :', OUT);
