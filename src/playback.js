import { useSyncExternalStore } from 'react';
import {
  createAudioPlayer,
  requestNotificationPermissionsAsync,
  setAudioModeAsync,
} from 'expo-audio';

import { displayName } from './library';

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

function applyLockScreen(item) {
  if (!item) return;
  try {
    player.setActiveForLockScreen(
      true,
      { title: displayName(item.name), artist: item.folder, albumTitle: '스텝바이' },
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

player.addListener('playbackStatusUpdate', (status) => {
  if (pendingSeek != null && status.isLoaded) {
    const target = pendingSeek;
    pendingSeek = null;
    player.seekTo(target);
  }

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
