import { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

import { colors } from './theme';

// 입체로 빙글빙글 도는 점 로딩 표시.
// 팔면체 꼭짓점 6개에 점을 두고 기울어진 축을 중심으로 돌린 뒤 화면에 비춘다 —
// 앞으로 오는 점은 크고 진하게, 뒤로 가는 점은 작고 흐리게 그려서 깊이감을 낸다.
// 각도마다 위치를 미리 계산해 두고(샘플) 그 사이를 이어서, 애니메이션은 화면 쪽(네이티브)에서만 돈다.
const VERTICES = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];
const AXIS = (() => {
  const a = [0.55, 1, 0.3];
  const n = Math.hypot(...a);
  return a.map((v) => v / n);
})();
const SAMPLES = 48;
const PERIOD_MS = 1800;

// 축 a 를 중심으로 각 t 만큼 돌린 점(로드리게스 회전)
function rotate([x, y, z], t) {
  const [ax, ay, az] = AXIS;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const dot = ax * x + ay * y + az * z;
  return [
    x * c + (ay * z - az * y) * s + ax * dot * (1 - c),
    y * c + (az * x - ax * z) * s + ay * dot * (1 - c),
    z * c + (ax * y - ay * x) * s + az * dot * (1 - c),
  ];
}

export default function DotLoader({ size = 40, color = colors.accent }) {
  const t = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const spin = Animated.loop(
      Animated.timing(t, { toValue: 1, duration: PERIOD_MS, easing: Easing.linear, useNativeDriver: true })
    );
    spin.start();
    return () => spin.stop();
  }, [t]);

  const dot = size * 0.2;
  const reach = size / 2 - dot * 0.6;

  // 점마다 한 바퀴 동안의 위치·크기·진하기 표
  const tracks = useMemo(() => {
    const input = Array.from({ length: SAMPLES + 1 }, (_, k) => k / SAMPLES);
    return VERTICES.map((v) => {
      const xs = [];
      const ys = [];
      const scales = [];
      const alphas = [];
      input.forEach((k) => {
        const [x, y, z] = rotate(v, k * Math.PI * 2);
        const depth = (z + 1) / 2; // 0 뒤 ~ 1 앞
        xs.push(x * reach);
        ys.push(-y * reach);
        scales.push(0.45 + depth * 0.75);
        alphas.push(0.25 + depth * 0.75);
      });
      return { input, xs, ys, scales, alphas };
    });
  }, [reach]);

  return (
    <View style={{ width: size, height: size }}>
      {tracks.map((tr, i) => (
        <Animated.View
          key={i}
          style={[
            styles.dot,
            {
              width: dot,
              height: dot,
              borderRadius: dot * 0.3,
              backgroundColor: color,
              left: size / 2 - dot / 2,
              top: size / 2 - dot / 2,
              opacity: t.interpolate({ inputRange: tr.input, outputRange: tr.alphas }),
              transform: [
                { translateX: t.interpolate({ inputRange: tr.input, outputRange: tr.xs }) },
                { translateY: t.interpolate({ inputRange: tr.input, outputRange: tr.ys }) },
                { scale: t.interpolate({ inputRange: tr.input, outputRange: tr.scales }) },
              ],
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  dot: { position: 'absolute' },
});
