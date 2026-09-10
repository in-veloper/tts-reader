// 안드로이드 TextToSpeech 는 한 번 호출에 4000자까지만 받는다.
// 여유를 둬서 3500자 단위로 자르고, 가능하면 문장 경계에서 끊는다.
const MAX_LEN = 3500;

const SENTENCE_END = '.!?。！？…';

function splitSentences(text) {
  const out = [];
  let cur = '';

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    cur += ch;

    const next = text[i + 1];
    const isBreak =
      ch === '\n' ||
      (SENTENCE_END.includes(ch) && (next === undefined || /\s/.test(next)));

    if (isBreak) {
      const trimmed = cur.trim();
      if (trimmed) out.push(trimmed);
      cur = '';
    }
  }

  const tail = cur.trim();
  if (tail) out.push(tail);
  return out;
}

// 한 문장이 통째로 제한을 넘으면 공백 기준으로 강제 분할한다.
function hardSplit(sentence) {
  if (sentence.length <= MAX_LEN) return [sentence];

  const parts = [];
  let rest = sentence;

  while (rest.length > MAX_LEN) {
    let cut = rest.lastIndexOf(' ', MAX_LEN);
    if (cut < MAX_LEN * 0.5) cut = MAX_LEN;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }

  if (rest) parts.push(rest);
  return parts;
}

export function chunkText(input) {
  const text = (input || '').trim();
  if (!text) return [];

  const chunks = [];
  let buf = '';

  for (const sentence of splitSentences(text)) {
    for (const piece of hardSplit(sentence)) {
      if (!buf) {
        buf = piece;
      } else if (buf.length + 1 + piece.length <= MAX_LEN) {
        buf += ' ' + piece;
      } else {
        chunks.push(buf);
        buf = piece;
      }
    }
  }

  if (buf) chunks.push(buf);
  return chunks;
}

// 문장 끝 마침표는 TTS 가 알아서 쉬어 준다. 그런데 줄바꿈은 아무 흔적도 안 남는다 —
// chunkText 가 줄을 공백으로 이어 붙여 한 덩어리로 만들기 때문에, 조문처럼 줄로
// 구분해 놓은 글이 통째로 쭉 이어져 읽힌다.
//
// 그래서 읽을 때는 줄 단위로 끊어서 합성하고, 사이에 진짜 무음을 넣는다.
// 줄 안의 문장들은 그대로 두는데(마침표가 이미 쉼표 역할을 한다), 그래야
// 합성 호출 수가 쓸데없이 늘어나지 않는다.
//
// gap: 'para' = 빈 줄로 나뉜 문단 사이, 'line' = 그냥 줄바꿈, 'none' = 마지막
export function segmentText(input) {
  const text = (input || '').replace(/\r\n?/g, '\n').trim();
  if (!text) return [];

  const segments = [];

  // 빈 줄(하나 이상)로 문단을 먼저 가른다.
  const paragraphs = text.split(/\n[ \t]*\n+/);

  paragraphs.forEach((para, pi) => {
    const lines = para
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    lines.forEach((line, li) => {
      const lastLine = li === lines.length - 1;
      const lastPara = pi === paragraphs.length - 1;

      for (const piece of hardSplit(line)) {
        segments.push({ text: piece, gap: 'line' });
      }

      if (lastLine) {
        // 문단 끝이면 더 길게 쉰다. 글 전체의 끝이면 쉴 필요가 없다.
        segments[segments.length - 1].gap = lastPara ? 'none' : 'para';
      }
    });
  });

  return segments;
}
