import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  StatusBar as RNStatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useAudioPlayerStatus } from 'expo-audio';

import CreateScreen from './src/CreateScreen';
import LibraryScreen from './src/LibraryScreen';
import { MiniPlayer, PlayerSheet } from './src/Player';
import {
  bumpPlayCount,
  ensureAudioPermission,
  loadLibrary,
  savePosition,
} from './src/library';
import { playQueue, player, pruneQueue, usePlayback } from './src/playback';
import { colors, radius } from './src/theme';
import { Overlay, Toast } from './src/ui';

const SAVE_EVERY_MS = 5000;
const COUNT_AT = 0.85;

export default function App() {
  const [tab, setTab] = useState('create');
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(null);

  const [items, setItems] = useState([]);
  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(false);

  const [playerOpen, setPlayerOpen] = useState(false);
  const [sleepMinutes, setSleepMinutes] = useState(0);
  const [sleepAt, setSleepAt] = useState(null);
  const [now, setNow] = useState(Date.now());

  const { track } = usePlayback();
  const status = useAudioPlayerStatus(player);

  const countedRef = useRef({ id: null, counted: false });
  const savedAtRef = useRef(0);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      await ensureAudioPermission();
      const { items: found, folders: names } = await loadLibrary();
      setItems(found);
      pruneQueue(found.map((item) => item.id));
      setFolders(names);
    } catch (e) {
      setToast({ type: 'error', message: e?.message || '목록을 불러오지 못했습니다.' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // 들은 위치를 주기적으로 남기고, 85% 를 넘기면 재생 횟수를 한 번 올린다.
  useEffect(() => {
    if (!track?.id || !status.duration) return;

    if (countedRef.current.id !== track.id) {
      countedRef.current = { id: track.id, counted: false };
    }

    if (status.currentTime < 5) countedRef.current.counted = false;

    const ratio = status.currentTime / status.duration;

    if (ratio >= COUNT_AT && !countedRef.current.counted) {
      countedRef.current.counted = true;
      bumpPlayCount(track.id).then(refresh);
    }

    const stamp = Date.now();
    if (stamp - savedAtRef.current > SAVE_EVERY_MS) {
      savedAtRef.current = stamp;
      // 거의 다 들었으면 다음에 처음부터 듣도록 위치를 지운다.
      savePosition(track.id, ratio >= COUNT_AT ? 0 : status.currentTime);
    }
  }, [track?.id, status.currentTime, status.duration, refresh]);

  useEffect(() => {
    if (!sleepAt) return undefined;

    const timer = setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= sleepAt) {
        player.pause();
        setSleepAt(null);
        setSleepMinutes(0);
        setToast({ type: 'ok', message: '타이머가 끝나 재생을 멈췄습니다.' });
      }
    }, 5000);

    return () => clearInterval(timer);
  }, [sleepAt]);

  const setSleep = useCallback((minutes) => {
    setSleepMinutes(minutes);
    setSleepAt(minutes > 0 ? Date.now() + minutes * 60000 : null);
  }, []);

  const play = useCallback(async (queue, index) => {
    try {
      await playQueue(queue, index, queue[index]?.position || 0);
    } catch (e) {
      setToast({ type: 'error', message: e?.message || '재생에 실패했습니다.' });
    }
  }, []);

  const sleepRemaining = sleepAt
    ? `${Math.max(1, Math.ceil((sleepAt - now) / 60000))}분`
    : null;

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* 예전엔 이 Pressable 이 화면 전체를 감싸고 있었는데, 그러면 안쪽 목록·본문의
            스크롤 드래그까지 먼저 가로채서 손가락 스크롤이 막힌다(메멘토에서 실제로 겪음).
            내용 뒤에 배경으로만 깔아 두면, 빈 곳 탭은 그대로 키보드를 닫고
            내용 위 제스처는 방해하지 않는다. */}
        <View style={styles.screen}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={Keyboard.dismiss}
            accessible={false}
          />
          <View style={styles.header}>
            <View>
              <Text style={styles.brand}>스텝바이</Text>
              <Text style={styles.tagline}>
                {tab === 'create' ? '텍스트를 목소리로' : '과목별로 듣기'}
              </Text>
            </View>
          </View>

          <View style={styles.content}>
            {tab === 'create' ? (
              <CreateScreen
                onToast={setToast}
                onBusy={setBusy}
                folders={folders}
                onSaved={refresh}
              />
            ) : (
              <LibraryScreen
                items={items}
                folders={folders}
                loading={loading}
                activeId={track?.id}
                onRefresh={refresh}
                onToast={setToast}
                onPlay={play}
              />
            )}
          </View>

          <MiniPlayer onPress={() => setPlayerOpen(true)} />

          <View style={styles.tabBar}>
            <Tab
              icon="create-outline"
              activeIcon="create"
              text="만들기"
              active={tab === 'create'}
              onPress={() => setTab('create')}
            />
            <Tab
              icon="library-outline"
              activeIcon="library"
              text="서재"
              active={tab === 'library'}
              onPress={() => {
                setTab('library');
                refresh();
              }}
            />
          </View>
        </View>
      </KeyboardAvoidingView>

      <PlayerSheet
        visible={playerOpen}
        onClose={() => setPlayerOpen(false)}
        sleepMinutes={sleepMinutes}
        onSleep={setSleep}
        sleepRemaining={sleepRemaining}
      />

      <Overlay
        visible={Boolean(busy)}
        text={busy?.text || ''}
        progress={busy?.progress}
      />
      <Toast toast={toast} onHide={() => setToast(null)} />
    </SafeAreaView>
  );
}

function Tab({ icon, activeIcon, text, active, onPress }) {
  return (
    <Pressable onPress={onPress} style={styles.tab}>
      <Ionicons
        name={active ? activeIcon : icon}
        size={21}
        color={active ? colors.accentSoft : colors.textFaint}
      />
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{text}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingTop: Platform.OS === 'android' ? RNStatusBar.currentHeight : 0,
  },
  flex: { flex: 1 },
  screen: { flex: 1, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 10, gap: 12 },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brand: { color: colors.text, fontSize: 26, fontWeight: '800', letterSpacing: -0.6 },
  tagline: { color: colors.textFaint, fontSize: 13, marginTop: 2 },

  content: { flex: 1 },

  tabBar: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 6,
    gap: 6,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
    paddingVertical: 9,
    borderRadius: radius.md,
  },
  tabText: { color: colors.textFaint, fontSize: 11, fontWeight: '700' },
  tabTextActive: { color: colors.accentSoft },
});
