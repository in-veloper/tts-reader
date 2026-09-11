// 안드로이드 TextToSpeech 는 한 번 호출에 4000자까지만 받는다.
// 여유를 둬서 3500자 단위로 자른다.
const MAX_LEN = 3500;

const SENTENCE_END = '.!?。！？…';
// 판례·조문은 마침표가 맨 끝에 하나뿐이고 나머지는 전부 쉼표로 이어진 긴
// 문장인 경우가 많다("...인정, 부과처분을 위한..., 세무조사는..., ...된다.").
// 마침표만 끊으면 이런 글은 사실상 한 덩어리로 남아 쉼이 하나도 안 생긴다.
// 그래서 쉼표도 끊되, 문장 끝보다 훨씬 짧게 쉰다.
const CLAUSE_END = ',、';

// "2020. 5. 14." 같은 날짜, "100분의 60", "1,000원" 같은 숫자 표기는 구두점
// 앞뒤가 숫자다 — 이건 쉬는 지점이 아니라 그냥 숫자 표기의 일부다.
function boundaryGap(text, i) {
  const ch = text[i];
  const isSentence = SENTENCE_END.includes(ch);
  const isClause = !isSentence && CLAUSE_END.includes(ch);
  if (!isSentence && !isClause) return null;

  const prev = text[i - 1];
  const next = text[i + 1];
  if (/[0-9]/.test(prev || '') && (isSentence || /[0-9]/.test(next || ''))) return null;

  return next === undefined || /\s/.test(next) ? (isSentence ? 'sentence' : 'clause') : null;
}

// 한 줄(또는 문단 안 텍스트)을 문장·쉼표 단위로 쪼갠다. 마침표는 문장 쉼,
// 쉼표는 그보다 짧은 쉼을 붙인다 — 마침표가 하나도 없는 긴 글도 쉼표 지점마다
// 숨 쉬는 느낌이 생긴다.
function splitByPunctuation(text) {
  const out = [];
  let cur = '';

  for (let i = 0; i < text.length; i += 1) {
    cur += text[i];
    const gap = boundaryGap(text, i);
    if (gap) {
      const trimmed = cur.trim();
      if (trimmed) out.push({ text: trimmed, gap });
      cur = '';
    }
  }

  const tail = cur.trim();
  if (tail) out.push({ text: tail, gap: 'sentence' });
  return out;
}

// 한 조각이 통째로 길이 제한을 넘으면 공백 기준으로 강제 분할한다.
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

// 텍스트를 읽기 좋은 조각으로 나누고, 조각마다 "다음 조각으로 넘어가기 전에
// 얼마나 쉴지"를 gap 으로 붙인다.
//   'para'     문단(빈 줄)이 바뀔 때 — 길게 쉰다
//   'line'     줄만 바뀔 때 — 중간 길이로 쉰다
//   'sentence' 마침표로 문장이 끝났을 때 — 짧게 쉰다
//   'clause'   쉼표로 절이 끝났을 때 — 아주 짧게 쉰다
//   'none'     글 전체의 끝 — 안 쉰다
export function segmentText(input) {
  const text = (input || '').replace(/\r\n?/g, '\n').trim();
  if (!text) return [];

  const segments = [];
  const paragraphs = text.split(/\n[ \t]*\n+/);

  paragraphs.forEach((para, pi) => {
    const lines = para
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    lines.forEach((line, li) => {
      const lastLine = li === lines.length - 1;
      const lastPara = pi === paragraphs.length - 1;

      const pieces = splitByPunctuation(line);
      const list = pieces.length ? pieces : [{ text: line, gap: 'none' }];

      list.forEach((piece) => {
        for (const sub of hardSplit(piece.text)) {
          segments.push({ text: sub, gap: piece.gap });
        }
      });

      if (lastLine) {
        segments[segments.length - 1].gap = lastPara ? 'none' : 'para';
      } else {
        segments[segments.length - 1].gap = 'line';
      }
    });
  });

  return segments;
}
