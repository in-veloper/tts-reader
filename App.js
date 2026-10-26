import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
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
import { playQueue, player, resumeFromWidget, syncQueue, usePlayback } from './src/playback';
import { colors, radius } from './src/theme';
import { Overlay, Toast } from './src/ui';

const SAVE_EVERY_MS = 5000;
const COUNT_AT = 0.85;

// 화면 위·아래 여백은 시스템이 알려주는 실제 값(상태바·네비게이션 바)을 쓴다.
// 예전엔 react-native 의 SafeAreaView(안드로이드에선 아무 일도 안 함) + 상태바
// 높이만 직접 더해서, 버튼식 네비게이션 바를 켜면 하단 탭이 그 밑에 가려졌다.
export default function App() {
  return (
    <SafeAreaProvider>
      <Main />
    </SafeAreaProvider>
  );
}

function Main() {
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
  // 키보드가 올라오면 미니 플레이어·탭 메뉴까지 같이 밀려 올라와 입력칸이 한두 줄만 남았다.
  // 키보드가 떠 있는 동안엔 둘을 숨겨 글 고치는 칸을 최대한 넓힌다.
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardOpen(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardOpen(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

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
      syncQueue(found);
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

  // 잠금화면 위젯을 눌렀는데 앱(JS)이 완전히 꺼져 있었으면 위젯이
  // stepby://widget?action=... 링크로 앱을 연다 — 그 신호를 받아서 마지막으로
  // 듣던 걸 이어 튼다. 앱을 그냥 아이콘으로 직접 열었을 때는 이 링크가 없으니
  // 평소처럼 조용히 뜬다.
  useEffect(() => {
    const handleUrl = (url) => {
      if (!url || !url.includes('widget')) return;
      const action = /action=([a-z]+)/.exec(url)?.[1] || 'toggle';
      resumeFromWidget(action);
    };

    Linking.getInitialURL().then(handleUrl);
    const sub = Linking.addEventListener('url', ({ url }) => handleUrl(url));
    return () => sub.remove();
  }, []);

  // 들은 위치를 주기적으로 남기고, 85% 를 넘기면 재생 횟수를 한 번 올린다.
  useEffect(() => {
    if (!track?.id || !status.duration) return;

    if (countedRef.current.id !== track.id) {
      countedRef.current = { id: track.id, counted: false, ready: false };
    }

    // 다음 곡으로 넘어간 직후엔 track 은 이미 새 곡인데 status 는 잠깐 앞 곡의
    // 재생 시간(끝 무렵)을 그대로 들고 온다. 그걸 새 곡 위치로 저장하면 끊은 적도
    // 없는 파일에 "이어듣기"가 생기고, 나중에 그 엉뚱한 위치로 튄다.
    // 새 곡이 처음부터 시작된 걸 봤거나(0~2초) 길이가 그 파일 길이와 맞을 때만 믿는다.
    if (!countedRef.current.ready) {
      const fileSec = (track.durationMs || 0) / 1000;
      const sameLength = fileSec > 0 && Math.abs(status.duration - fileSec) < 1.5;
      if (status.currentTime < 2 || sameLength) countedRef.current.ready = true;
      else return;
    }
    if (status.currentTime > status.duration + 1) return;

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

  const play = useCallback(async (queue, index, scope) => {
    try {
      await playQueue(queue, index, queue[index]?.position || 0, scope);
    } catch (e) {
      setToast({ type: 'error', message: e?.message || '재생에 실패했습니다.' });
    }
  }, []);

  const sleepRemaining = sleepAt
    ? `${Math.max(1, Math.ceil((sleepAt - now) / 60000))}분`
    : null;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom', 'left', 'right']}>
      <StatusBar style="dark" />
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
            <Text style={styles.brand}>STEPBY</Text>
          </View>

          <View style={styles.content}>
            {tab === 'create' ? (
              <CreateScreen
                onToast={setToast}
                onBusy={setBusy}
                folders={folders}
                onSaved={refresh}
                keyboardOpen={keyboardOpen}
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

          {!keyboardOpen && <MiniPlayer onPress={() => setPlayerOpen(true)} />}

          <View style={[styles.tabBar, keyboardOpen && styles.hidden]}>
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
  },
  flex: { flex: 1 },
  screen: { flex: 1, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 10, gap: 12 },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  // READTRACK·CREDO 처럼 영문 대문자 + 넓은 자간 워드마크
  brand: { color: colors.text, fontFamily: 'Pretendard-Bold', fontSize: 20, letterSpacing: 5 },

  content: { flex: 1 },
  hidden: { display: 'none' },

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
