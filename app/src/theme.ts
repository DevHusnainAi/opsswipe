// OpsSwipe design tokens. Dark only: a pager used at night, on OLED.
// One accent (green = healthy / go). Red and amber mean severity, nothing else.
import type { TextStyle } from 'react-native';

export const c = {
  bg: '#0A0A0A', // off true black (Material dark theme guidance)
  surface: '#111111',
  surface2: '#171717',
  border: '#262626',
  borderStrong: '#333333',
  text: '#EDEDED',
  muted: '#A1A1AA', // 7:1 on surface, safe for small text
  green: '#10B981',
  onGreen: '#03150E',
  greenTint: 'rgba(16,185,129,0.14)',
  red: '#F87171', // desaturated for dark backgrounds
  redTint: 'rgba(248,113,113,0.14)',
  amber: '#FBBF24',
  amberTint: 'rgba(251,191,36,0.14)',
};

// One radius scale, used everywhere.
export const radius = { card: 16, control: 12, chip: 6, badge: 28 }; // badge: the round icon tiles
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const TARGET = 48; // Android minimum touch target, dp

// Geist for reading, Geist Mono for machine data (servers, metrics, times).
const sans = (size: number, weight: TextStyle['fontWeight'], lineHeight: number): TextStyle =>
  ({ fontFamily: 'Geist', fontSize: size, fontWeight: weight, lineHeight, color: c.text });
const mono = (size: number, weight: TextStyle['fontWeight'], lineHeight: number): TextStyle =>
  ({ fontFamily: 'GeistMono', fontSize: size, fontWeight: weight, lineHeight, color: c.text });

export const type = {
  display: sans(26, '600', 32),
  title: sans(20, '600', 26),
  body: sans(15, '400', 22),
  label: sans(13, '500', 18),
  caption: { ...sans(12, '400', 16), color: c.muted },
  mono: mono(13, '400', 18),
  monoStrong: mono(15, '500', 20),
  monoCaption: { ...mono(12, '400', 16), color: c.muted },
};
