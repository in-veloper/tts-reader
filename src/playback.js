import { useSyncExternalStore } from 'react';
import { Asset } from 'expo-asset';
import {
  createAudioPlayer,
  requestNotificationPermissionsAsync,
  setAudioModeAsync,
} from 'expo-audio';

import { displayName } from './library';
import PlayerWidget from '../modules/player-widget';

export const RATES = [1, 1.25, 1.5, 1.75, 2];
export const REPEAT_MODES = [
  { mode: 'none', icon: 'arrow-forward', label: '반복 없음' },
  { mode: 'all', icon: 'repeat', label: '전체 반복' },
  { mode: 'single', icon: 'reload', label: '한 곡 반복' },
];

export const player = createAudioPlayer(null, { updateInterval: 500 });

let state = { queue: [], index: -1, track: null, repeatIndex: 0, rate: 1 };
const listeners = new Set();
let pendingSeek = null;
let prepared = false;

function emit(next) {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePlayback() {
  return useSyncExternalStore(subscribe, () => state);
}

// 잠금화면 컨트롤을 켜야 안드로이드에서 백그라운드 재생이 3분 넘게 유지된다.
export async function preparePlayback() {
  if (prepared) return;
  prepared = true;

  await setAudioModeAsync({
    playsInSilentMode: true,
    shouldPlayInBackground: true,
    interruptionMode: 'doNotMix',
  });

  try {
    await requestNotificationPermissionsAsync();
  } catch {
    // 알림 권한이 없어도 재생 자체는 된다. 잠금화면 표시만 빠진다.
  }
}

// 삼성 미디어 위젯·잠금화면은 앨범 아트에서 뽑은 색으로 스스로 물든다.
// 아트를 안 주면 재생 파일마다 제각각 색이 나오는데(보라 계열로 자주 떨어짐),
// 우리 쪽에서 고정된 이미지를 하나 줘서 항상 같은 차분한 톤이 나오게 한다.
// require() 는 번들 안의 자산을 가리킬 뿐이고, 기기에서 실제로 읽을 수 있는
// file:// 경로로 바꾸려면 expo-asset 으로 한 번 내려받아야(캐시로 복사) 한다.
let artworkUriPromise = null;
function resolveArtworkUri() {
  if (!artworkUriPromise) {
    artworkUriPromise = (async () => {
      try {
        const asset = Asset.fromModule(require('../assets/artwork.png'));
        await asset.downloadAsync();
        return asset.localUri || asset.uri || null;
      } catch {
        return null;
      }
    })();
  }
  return artworkUriPromise;
}

async function applyLockScreen(item) {
  if (!item) return;
  try {
    const artworkUrl = await resolveArtworkUri();
    player.setActiveForLockScreen(
      true,
      {
        title: displayName(item.name),
        artist: item.folder,
        albumTitle: '스텝바이',
        ...(artworkUrl ? { artworkUrl } : {}),
      },
      { showSeekForward: true, showSeekBackward: true }
    );
  } catch {
    // 잠금화면 표시가 안 되어도 재생은 계속된다.
  }
}

function load(index, startPosition = 0) {
  const item = state.queue[index];
  if (!item) return;

  pendingSeek = startPosition > 1 ? startPosition : null;

  player.replace(item.uri);
  player.loop = REPEAT_MODES[state.repeatIndex].mode === 'single';
  player.setPlaybackRate(state.rate);
  player.play();

  applyLockScreen(item);
  emit({ index, track: item });
}

// 홈/잠금화면 위젯은 지금 재생 중인 게 뭔지 스스로 알 방법이 없다 — 제목·재생
// 여부가 바뀔 때마다 여기서 밀어 준다. 위치(currentTime) 는 0.5초마다 바뀌므로
// 매번 보내면 위젯을 쓸데없이 자주 다시 그리게 된다. 제목+재생 여부만 바뀔
// 때만 보낸다.
let lastWidgetKey = null;
function pushWidgetState(playing) {
  if (!PlayerWidget) return;

  const track = state.track;
  const key = `${track?.id || ''}|${playing}`;
  if (key === lastWidgetKey) return;
  lastWidgetKey = key;

  PlayerWidget.update(
    track ? displayName(track.name) : null,
    track?.folder || null,
    !!playing
  );
}

// 위젯 버튼(재생/이전/다음)은 여기로 들어온다. 앱이 완전히 꺼져 있으면 이
// 리스너 자체가 없으니(=JS 가 안 떠 있으니) 위젯 쪽에서 대신 앱을 연다 —
// 백그라운드 재생 중일 때만 이 경로가 실제로 쓰인다.
PlayerWidget?.addListener('onWidgetAction', (e) => {
  if (e?.action === 'toggle') togglePlay();
  else if (e?.action === 'next') next();
  else if (e?.action === 'previous') previous();
});

player.addListener('playbackStatusUpdate', (status) => {
  if (pendingSeek != null && status.isLoaded) {
    const target = pendingSeek;
    pendingSeek = null;
    player.seekTo(target);
  }

  pushWidgetState(status.playing);

  // loop 이 켜져 있으면(한 곡 반복) didJustFinish 는 오지 않는다.
  if (status.didJustFinish) advance();
});

function advance() {
  const repeat = REPEAT_MODES[state.repeatIndex].mode;
  const last = state.index >= state.queue.length - 1;

  if (last && repeat !== 'all') {
    player.pause();
    return;
  }

  load(last ? 0 : state.index + 1);
}

export async function playQueue(items, index, startPosition = 0) {
  await preparePlayback();
  emit({ queue: items });
  load(index, startPosition);
}

// 서재에서 파일을 지우면 큐에 남은 유령 항목을 걷어낸다.
export function pruneQueue(validIds) {
  if (!state.queue.length) return;

  const valid = new Set(validIds);
  const queue = state.queue.filter((item) => valid.has(item.id));
  if (queue.length === state.queue.length) return;

  const currentGone = state.track && !valid.has(state.track.id);

  if (!queue.length || currentGone) {
    player.pause();
    try {
      player.clearLockScreenControls();
    } catch {
      // 잠금화면에 올라가 있지 않았으면 무시.
    }
    emit({ queue: [], index: -1, track: null });
    pushWidgetState(false);
    return;
  }

  emit({ queue, index: queue.findIndex((item) => item.id === state.track.id) });
}

export function togglePlay() {
  if (!state.track) return;
  if (player.playing) player.pause();
  else player.play();
}

export function next() {
  if (state.index < state.queue.length - 1) load(state.index + 1);
  else if (REPEAT_MODES[state.repeatIndex].mode === 'all') load(0);
}

export function previous() {
  // 10초 넘게 재생했으면 처음으로, 아니면 이전 곡으로.
  if (player.currentTime > 10) {
    player.seekTo(0);
    return;
  }
  if (state.index > 0) load(state.index - 1);
  else player.seekTo(0);
}

export function seekBy(seconds) {
  const target = Math.max(0, player.currentTime + seconds);
  player.seekTo(Math.min(target, player.duration || target));
}

export function seekTo(seconds) {
  player.seekTo(seconds);
}

export function setRate(rate) {
  emit({ rate });
  player.setPlaybackRate(rate);
}

export function cycleRepeat() {
  const repeatIndex = (state.repeatIndex + 1) % REPEAT_MODES.length;
  emit({ repeatIndex });
  player.loop = REPEAT_MODES[repeatIndex].mode === 'single';
}

export function formatSeconds(seconds) {
  if (!seconds || seconds < 0) return '0:00';

  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;

  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    return `${hours}:${String(minutes % 60).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
  }

  return `${minutes}:${String(rest).padStart(2, '0')}`;
}
