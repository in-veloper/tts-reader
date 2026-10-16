// 흰 배경에 옅은 민트(#1FA093/#3FBFA0)를 썼더니 포인트 색이 묻혀서 가시성이
// 떨어졌다 — 훨씬 짙고 채도 높은 틸→시안 조합으로 바꿨다. 아이콘의 파랑 쪽
// 그라데이션과도 더 잘 맞는다. 글자 톤도 슬레이트 계열로 바꿔서 흰 배경에서
// 또렷하게 읽히게 했다.
export const colors = {
  bg: '#FFFFFF',
  surface: '#FFFFFF',
  surfaceHigh: '#F1F5F4',
  border: 'rgba(15, 23, 22, 0.09)',
  borderStrong: 'rgba(15, 23, 22, 0.18)',

  text: '#0F172A',
  textDim: '#475569',
  textFaint: '#64748B',

  accent: '#0D9488',
  accentEnd: '#0891B2',
  accentSoft: '#0F766E',

  ok: '#0D9488',
  danger: '#DC2626',
};

export const gradient = [colors.accent, colors.accentEnd];

export const radius = {
  sm: 12,
  md: 16,
  lg: 20,
  pill: 999,
};

// 작은 대문자풍 라벨. 화면 전체에서 같은 톤을 유지한다.
export const label = {
  fontSize: 11,
  fontWeight: '700',
  letterSpacing: 1.4,
  color: colors.textFaint,
};
