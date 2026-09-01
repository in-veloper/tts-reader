import { useCallback, useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { colors, gradient, label, radius } from './theme';

export function Card({ style, children }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Label({ children, style }) {
  return <Text style={[styles.label, style]}>{children}</Text>;
}

export function PrimaryButton({ icon, text, onPress, disabled }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.primaryWrap,
        disabled && styles.dimmed,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <LinearGradient
        colors={disabled ? [colors.surfaceHigh, colors.surfaceHigh] : gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.primary}
      >
        <Ionicons
          name={icon}
          size={20}
          color={disabled ? colors.textFaint : '#fff'}
        />
        <Text
          style={[styles.primaryText, disabled && { color: colors.textFaint }]}
        >
          {text}
        </Text>
      </LinearGradient>
    </Pressable>
  );
}

export function CircleButton({ icon, onPress, disabled, tint }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.circle,
        disabled && styles.dimmed,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <Ionicons
        name={icon}
        size={20}
        color={disabled ? colors.textFaint : tint || colors.text}
      />
    </Pressable>
  );
}

export function GhostButton({ icon, text, onPress, disabled, busy }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.ghost,
        disabled && styles.dimmed,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <Ionicons
        name={icon}
        size={18}
        color={disabled ? colors.textFaint : colors.accentSoft}
      />
      <Text style={[styles.ghostText, disabled && { color: colors.textFaint }]}>
        {text}
      </Text>
      {busy ? <Dots /> : null}
    </Pressable>
  );
}

export function ProgressBar({ value }) {
  const width = `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`;
  return (
    <View style={styles.track}>
      <LinearGradient
        colors={gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={[styles.fill, { width }]}
      />
    </View>
  );
}

// 저장 중인 동안 도는 점 세 개.
function Dots() {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, {
          toValue: 1,
          duration: 600,
          useNativeDriver: true,
        }),
        Animated.timing(anim, {
          toValue: 0,
          duration: 600,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [anim]);

  return (
    <Animated.View style={{ opacity: anim.interpolate({
      inputRange: [0, 1],
      outputRange: [0.3, 1],
    }) }}>
      <Text style={styles.ghostText}>···</Text>
    </Animated.View>
  );
}

export function Sheet({ visible, title, onClose, children }) {
  const translateY = useRef(new Animated.Value(0)).current;

  // PanResponder 는 한 번만 만들어지므로 최신 onClose 는 ref 로 읽는다.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (visible) translateY.setValue(0);
  }, [visible, translateY]);

  const closeSheetRef = useRef(null);

  closeSheetRef.current = () => {
    Animated.timing(translateY, {
      toValue: 700,
      duration: 180,
      useNativeDriver: false,
    }).start(() => {
      translateY.setValue(0);
      closeRef.current?.();
    });
  };

  // 손잡이 띠에서 터치가 시작되면 무조건 이 제스처를 가져간다.
  // 네이티브 드라이버를 쓰면 드래그 중 setValue 가 화면에 반영되지 않아 끄고 쓴다.
  const drag = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,

      onPanResponderMove: (_, g) => {
        if (g.dy > 0) translateY.setValue(g.dy);
      },

      onPanResponderRelease: (_, g) => {
        // 끌어내렸거나, 손잡이를 그냥 탭했을 때도 닫는다.
        if (g.dy > 90 || g.vy > 0.7 || Math.abs(g.dy) < 6) {
          closeSheetRef.current();
          return;
        }

        Animated.spring(translateY, {
          toValue: 0,
          useNativeDriver: false,
          bounciness: 2,
        }).start();
      },

      onPanResponderTerminate: () => {
        Animated.spring(translateY, {
          toValue: 0,
          useNativeDriver: false,
          bounciness: 2,
        }).start();
      },
    })
  ).current;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.sheetRoot}>
        <Pressable style={styles.backdrop} onPress={onClose} />

        <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
          <View style={styles.dragZone} {...drag.panHandlers}>
            <View style={styles.grabber} />
          </View>

          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={22} color={colors.textDim} />
            </Pressable>
          </View>

          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

export function Toast({ toast, onHide }) {
  const anim = useRef(new Animated.Value(0)).current;

  // onHide 는 대부분 인라인 함수로 넘어온다. 그대로 의존성에 넣으면
  // 부모가 리렌더될 때마다 타이머가 초기화돼서 토스트가 사라지지 않는다.
  const hideRef = useRef(onHide);
  hideRef.current = onHide;

  const dismiss = useCallback(() => {
    Animated.timing(anim, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => hideRef.current?.());
  }, [anim]);

  useEffect(() => {
    if (!toast) return undefined;

    anim.setValue(0);
    Animated.timing(anim, {
      toValue: 1,
      duration: 220,
      useNativeDriver: true,
    }).start();

    const timer = setTimeout(dismiss, 3500);
    return () => clearTimeout(timer);
  }, [toast, anim, dismiss]);

  if (!toast) return null;

  const ok = toast.type === 'ok';
  return (
    <Animated.View
      style={[
        styles.toast,
        {
          opacity: anim,
          transform: [
            { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) },
          ],
        },
      ]}
    >
      <Pressable onPress={dismiss} style={styles.toastPress}>
        <Ionicons
          name={ok ? 'checkmark-circle' : 'alert-circle'}
          size={18}
          color={ok ? colors.ok : colors.danger}
        />
        <Text style={styles.toastText} numberOfLines={2}>
          {toast.message}
        </Text>
        <Ionicons name="close" size={16} color={colors.textFaint} />
      </Pressable>
    </Animated.View>
  );
}

export function Chip({ text, active, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        active && styles.chipActive,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{text}</Text>
    </Pressable>
  );
}

// 화면 전체를 덮어야 하므로 Modal 로 띄운다. 일반 View 는 탭바나 시트에 가릴 수 있다.
export function Overlay({ visible, text, progress }) {
  const hasProgress = progress && progress.total > 0;

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
      <View style={styles.overlay}>
        <View style={styles.overlayCard}>
          <ActivityIndicator color={colors.accentSoft} size="large" />
          <Text style={styles.overlayText}>{text}</Text>

          {hasProgress ? (
            <View style={styles.overlayProgress}>
              <ProgressBar value={progress.index / progress.total} />
              <Text style={styles.overlayCount}>
                {progress.index} / {progress.total} 구간
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
  },
  label: { ...label },
  dimmed: { opacity: 0.45 },
  pressed: { opacity: 0.8, transform: [{ scale: 0.985 }] },

  primaryWrap: { flex: 1, borderRadius: radius.pill, overflow: 'hidden' },
  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
  },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  circle: {
    width: 54,
    height: 54,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceHigh,
    borderWidth: 1,
    borderColor: colors.border,
  },

  ghost: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderStyle: 'dashed',
  },
  ghostText: { color: colors.accentSoft, fontSize: 14, fontWeight: '600' },

  track: {
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceHigh,
    overflow: 'hidden',
  },
  fill: { height: 4, borderRadius: radius.pill },

  sheetRoot: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(2,6,23,0.7)' },
  sheet: {
    maxHeight: '82%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 20,
    paddingBottom: 28,
  },
  dragZone: { height: 38, alignItems: 'center', justifyContent: 'center' },
  grabber: {
    width: 46,
    height: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.borderStrong,
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  sheetTitle: {
    color: colors.text,
    fontSize: 19,
    fontWeight: '700',
    letterSpacing: -0.3,
  },

  toast: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surfaceHigh,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  toastPress: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  toastText: { flex: 1, color: colors.text, fontSize: 13, lineHeight: 19 },

  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceHigh,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  chipActive: {
    borderColor: colors.accent,
    backgroundColor: 'rgba(139,92,246,0.14)',
  },
  chipText: { color: colors.textDim, fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: colors.accentSoft },

  // Modal 안에서는 absoluteFill 이 화면을 채우지 못한다. flex 로 채워야 가운데에 온다.
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(2,6,23,0.78)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlayCard: {
    alignItems: 'center',
    gap: 14,
    paddingVertical: 28,
    paddingHorizontal: 36,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  overlayText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  overlayProgress: { alignSelf: 'stretch', gap: 8, minWidth: 180, marginTop: 2 },
  overlayCount: {
    color: colors.textDim,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
});
