export const colors = {
  bg: '#0B1120',
  surface: '#141B2D',
  surfaceHigh: '#1C2539',
  border: 'rgba(148, 163, 184, 0.14)',
  borderStrong: 'rgba(148, 163, 184, 0.28)',

  text: '#F1F5F9',
  textDim: '#94A3B8',
  textFaint: '#64748B',

  accent: '#8B5CF6',
  accentEnd: '#6366F1',
  accentSoft: '#A78BFA',

  ok: '#34D399',
  danger: '#FB7185',
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
