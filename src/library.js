import { PermissionsAndroid, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import TtsFile from '../modules/tts-file';

const STATS_KEY = 'stepby/stats';
const FOLDERS_KEY = 'stepby/folders';
export const ALL = '전체';
export const UNSORTED = '미분류';

// 안드로이드 13+ 는 다른 앱이 만든 오디오까지 보려면 권한이 필요하다.
// 앱을 지웠다 다시 깔면 예전 파일의 소유권이 사라지므로 이게 있어야 서재가 비지 않는다.
export async function ensureAudioPermission() {
  if (Platform.OS !== 'android' || Platform.Version < 33) return true;

  const permission = PermissionsAndroid.PERMISSIONS.READ_MEDIA_AUDIO;
  if (!permission) return true;

  const granted = await PermissionsAndroid.check(permission);
  if (granted) return true;

  const result = await PermissionsAndroid.request(permission);
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

export async function loadStats() {
  try {
    const raw = await AsyncStorage.getItem(STATS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

async function writeStats(stats) {
  try {
    await AsyncStorage.setItem(STATS_KEY, JSON.stringify(stats));
  } catch {
    // 통계는 없어도 재생에는 지장이 없다.
  }
}

export async function bumpPlayCount(id) {
  const stats = await loadStats();
  const entry = stats[id] || {};
  stats[id] = { ...entry, plays: (entry.plays || 0) + 1, lastPlayedAt: Date.now() };
  await writeStats(stats);
  return stats;
}

export async function savePosition(id, seconds) {
  const stats = await loadStats();
  const entry = stats[id] || {};
  stats[id] = { ...entry, position: seconds };
  await writeStats(stats);
}

export async function clearPosition(id) {
  const stats = await loadStats();
  if (!stats[id]) return;
  stats[id] = { ...stats[id], position: 0 };
  await writeStats(stats);
}

// 파일이 하나도 없는 과목도 목록에 남겨두기 위해 따로 저장한다.
export async function loadFolders() {
  try {
    const raw = await AsyncStorage.getItem(FOLDERS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function addFolder(name) {
  const clean = (name || '').trim();
  if (!clean) return loadFolders();

  const folders = await loadFolders();
  if (folders.includes(clean)) return folders;

  const next = [...folders, clean];
  await AsyncStorage.setItem(FOLDERS_KEY, JSON.stringify(next));
  return next;
}

export async function removeFolder(name) {
  const folders = await loadFolders();
  const next = folders.filter((f) => f !== name);
  await AsyncStorage.setItem(FOLDERS_KEY, JSON.stringify(next));
  return next;
}

export async function loadLibrary() {
  if (!TtsFile) return { items: [], folders: [] };

  const [items, stats, saved] = await Promise.all([
    TtsFile.listLibrary(),
    loadStats(),
    loadFolders(),
  ]);

  const merged = items.map((item) => ({
    ...item,
    folder: item.folder || UNSORTED,
    plays: stats[item.id]?.plays || 0,
    position: stats[item.id]?.position || 0,
  }));

  const fromFiles = merged.map((i) => i.folder);
  const folders = Array.from(new Set([...saved, ...fromFiles])).sort((a, b) =>
    a.localeCompare(b, 'ko')
  );

  return { items: merged, folders };
}

export function formatDuration(ms) {
  if (!ms || ms < 0) return '--:--';

  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;

  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    return `${hours}:${String(minutes % 60).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function formatSize(bytes) {
  if (!bytes) return '';
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)}MB` : `${Math.round(bytes / 1024)}KB`;
}

export function displayName(name) {
  return (name || '').replace(/\.(m4a|wav)$/i, '');
}
