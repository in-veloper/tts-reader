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
import { segmentText } from './chunk';
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

// 줄바꿈·문단 사이에 두는 쉬는 시간. 저장 파일 쪽(TtsFileModule.kt)의 무음
// 길이와 같은 느낌으로 맞춰 뒀다 — 실시간 읽기는 setTimeout, 파일은 실제 무음.
const GAP_MS = { clause: 120, sentence: 220, line: 350, para: 900, none: 0 };

export default function CreateScreen({ onToast, onBusy, folders, onSaved }) {
  const [text, setText] = useState('');
  const [status, setStatus] = useState('idle'); // idle | playing | paused
  const [progress, setProgress] = useState({ index: 0, total: 0 });

  const [engines, setEngines] = useState([]);
  const [engine, setEngine] = useState(null); // null = 시스템 기본 엔진
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

  // 읽기는 네이티브 speak 이벤트로 한 구간씩 이어붙인다.
  // utterance id 를 여기서 만들어 넘기고, 돌아온 이벤트의 id 가 지금 기다리는
  // 것과 같을 때만 다음 구간으로 넘어간다 — 정지 직후 뒤늦게 오는 이벤트를 걸러낸다.
  const speakIdRef = useRef(null);
  const speakSeqRef = useRef(0);
  const onDoneRef = useRef(null);
  const onErrorRef = useRef(null);

  // 줄바꿈·문단 사이는 구간을 다 읽은 뒤 잠깐 쉬었다 다음으로 넘어간다.
  // 정지·일시정지를 누르면 이 대기도 같이 끊어야 한다.
  const pauseTimerRef = useRef(null);
  const clearPauseTimer = useCallback(() => {
    if (pauseTimerRef.current) {
      clearTimeout(pauseTimerRef.current);
      pauseTimerRef.current = null;
    }
  }, []);

  const chunkCount = useMemo(() => segmentText(text).length, [text]);

  // 같은 한국어라도 네트워크 음성(구글 신경망)이 오프라인 음성보다 확실히 자연스럽다.
  // 목록에 뒤섞여 "음성 3, 음성 7" 로만 뜨면 어느 게 좋은 건지 알 수가 없어서,
  // 좋은 것부터 올리고 무엇인지 이름에 적어 준다.
  const rankedVoices = useMemo(() => {
    const score = (v) =>
      (v.networkRequired ? 2 : 0) + (v.quality === 'Enhanced' ? 1 : 0);

    const seen = { 고품질: 0, 오프라인: 0 };

    return [...voices]
      .sort((a, b) => score(b) - score(a))
      .map((v) => {
        const kind = v.networkRequired ? '고품질' : '오프라인';
        seen[kind] += 1;
        return {
          ...v,
          title: `${kind} 음성 ${seen[kind]}`,
          note: v.networkRequired
            ? '더 자연스러움 · 인터넷 필요'
            : '인터넷 없이 동작',
        };
      });
  }, [voices]);

  // 음성 목록은 네이티브 모듈에서 직접 읽는다.
  // expo-speech 는 엔진 초기화가 한 번 실패하면 내부 상태가 FAILED 로 굳어버려서,
  // 앱을 완전히 껐다 켜기 전까지 새로고침을 눌러도 계속 빈 목록만 돌려준다.
  // 네이티브 쪽은 실패하면 엔진을 버리고 새로 만들기 때문에 그 자리에서 복구된다.
  const loadVoices = useCallback(async (enginePkg) => {
    setLoadingVoices(true);
    try {
      const all = TtsFile
        ? await TtsFile.listVoices(enginePkg ?? null)
        : await Speech.getAvailableVoicesAsync();

      const korean = all.filter((v) =>
        (v.language || '').toLowerCase().startsWith('ko')
      );

      setVoices(korean);

      // 저장해 둔 음성이 더 이상 폰에 없으면 기본 음성으로 되돌린다.
      // 없는 음성을 지정한 채로 읽으면 아무 소리도 안 나고 조용히 끝난다.
      // 엔진을 바꾼 직후에도 이 경로로 걸러진다 — 엔진마다 음성 이름이 다르다.
      setVoice((prev) =>
        prev && !korean.some((v) => v.identifier === prev) ? null : prev
      );
    } catch {
      setVoices([]);
    } finally {
      setLoadingVoices(false);
    }
  }, []);

  // 폰에 깔린 TTS 엔진 목록. 삼성 TTS 와 Google TTS 는 목소리가 완전히 달라서
  // 어느 엔진을 쓰느냐가 음성 선택보다 품질에 더 크게 영향을 준다.
  const loadEngines = useCallback(async () => {
    if (!TtsFile) return;
    try {
      setEngines(await TtsFile.listEngines());
    } catch {
      setEngines([]);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        let startEngine = null;
        if (raw) {
          const saved = JSON.parse(raw);
          if (saved.engine) {
            startEngine = saved.engine;
            setEngine(saved.engine);
          }
          if (saved.voice) setVoice(saved.voice);
          if (typeof saved.rate === 'number') setRate(saved.rate);
          if (typeof saved.pitch === 'number') setPitch(saved.pitch);
          if (typeof saved.text === 'string') setText(saved.text);
        }
        setReady(true);

        // 시스템 TTS 서비스가 붙기 전에 expo-speech 가 먼저 엔진을 건드리면
        // 그대로 FAILED 로 굳어서 읽기까지 막힌다.
        // 복구 가능한 네이티브 엔진으로 먼저 깨워 둔 다음 목록을 읽는다.
        if (TtsFile) {
          try {
            await TtsFile.prepareEngine(startEngine);
          } catch {
            // 준비에 실패해도 목록 읽기 쪽에서 다시 시도한다.
          }
        }

        loadEngines();
        loadVoices(startEngine);
      } catch {
        // 저장값이 깨졌으면 기본값으로 시작한다.
        setReady(true);
        loadEngines();
        loadVoices(null);
      }
    })();

    return () => {
      clearPauseTimer();
      Speech.stop();
      TtsFile?.stopSpeaking().catch(() => {});
    };
  }, [loadVoices, loadEngines, clearPauseTimer]);

  useEffect(() => {
    if (!ready) return;
    AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ engine, voice, rate, pitch, text })
    ).catch(() => {});
  }, [ready, engine, voice, rate, pitch, text]);

  useEffect(() => {
    if (!TtsFile) return undefined;
    const sub = TtsFile.addListener('onProgress', (e) =>
      setSaving({ index: e.index, total: e.total })
    );
    return () => sub.remove();
  }, []);

  // 읽기 이벤트는 한 번만 붙여 두고, 실제로 할 일은 ref 로 갈아끼운다.
  // 구간마다 구독을 새로 걸면 이벤트가 붙는 사이에 도착한 걸 놓친다.
  useEffect(() => {
    if (!TtsFile) return undefined;
    const done = TtsFile.addListener('onSpeakDone', (e) => {
      if (e?.id && e.id === speakIdRef.current) onDoneRef.current?.();
    });
    const failed = TtsFile.addListener('onSpeakError', (e) => {
      if (e?.id && e.id === speakIdRef.current) onErrorRef.current?.();
    });
    return () => {
      done.remove();
      failed.remove();
    };
  }, []);

  // 진행 상황은 화면 가운데 오버레이에서 보여준다.
  useEffect(() => {
    if (!saving) return;
    onBusy({ text: '오디오로 만드는 중', progress: saving });
  }, [saving, onBusy]);

  // 예전엔 expo-speech 로 읽었는데, 그건 시스템 기본 엔진만 쓴다.
  // 그래서 삼성 음성을 골라 놔도 Google 목소리가 나왔다. 네이티브로 돌려서
  // 고른 엔진 그대로 읽고, 파일로 굽는 결과와 들리는 소리를 일치시킨다.
  const speakChunk = useCallback(
    async (text_) => {
      if (!TtsFile) throw new Error('이 빌드에서는 읽기를 쓸 수 없습니다.');
      const id = `s${++speakSeqRef.current}`;
      speakIdRef.current = id;
      await TtsFile.speak(text_, id, engine, voice, rate, pitch);
    },
    [engine, voice, rate, pitch]
  );

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

      const fail = (message) => {
        if (session !== sessionRef.current) return;
        clearPauseTimer();
        speakIdRef.current = null;
        setStatus('idle');
        setProgress({ index: 0, total: 0 });
        onToast({
          type: 'error',
          message:
            message ||
            '읽지 못했습니다. 다른 음성을 고르거나, 앱을 완전히 종료한 뒤 다시 열어보세요.',
        });
      };

      const step = (i) => {
        if (session !== sessionRef.current) return;

        if (i >= chunks.length) {
          speakIdRef.current = null;
          indexRef.current = 0;
          setProgress({ index: 0, total: 0 });
          setStatus('idle');
          return;
        }

        indexRef.current = i;
        setProgress({ index: i, total: chunks.length });

        // 줄바꿈·문단으로 나뉜 구간 사이엔 실제로 쉬었다 다음 구간으로 넘어간다.
        // 안 그러면 서로 다른 조문·문단이 공백 하나로 붙어 그대로 쭉 읽힌다.
        onDoneRef.current = () => {
          const wait = GAP_MS[chunks[i].gap] || 0;
          if (wait > 0) {
            pauseTimerRef.current = setTimeout(() => step(i + 1), wait);
          } else {
            step(i + 1);
          }
        };
        onErrorRef.current = () => fail(null);

        speakChunk(chunks[i].text).catch((e) =>
          fail(e?.message ? `읽기 실패 · ${e.message}` : null)
        );
      };

      setStatus('playing');
      step(startIndex);
    },
    [speakChunk, onToast]
  );

  const handleStop = useCallback(() => {
    sessionRef.current += 1;
    clearPauseTimer();
    speakIdRef.current = null;
    TtsFile?.stopSpeaking().catch(() => {});
    Speech.stop();
    indexRef.current = 0;
    setProgress({ index: 0, total: 0 });
    setStatus('idle');
  }, [clearPauseTimer]);

  // 안드로이드 TTS 는 진짜 일시정지가 없어서, 멈춘 뒤 현재 구간부터 다시 읽는다.
  const handleTogglePlay = useCallback(() => {
    if (status === 'playing') {
      sessionRef.current += 1;
      clearPauseTimer();
      speakIdRef.current = null;
      TtsFile?.stopSpeaking().catch(() => {});
      Speech.stop();
      setStatus('paused');
      return;
    }

    if (status === 'paused' && chunksRef.current.length) {
      speakFrom(indexRef.current);
      return;
    }

    const chunks = segmentText(text);
    if (!chunks.length) return;

    chunksRef.current = chunks;
    indexRef.current = 0;
    speakFrom(0);
  }, [status, text, speakFrom, clearPauseTimer]);

  const previewVoice = useCallback(
    (identifier, enginePkg = engine) => {
      sessionRef.current += 1;
      setStatus('idle');
      setProgress({ index: 0, total: 0 });

      // 미리듣기는 이어읽기가 없으니 이벤트로 할 일이 없다.
      onDoneRef.current = null;
      onErrorRef.current = null;

      if (!TtsFile) {
        Speech.speak(PREVIEW_TEXT, {
          language: 'ko-KR',
          voice: identifier || undefined,
          rate,
          pitch,
        });
        return;
      }

      const id = `p${++speakSeqRef.current}`;
      speakIdRef.current = id;
      TtsFile.speak(PREVIEW_TEXT, id, enginePkg, identifier, rate, pitch).catch((e) =>
        onToast({ type: 'error', message: e?.message || '미리듣기에 실패했습니다.' })
      );
    },
    [engine, rate, pitch, onToast]
  );

  // 엔진을 바꾸면 목소리 목록 자체가 갈린다. 읽던 걸 멈추고 새로 읽어온다.
  const selectEngine = useCallback(
    (pkg) => {
      handleStop();
      setEngine(pkg);
      setVoice(null);
      loadVoices(pkg);
    },
    [handleStop, loadVoices]
  );

  const runSave = useCallback(
    async (folder) => {
      setFolderSheetOpen(false);

      const segments = segmentText(text);
      if (!segments.length) return;

      if (!TtsFile) {
        onToast({ type: 'error', message: '이 빌드에서는 저장 기능을 쓸 수 없습니다.' });
        return;
      }

      handleStop();
      setSaving({ index: 0, total: segments.length });
      onBusy({ text: '오디오로 만드는 중', progress: { index: 0, total: segments.length } });

      try {
        if (folder && folder !== UNSORTED) await addFolder(folder);

        const result = await TtsFile.saveToFile(
          segments,
          engine,
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
    [text, engine, voice, rate, pitch, handleStop, onToast, onBusy, onSaved]
  );

  const playing = status === 'playing';
  const busy = Boolean(saving);
  const voiceName =
    rankedVoices.find((v) => v.identifier === voice)?.title || '기본 음성';
  const engineLabel =
    engines.find((e) => e.packageName === engine)?.label ||
    (engine ? engine : '기본 엔진');

  return (
    <View style={styles.root}>
      <View style={styles.toolbar}>
        <Text style={styles.toolbarText} numberOfLines={1}>
          {engineLabel} · {voiceName} · 속도 {rate.toFixed(2)}x
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
          {engines.length > 1 && (
            <>
              <Label>엔진</Label>
              <Text style={styles.hint}>
                엔진마다 목소리가 완전히 다릅니다. 음성보다 이쪽이 더 크게 바뀝니다.
              </Text>
              <View style={styles.voiceList}>
                {engines.map((e) => (
                  <VoiceRow
                    key={e.packageName}
                    name={e.label}
                    sub={e.isSystemDefault ? '폰 기본 엔진' : e.packageName}
                    active={engine === e.packageName}
                    onSelect={() => selectEngine(e.packageName)}
                    onPreview={() => previewVoice(null, e.packageName)}
                  />
                ))}
              </View>
            </>
          )}

          <Label style={engines.length > 1 ? styles.sectionLabel : undefined}>
            음성
          </Label>
          <View style={styles.voiceList}>
            {loadingVoices ? (
              <ActivityIndicator style={styles.loader} color={colors.accentSoft} />
            ) : voices.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyText}>
                  폰에 설치된 한국어 음성을 찾지 못했습니다. 설정 › 접근성 › 텍스트
                  음성 변환에서 한국어 음성을 내려받은 뒤 새로고침하세요.
                </Text>
                <Pressable onPress={() => loadVoices(engine)} style={styles.reload}>
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
                {rankedVoices.map((v) => (
                  <VoiceRow
                    key={v.identifier}
                    name={v.title}
                    sub={v.note}
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
  hint: { color: colors.textFaint, fontSize: 12, lineHeight: 18, marginTop: 6 },
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
