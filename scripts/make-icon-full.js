// 받은 앱 아이콘(둥근 사각형 안에 그림이 꽉 찬 일러스트)으로 안드로이드 아이콘 레이어를 만든다.
// 둥근 사각형 바깥(흰 여백)과 모서리 경계가 섞여 들어가지 않게, 모서리까지 전부 그림 안쪽인
// 가장 큰 정사각형만 잘라 쓴다. 적응형 아이콘은 런처가 레이어 가운데 72/108 만 보여주므로,
// 잘라낸 그림을 그 영역에 맞춰 놓고 바깥은 가장자리 픽셀을 늘려 채운다(마스크 밖이라 안 보임).
// 사용: node scripts/make-icon-full.js <원본 이미지 경로>
const path = require('path');
const sharp = require('C:/ClaudeCode_Project/studyplan/node_modules/sharp');

const SRC = process.argv[2];
const ASSETS = path.join(__dirname, '..', 'assets');
const SIZE = 1024;
const VIEWPORT = Math.round((SIZE * 72) / 108); // 런처가 실제로 보여주는 가운데 영역

const isOutside = (r, g, b) => r > 248 && g > 248 && b > 245;

async function findCrop() {
  const { data, info } = await sharp(SRC).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const px = (x, y) => {
    const i = (y * w + x) * 3;
    return [data[i], data[i + 1], data[i + 2]];
  };
  // 바깥 여백은 이미지 테두리에서부터 이어진 흰 영역만이다. 픽셀 색만 보고 판단하면
  // 그림 한가운데의 밝은 빛 번짐까지 바깥으로 잘못 보고 메워 버린다.
  const outside = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let qh = 0;
  let qt = 0;
  const visit = (x, y) => {
    const p = y * w + x;
    if (outside[p] || !isOutside(...px(x, y))) return;
    outside[p] = 1;
    queue[qt++] = p;
  };
  for (let x = 0; x < w; x++) { visit(x, 0); visit(x, h - 1); }
  for (let y = 0; y < h; y++) { visit(0, y); visit(w - 1, y); }
  while (qh < qt) {
    const p = queue[qh++];
    const x = p % w;
    const y = (p / w) | 0;
    if (x > 0) visit(x - 1, y);
    if (x < w - 1) visit(x + 1, y);
    if (y > 0) visit(x, y - 1);
    if (y < h - 1) visit(x, y + 1);
  }
  const inside = (x, y) => !outside[y * w + x];

  // 둥근 사각형의 상하좌우 끝
  const cy = h >> 1;
  const cx = w >> 1;
  let L = 0, R = w - 1, T = 0, B = h - 1;
  while (!inside(L, cy)) L++;
  while (!inside(R, cy)) R--;
  while (!inside(cx, T)) T++;
  while (!inside(cx, B)) B--;
  const midX = (L + R) / 2;
  const midY = (T + B) / 2;

  // 둥근 사각형을 거의 다 담는 정사각형으로 자른다(그림이 잘리지 않게).
  // 모서리에 들어온 바깥 흰 여백과 경계의 옅은 테두리는 가운데 쪽으로 걸어 들어가 만나는
  // 그림 색으로 메운다 — 런처 마스크가 어차피 모서리를 둥글게 깎아서 거의 보이지 않는다.
  const side = Math.min(R - L, B - T) - 8;
  const left = Math.round(midX - side / 2);
  const top = Math.round(midY - side / 2);
  const EDGE = 9; // 바깥에서 이만큼 안쪽까지는 경계로 보고 메운다

  const out = Buffer.alloc(side * side * 3);
  const bad = new Uint8Array(side * side);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const sx = left + x;
      const sy = top + y;
      let near = false;
      for (let d = 0; d <= EDGE && !near; d += 3) {
        for (const [dx, dy] of [[d, 0], [-d, 0], [0, d], [0, -d]]) {
          const ax = sx + dx;
          const ay = sy + dy;
          if (ax < 0 || ay < 0 || ax >= w || ay >= h || !inside(ax, ay)) {
            near = true;
            break;
          }
        }
      }
      bad[y * side + x] = near ? 1 : 0;
    }
  }
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      let fx = x;
      let fy = y;
      if (bad[y * side + x]) {
        const vx = side / 2 - x;
        const vy = side / 2 - y;
        const len = Math.hypot(vx, vy) || 1;
        let t = 0;
        while (t < len) {
          t += 1;
          fx = Math.round(x + (vx / len) * t);
          fy = Math.round(y + (vy / len) * t);
          if (!bad[fy * side + fx]) break;
        }
        fx = Math.round(x + (vx / len) * (t + 4));
        fy = Math.round(y + (vy / len) * (t + 4));
      }
      const [r, g, b] = px(left + fx, top + fy);
      const o = (y * side + x) * 3;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
    }
  }
  return { left, top, side, out, box: { L, R, T, B } };
}

(async () => {
  const crop = await findCrop();
  const artBuf = await sharp(crop.out, { raw: { width: crop.side, height: crop.side, channels: 3 } }).png().toBuffer();
  delete crop.out;

  // icon.png: 그림 그대로 꽉 채운 사각형
  await sharp(artBuf).resize(SIZE, SIZE, { kernel: 'lanczos3' }).png().toFile(path.join(ASSETS, 'icon.png'));
  await sharp(artBuf).resize(196, 196).png().toFile(path.join(ASSETS, 'favicon.png'));

  // 적응형 전경: 가운데 72/108 에 그림, 바깥은 가장자리 픽셀 복사
  const pad = Math.round((SIZE - VIEWPORT) / 2);
  const fg = await sharp(await sharp(artBuf).resize(VIEWPORT, VIEWPORT, { kernel: 'lanczos3' }).png().toBuffer())
    .extend({ top: pad, bottom: SIZE - VIEWPORT - pad, left: pad, right: SIZE - VIEWPORT - pad, extendWith: 'copy' })
    .png()
    .toBuffer();
  await sharp(fg).toFile(path.join(ASSETS, 'android-icon-foreground.png'));

  // 배경: 그림 왼쪽 위 크림색(오른쪽 위엔 램프가 있어 뺀다)(전경이 꽉 차 있어 거의 안 보이지만 가장자리 시차 효과 대비)
  const { data } = await sharp(artBuf).extract({ left: 0, top: 0, width: Math.round(crop.side * 0.3), height: 8 }).raw().toBuffer({ resolveWithObject: true });
  const avg = [0, 1, 2].map((c) => {
    let s = 0;
    for (let i = c; i < data.length; i += 3) s += data[i];
    return Math.round(s / (data.length / 3));
  });
  await sharp({ create: { width: SIZE, height: SIZE, channels: 3, background: { r: avg[0], g: avg[1], b: avg[2] } } })
    .png()
    .toFile(path.join(ASSETS, 'android-icon-background.png'));

  // 단색(테마 아이콘): 초록 공룡·램프처럼 바탕보다 진한 부분만 흰 실루엣으로
  const { data: raw } = await sharp(fg).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const mono = Buffer.alloc(SIZE * SIZE * 4);
  for (let p = 0; p < SIZE * SIZE; p++) {
    const r = raw[p * 3], g = raw[p * 3 + 1], b = raw[p * 3 + 2];
    const dark = 255 - (r * 0.3 + g * 0.59 + b * 0.11);
    const a = Math.max(0, Math.min(1, (dark - 45) / 60));
    mono[p * 4] = mono[p * 4 + 1] = mono[p * 4 + 2] = 255;
    mono[p * 4 + 3] = Math.round(a * 255);
  }
  await sharp(mono, { raw: { width: SIZE, height: SIZE, channels: 4 } })
    .png()
    .toFile(path.join(ASSETS, 'android-icon-monochrome.png'));

  const hex = '#' + avg.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
  console.log(JSON.stringify({ crop, background: hex }));
})();
