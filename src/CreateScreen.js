import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Speech from 'expo-speech';

import TtsFile from '../modules/tts-file';
import { chunkText } from './chunk';
import { UNSORTED, addFolder } from './library';
import { player } from './playback';
import { colors, radius } from './theme';
import {
  Card,
  CircleButton,
  GhostButton,
  Label,
  PrimaryButton,
  ProgressBar,
  Sheet,
} from './ui';

const STORAGE_KEY = 'stepby/settings';
const PREVIEW_TEXT = '안녕하세요. 이 목소리로 읽어 드릴게요.';

export default function CreateScreen({ onToast, onBusy, folders, onSaved }) {
  const [text, setText] = useState('');
  const [status, setStatus] = useState('idle'); // idle | playing | paused
  const [progress, setProgress] = useState({ index: 0, total: 0 });

  const [voices, setVoices] = useState([]);
  const [voice, setVoice] = useState(null);
  const [rate, setRate] = useState(1);
  const [pitch, setPitch] = useState(1);

  const [loadingVoices, setLoadingVoices] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [folderSheetOpen, setFolderSheetOpen] = useState(false);
  const [newFolder, setNewFolder] = useState('');
  const [saving, setSaving] = useState(null);
  const [ready, setReady] = useState(false);

  const sessionRef = useRef(0);
  const chunksRef = useRef([]);
  const indexRef = useRef(0);

  const chunkCount = useMemo(() => chunkText(text).length, [text]);

  // 음성 목록은 네이티브 모듈에서 직접 읽는다.
  // expo-speech 는 엔진 초기화가 한 번 실패하면 내부 상태가 FAILED 로 굳어버려서,
  // 앱을 완전히 껐다 켜기 전까지 새로고침을 눌러도 계속 빈 목록만 돌려준다.
  // 네이티브 쪽은 실패하면 엔진을 버리고 새로 만들기 때문에 그 자리에서 복구된다.
  const loadVoices = useCallback(async () => {
    setLoadingVoices(true);
    try {
      const all = TtsFile
        ? await TtsFile.listVoices()
        : await Speech.getAvailableVoicesAsync();

      const korean = all.filter((v) =>
        (v.language || '').toLowerCase().startsWith('ko')
      );

      setVoices(korean);

      // 저장해 둔 음성이 더 이상 폰에 없으면 기본 음성으로 되돌린다.
      // 없는 음성을 지정한 채로 읽으면 아무 소리도 안 나고 조용히 끝난다.
      setVoice((prev) =>
        prev && !korean.some((v) => v.identifier === prev) ? null : prev
      );
    } catch {
      setVoices([]);
    } finally {
      setLoadingVoices(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          const saved = JSON.parse(raw);
          if (saved.voice) setVoice(saved.voice);
          if (typeof saved.rate === 'number') setRate(saved.rate);
          if (typeof saved.pitch === 'number') setPitch(saved.pitch);
          if (typeof saved.text === 'string') setText(saved.text);
        }
      } catch {
        // 저장값이 깨졌으면 기본값으로 시작한다.
      }
      setReady(true);

      // 시스템 TTS 서비스가 붙기 전에 expo-speech 가 먼저 엔진을 건드리면
      // 그대로 FAILED 로 굳어서 읽기까지 막힌다.
      // 복구 가능한 네이티브 엔진으로 먼저 깨워 둔 다음 목록을 읽는다.
      if (TtsFile) {
        try {
          await TtsFile.prepareEngine();
        } catch {
          // 준비에 실패해도 목록 읽기 쪽에서 다시 시도한다.
        }
      }

      loadVoices();
    })();

    return () => Speech.stop();
  }, [loadVoices]);

  useEffect(() => {
    if (!ready) return;
    AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ voice, rate, pitch, text })
    ).catch(() => {});
  }, [ready, voice, rate, pitch, text]);

  useEffect(() => {
    if (!TtsFile) return undefined;
    const sub = TtsFile.addListener('onProgress', (e) =>
      setSaving({ index: e.index, total: e.total })
    );
    return () => sub.remove();
  }, []);

  // 진행 상황은 화면 가운데 오버레이에서 보여준다.
  useEffect(() => {
    if (!saving) return;
    onBusy({ text: '오디오로 만드는 중', progress: saving });
  }, [saving, onBusy]);

  const speakFrom = useCallback(
    (startIndex) => {
      const session = sessionRef.current + 1;
      sessionRef.current = session;
      const chunks = chunksRef.current;

      // 서재에서 재생 중이면 오디오 초점을 쥐고 있어 TTS 가 묻힌다.
      try {
        player.pause();
      } catch {
        // 재생 중이 아니면 무시.
      }

      const step = (i) => {
        if (session !== sessionRef.current) return;

        if (i >= chunks.length) {
          indexRef.current = 0;
          setProgress({ index: 0, total: 0 });
          setStatus('idle');
          return;
        }

        indexRef.current = i;
        setProgress({ index: i, total: chunks.length });

        Speech.speak(chunks[i], {
          language: 'ko-KR',
          voice: voice || undefined,
          rate,
          pitch,
          onDone: () => step(i + 1),
          onError: (e) => {
            if (session !== sessionRef.current) return;
            setStatus('idle');
            setProgress({ index: 0, total: 0 });
            onToast({
              type: 'error',
              message: e?.message
                ? `읽기 실패 · ${e.message}`
                : '읽지 못했습니다. 다른 음성을 고르거나, 앱을 완전히 종료한 뒤 다시 열어보세요.',
            });
          },
        });
      };

      setStatus('playing');
      step(startIndex);
    },
    [voice, rate, pitch, onToast]
  );

  const handleStop = useCallback(() => {
    sessionRef.current += 1;
    Speech.stop();
    indexRef.current = 0;
    setProgress({ index: 0, total: 0 });
    setStatus('idle');
  }, []);

  // 안드로이드 TTS 는 진짜 일시정지가 없어서, 멈춘 뒤 현재 구간부터 다시 읽는다.
  const handleTogglePlay = useCallback(() => {
    if (status === 'playing') {
      sessionRef.current += 1;
      Speech.stop();
      setStatus('paused');
      return;
    }

    if (status === 'paused' && chunksRef.current.length) {
      speakFrom(indexRef.current);
      return;
    }

    const chunks = chunkText(text);
    if (!chunks.length) return;

    chunksRef.current = chunks;
    indexRef.current = 0;
    speakFrom(0);
  }, [status, text, speakFrom]);

  const previewVoice = useCallback(
    (identifier) => {
      sessionRef.current += 1;
      Speech.stop();
      setStatus('idle');
      Speech.speak(PREVIEW_TEXT, {
        language: 'ko-KR',
        voice: identifier || undefined,
        rate,
        pitch,
      });
    },
    [rate, pitch]
  );

  const runSave = useCallback(
    async (folder) => {
      setFolderSheetOpen(false);

      const chunks = chunkText(text);
      if (!chunks.length) return;

      if (!TtsFile) {
        onToast({ type: 'error', message: '이 빌드에서는 저장 기능을 쓸 수 없습니다.' });
        return;
      }

      handleStop();
      setSaving({ index: 0, total: chunks.length });
      onBusy({ text: '오디오로 만드는 중', progress: { index: 0, total: chunks.length } });

      try {
        if (folder && folder !== UNSORTED) await addFolder(folder);

        const result = await TtsFile.saveToFile(
          chunks,
          voice,
          rate,
          pitch,
          makeFileName(text),
          folder === UNSORTED ? null : folder
        );

        onToast({ type: 'ok', message: `저장 완료 · ${result.path}` });
        onSaved?.();
      } catch (e) {
        onToast({ type: 'error', message: e?.message || '저장에 실패했습니다.' });
      } finally {
        setSaving(null);
        onBusy(null);
      }
    },
    [text, voice, rate, pitch, handleStop, onToast, onBusy, onSaved]
  );

  const playing = status === 'playing';
  const busy = Boolean(saving);
  const voiceIndex = voices.findIndex((v) => v.identifier === voice);
  const voiceName = voiceIndex < 0 ? '기본 음성' : `음성 ${voiceIndex + 1}`;

  return (
    <View style={styles.root}>
      <View style={styles.toolbar}>
        <Text style={styles.toolbarText} numberOfLines={1}>
          {voiceName} · 속도 {rate.toFixed(2)}x
        </Text>
        <Pressable
          onPress={() => setSettingsOpen(true)}
          style={({ pressed }) => [styles.settingsButton, pressed && { opacity: 0.8 }]}
        >
          <Ionicons name="options-outline" size={16} color={colors.accentSoft} />
          <Text style={styles.settingsText}>음성 설정</Text>
        </Pressable>
      </View>

      <Card style={styles.editor}>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder="읽을 텍스트를 붙여넣으세요."
          placeholderTextColor={colors.textFaint}
          multiline
          textAlignVertical="top"
          selectionColor={colors.accentSoft}
        />
        <View style={styles.editorFoot}>
          <Text style={styles.meta}>
            {text.length.toLocaleString()}자
            {chunkCount > 1 ? ` · ${chunkCount}구간` : ''}
          </Text>
          {text.length > 0 && (
            <Pressable onPress={() => setText('')} hitSlop={8}>
              <Text style={styles.clear}>지우기</Text>
            </Pressable>
          )}
        </View>
      </Card>

      {progress.total > 0 && (
        <View style={styles.progressBlock}>
          <ProgressBar value={(progress.index + 1) / progress.total} />
          <View style={styles.progressFoot}>
            <Text style={styles.meta}>
              {status === 'paused' ? '일시정지' : '읽는 중'}
            </Text>
            <Text style={styles.meta}>
              {progress.index + 1} / {progress.total}
            </Text>
          </View>
        </View>
      )}

      <View style={styles.controls}>
        <PrimaryButton
          icon={playing ? 'pause' : 'play'}
          text={playing ? '일시정지' : status === 'paused' ? '이어읽기' : '읽기'}
          onPress={handleTogglePlay}
          disabled={!text.trim() || busy}
        />
        <CircleButton icon="stop" onPress={handleStop} disabled={status === 'idle'} />
      </View>

      <GhostButton
        icon="download-outline"
        text="오디오 파일로 저장"
        onPress={() => setFolderSheetOpen(true)}
        disabled={!text.trim() || busy}
        busy={busy}
      />

      <Sheet
        visible={folderSheetOpen}
        title="어느 과목에 저장할까요?"
        onClose={() => setFolderSheetOpen(false)}
      >
        <ScrollView showsVerticalScrollIndicator={false}>
          <View style={styles.newFolderRow}>
            <TextInput
              style={styles.newFolderInput}
              value={newFolder}
              onChangeText={setNewFolder}
              placeholder="새 과목 이름 (예: 노동법)"
              placeholderTextColor={colors.textFaint}
            />
            <Pressable
              onPress={() => {
                const name = newFolder.trim();
                if (!name) return;
                setNewFolder('');
                runSave(name);
              }}
              style={styles.newFolderButton}
            >
              <Ionicons name="add" size={22} color={colors.accentSoft} />
            </Pressable>
          </View>

          <Label style={styles.sectionLabel}>기존 과목</Label>
          <View style={styles.folderList}>
            {[UNSORTED, ...folders.filter((f) => f !== UNSORTED)].map((folder) => (
              <Pressable
                key={folder}
                onPress={() => runSave(folder)}
                style={styles.folderRow}
              >
                <Ionicons
                  name={folder === UNSORTED ? 'file-tray-outline' : 'folder-outline'}
                  size={18}
                  color={colors.accentSoft}
                />
                <Text style={styles.folderName}>{folder}</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
              </Pressable>
            ))}
          </View>
        </ScrollView>
      </Sheet>

      <Sheet visible={settingsOpen} title="목소리" onClose={() => setSettingsOpen(false)}>
        <ScrollView showsVerticalScrollIndicator={false}>
          <Label>음성</Label>
          <View style={styles.voiceList}>
            {loadingVoices ? (
              <ActivityIndicator style={styles.loader} color={colors.accentSoft} />
            ) : voices.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyText}>
                  폰에 설치된 한국어 음성을 찾지 못했습니다. 설정 › 접근성 › 텍스트
                  음성 변환에서 한국어 음성을 내려받은 뒤 새로고침하세요.
                </Text>
                <Pressable onPress={loadVoices} style={styles.reload}>
                  <Text style={styles.reloadText}>새로고침</Text>
                </Pressable>
              </View>
            ) : (
              <>
                <VoiceRow
                  name="기본 음성"
                  sub="시스템 설정을 따름"
                  active={!voice}
                  onSelect={() => setVoice(null)}
                  onPreview={() => previewVoice(null)}
                />
                {voices.map((v, i) => (
                  <VoiceRow
                    key={v.identifier}
                    name={`음성 ${i + 1}`}
                    sub={v.identifier}
                    active={voice === v.identifier}
                    onSelect={() => setVoice(v.identifier)}
                    onPreview={() => previewVoice(v.identifier)}
                  />
                ))}
              </>
            )}
          </View>

          <Label style={styles.sectionLabel}>읽기</Label>
          <SliderRow label="속도" value={rate} onChange={setRate} />
          <SliderRow label="음높이" value={pitch} onChange={setPitch} />
        </ScrollView>
      </Sheet>
    </View>
  );
}

function VoiceRow({ name, sub, active, onSelect, onPreview }) {
  return (
    <Pressable
      onPress={onSelect}
      style={[styles.voiceRow, active && styles.voiceRowActive]}
    >
      <Ionicons
        name={active ? 'radio-button-on' : 'radio-button-off'}
        size={18}
        color={active ? colors.accentSoft : colors.textFaint}
      />
      <View style={styles.grow}>
        <Text style={styles.voiceName}>{name}</Text>
        <Text style={styles.voiceSub} numberOfLines={1}>
          {sub}
        </Text>
      </View>
      <Pressable onPress={onPreview} hitSlop={10} style={styles.preview}>
        <Ionicons name="play" size={14} color={colors.accentSoft} />
        <Text style={styles.previewText}>듣기</Text>
      </Pressable>
    </Pressable>
  );
}

function SliderRow({ label, value, onChange }) {
  return (
    <View style={styles.sliderRow}>
      <View style={styles.sliderHead}>
        <Text style={styles.sliderLabel}>{label}</Text>
        <View style={styles.pill}>
          <Text style={styles.pillText}>{value.toFixed(2)}x</Text>
        </View>
      </View>
      <Slider
        value={value}
        onValueChange={onChange}
        minimumValue={0.5}
        maximumValue={2}
        step={0.05}
        minimumTrackTintColor={colors.accent}
        maximumTrackTintColor={colors.surfaceHigh}
        thumbTintColor={colors.accentSoft}
      />
    </View>
  );
}

function makeFileName(text) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `_${pad(now.getHours())}${pad(now.getMinutes())}`;

  const head = text
    .trim()
    .slice(0, 14)
    .replace(/[\\/:*?"<>|.\s]+/g, ' ')
    .trim();

  return head ? `${stamp} ${head}` : stamp;
}

const styles = StyleSheet.create({
  root: { flex: 1, gap: 14 },
  grow: { flex: 1 },

  editor: { flex: 1, paddingBottom: 12 },
  input: { flex: 1, color: colors.text, fontSize: 16, lineHeight: 25, padding: 0 },
  editorFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  toolbarText: { flex: 1, color: colors.textFaint, fontSize: 12 },
  settingsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceHigh,
    borderWidth: 1,
    borderColor: colors.border,
  },
  settingsText: { color: colors.accentSoft, fontSize: 12, fontWeight: '700' },
  meta: { color: colors.textFaint, fontSize: 12 },
  clear: { color: colors.textDim, fontSize: 12, fontWeight: '600' },

  progressBlock: { gap: 8 },
  progressFoot: { flexDirection: 'row', justifyContent: 'space-between' },

  controls: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  saveBlock: { gap: 10 },

  newFolderRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  newFolderInput: {
    flex: 1,
    backgroundColor: colors.surfaceHigh,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 13,
    color: colors.text,
    fontSize: 15,
  },
  newFolderButton: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceHigh,
    borderWidth: 1,
    borderColor: colors.border,
  },

  sectionLabel: { marginTop: 24 },
  folderList: { marginTop: 10, gap: 8 },
  folderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 15,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceHigh,
  },
  folderName: { flex: 1, color: colors.text, fontSize: 15, fontWeight: '600' },

  voiceList: { marginTop: 10, gap: 8 },
  loader: { paddingVertical: 24 },
  empty: { gap: 14, paddingVertical: 8 },
  emptyText: { color: colors.textDim, fontSize: 13, lineHeight: 20 },
  reload: {
    paddingVertical: 12,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceHigh,
    alignItems: 'center',
  },
  reloadText: { color: colors.accentSoft, fontSize: 14, fontWeight: '600' },

  voiceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 13,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceHigh,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  voiceRowActive: { borderColor: colors.accent },
  voiceName: { color: colors.text, fontSize: 15, fontWeight: '600' },
  voiceSub: { color: colors.textFaint, fontSize: 11, marginTop: 2 },
  preview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.bg,
  },
  previewText: { color: colors.accentSoft, fontSize: 12, fontWeight: '600' },

  sliderRow: { marginTop: 12 },
  sliderHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sliderLabel: { color: colors.textDim, fontSize: 14, fontWeight: '600' },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceHigh,
  },
  pillText: { color: colors.textDim, fontSize: 12, fontWeight: '600' },
});
