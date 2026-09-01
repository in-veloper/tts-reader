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
