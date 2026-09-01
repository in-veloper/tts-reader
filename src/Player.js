import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import { useAudioPlayerStatus } from 'expo-audio';

import {
  RATES,
  REPEAT_MODES,
  cycleRepeat,
  formatSeconds,
  next,
  player,
  previous,
  seekBy,
  seekTo,
  setRate,
  togglePlay,
  usePlayback,
} from './playback';
import { colors, radius } from './theme';
import { displayName } from './library';
import { Sheet } from './ui';

const SLEEP_OPTIONS = [0, 10, 20, 30, 60];

export function MiniPlayer({ onPress }) {
  const { track } = usePlayback();
  const status = useAudioPlayerStatus(player);

  if (!track) return null;

  const ratio = status.duration > 0 ? status.currentTime / status.duration : 0;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.mini, pressed && { opacity: 0.9 }]}
    >
      <View style={styles.miniProgress}>
        <View style={[styles.miniProgressFill, { width: `${ratio * 100}%` }]} />
      </View>

      <View style={styles.miniBody}>
        <View style={styles.miniText}>
          <Text style={styles.miniTitle} numberOfLines={1}>
            {displayName(track.name)}
          </Text>
          <Text style={styles.miniSub} numberOfLines={1}>
            {track.folder} · {formatSeconds(status.currentTime)} /{' '}
            {formatSeconds(status.duration)}
          </Text>
        </View>

        <Pressable onPress={togglePlay} hitSlop={10} style={styles.miniButton}>
          <Ionicons
            name={status.playing ? 'pause' : 'play'}
            size={20}
            color={colors.bg}
          />
        </Pressable>

        <Pressable onPress={next} hitSlop={10} style={styles.miniGhost}>
          <Ionicons name="play-skip-forward" size={18} color={colors.textDim} />
        </Pressable>
      </View>
    </Pressable>
  );
}

export function PlayerSheet({
  visible,
  onClose,
  sleepMinutes,
  onSleep,
  sleepRemaining,
}) {
  const { track, repeatIndex, rate } = usePlayback();
  const status = useAudioPlayerStatus(player);

  const repeat = REPEAT_MODES[repeatIndex];

  return (
    <Sheet visible={visible} title="재생 중" onClose={onClose}>
      <Text style={styles.title} numberOfLines={3}>
        {track ? displayName(track.name) : '재생 중인 파일이 없습니다'}
      </Text>
      {track?.folder ? <Text style={styles.folder}>{track.folder}</Text> : null}

      <Slider
        style={styles.seek}
        value={status.currentTime}
        minimumValue={0}
        maximumValue={Math.max(status.duration, 1)}
        onSlidingComplete={seekTo}
        minimumTrackTintColor={colors.accent}
        maximumTrackTintColor={colors.surfaceHigh}
        thumbTintColor={colors.accentSoft}
      />
      <View style={styles.times}>
        <Text style={styles.timeText}>{formatSeconds(status.currentTime)}</Text>
        <Text style={styles.timeText}>
          -{formatSeconds(Math.max(0, status.duration - status.currentTime))}
        </Text>
      </View>

      <View style={styles.controls}>
        <Control icon="play-skip-back" onPress={previous} />
        <Control icon="play-back" label="15" onPress={() => seekBy(-15)} />
        <Pressable onPress={togglePlay} style={styles.bigButton}>
          <Ionicons
            name={status.playing ? 'pause' : 'play'}
            size={30}
            color={colors.bg}
          />
        </Pressable>
        <Control icon="play-forward" label="15" onPress={() => seekBy(15)} />
        <Control icon="play-skip-forward" onPress={next} />
      </View>

      <View style={styles.optionRow}>
        <Option
          icon={repeat.icon}
          text={repeat.label}
          active={repeatIndex > 0}
          onPress={cycleRepeat}
        />
        <Option
          icon="speedometer-outline"
          text={`${rate}x`}
          active={rate !== 1}
          onPress={() => setRate(RATES[(RATES.indexOf(rate) + 1) % RATES.length])}
        />
      </View>

      <View style={styles.sleepRow}>
        {SLEEP_OPTIONS.map((minutes) => (
          <Pressable
            key={minutes}
            onPress={() => onSleep(minutes)}
            style={[
              styles.sleepChip,
              sleepMinutes === minutes && styles.sleepChipActive,
            ]}
          >
            <Text
              style={[
                styles.sleepText,
                sleepMinutes === minutes && styles.sleepTextActive,
              ]}
            >
              {minutes === 0 ? '타이머 끔' : `${minutes}분`}
            </Text>
          </Pressable>
        ))}
      </View>

      {sleepRemaining ? (
        <Text style={styles.sleepNote}>{sleepRemaining} 뒤에 재생이 멈춥니다</Text>
      ) : null}
    </Sheet>
  );
}

function Control({ icon, label, onPress }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} style={styles.control}>
      <Ionicons name={icon} size={22} color={colors.text} />
      {label ? <Text style={styles.controlLabel}>{label}</Text> : null}
    </Pressable>
  );
}

function Option({ icon, text, active, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.option, active && styles.optionActive]}
    >
      <Ionicons
        name={icon}
        size={17}
        color={active ? colors.accentSoft : colors.textDim}
      />
      <Text style={[styles.optionText, active && { color: colors.accentSoft }]}>
        {text}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  mini: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  miniProgress: { height: 2, backgroundColor: colors.surfaceHigh },
  miniProgressFill: { height: 2, backgroundColor: colors.accent },
  miniBody: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  miniText: { flex: 1 },
  miniTitle: { color: colors.text, fontSize: 13, fontWeight: '700' },
  miniSub: { color: colors.textFaint, fontSize: 11, marginTop: 2 },
  miniButton: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
  },
  miniGhost: { padding: 6 },

  title: { color: colors.text, fontSize: 18, fontWeight: '700', lineHeight: 25 },
  folder: { color: colors.accentSoft, fontSize: 13, marginTop: 6 },

  seek: { marginTop: 18, marginHorizontal: -8 },
  times: { flexDirection: 'row', justifyContent: 'space-between' },
  timeText: { color: colors.textFaint, fontSize: 12 },

  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 20,
    paddingHorizontal: 6,
  },
  control: { alignItems: 'center', padding: 8 },
  controlLabel: { color: colors.textFaint, fontSize: 9, marginTop: 1 },
  bigButton: {
    width: 66,
    height: 66,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
  },

  optionRow: { flexDirection: 'row', gap: 10, marginTop: 22 },
  option: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingVertical: 13,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceHigh,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  optionActive: { borderColor: colors.accent },
  optionText: { color: colors.textDim, fontSize: 13, fontWeight: '700' },

  sleepRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  sleepChip: {
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceHigh,
  },
  sleepChipActive: { backgroundColor: colors.accent },
  sleepText: { color: colors.textDim, fontSize: 12, fontWeight: '600' },
  sleepTextActive: { color: '#fff' },
  sleepNote: {
    color: colors.textFaint,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 12,
  },
});
