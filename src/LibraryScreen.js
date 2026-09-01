import { useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import TtsFile from '../modules/tts-file';
import {
  ALL,
  UNSORTED,
  displayName,
  formatDuration,
  formatSize,
  removeFolder,
} from './library';
import { colors, radius } from './theme';
import { Chip, Label, Sheet } from './ui';

export default function LibraryScreen({
  items,
  folders,
  loading,
  activeId,
  onRefresh,
  onToast,
  onPlay,
}) {
  const [folder, setFolder] = useState(ALL);
  const [menuItem, setMenuItem] = useState(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [newName, setNewName] = useState('');

  const userFolders = useMemo(
    () => folders.filter((f) => f !== UNSORTED),
    [folders]
  );

  // 과목을 지워도 오디오는 남긴다. 안에 있던 파일은 미분류로 옮긴다.
  const deleteFolder = (name) => {
    const inside = items.filter((i) => i.folder === name);

    const run = async () => {
      try {
        for (const item of inside) {
          await TtsFile.moveItem(item.uri, null);
        }
        await removeFolder(name);
        if (folder === name) setFolder(ALL);

        onToast({
          type: 'ok',
          message: inside.length
            ? `${name} 삭제 · 파일 ${inside.length}개는 미분류로 옮겼습니다`
            : `${name} 과목을 삭제했습니다`,
        });
        onRefresh();
      } catch (e) {
        onToast({ type: 'error', message: e?.message || '삭제에 실패했습니다.' });
      }
    };

    Alert.alert(
      `'${name}' 과목 삭제`,
      inside.length
        ? `이 과목의 파일 ${inside.length}개는 미분류로 옮겨집니다. 오디오는 지워지지 않습니다.`
        : '빈 과목을 삭제합니다.',
      [
        { text: '취소', style: 'cancel' },
        { text: '삭제', style: 'destructive', onPress: run },
      ]
    );
  };

  const visible = useMemo(
    () => (folder === ALL ? items : items.filter((i) => i.folder === folder)),
    [items, folder]
  );

  const tabs = useMemo(() => [ALL, ...folders], [folders]);

  const runAction = async (action, done) => {
    try {
      await action();
      onToast({ type: 'ok', message: done });
      onRefresh();
    } catch (e) {
      onToast({ type: 'error', message: e?.message || '실패했습니다.' });
    } finally {
      setMenuItem(null);
      setMoveOpen(false);
      setRenameOpen(false);
    }
  };

  return (
    <View style={styles.root}>
      <View style={styles.chipBar}>
        <FlatList
          data={tabs}
          horizontal
          keyExtractor={(f) => f}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
          renderItem={({ item }) => (
            <Chip text={item} active={folder === item} onPress={() => setFolder(item)} />
          )}
          style={styles.chipList}
        />
        <Pressable
          onPress={() => setManageOpen(true)}
          hitSlop={8}
          style={styles.manageButton}
        >
          <Ionicons name="options-outline" size={17} color={colors.textDim} />
        </Pressable>
      </View>

      <FlatList
        data={visible}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={onRefresh}
            tintColor={colors.accentSoft}
            colors={[colors.accent]}
          />
        }
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={
          loading ? null : (
            <View style={styles.empty}>
              <Ionicons name="albums-outline" size={40} color={colors.textFaint} />
              <Text style={styles.emptyTitle}>저장된 오디오가 없습니다</Text>
              <Text style={styles.emptyBody}>
                만들기 탭에서 텍스트를 오디오로 저장하면{'\n'}여기에 과목별로 쌓입니다.
              </Text>
            </View>
          )
        }
        renderItem={({ item, index }) => (
          <Row
            item={item}
            active={activeId === item.id}
            onPress={() => onPlay(visible, index)}
            onMenu={() => {
              setMenuItem(item);
              setNewName(displayName(item.name));
            }}
          />
        )}
      />

      <Sheet
        visible={Boolean(menuItem) && !moveOpen && !renameOpen}
        title={menuItem ? displayName(menuItem.name) : ''}
        onClose={() => setMenuItem(null)}
      >
        <MenuRow
          icon="play"
          text="재생"
          onPress={() => {
            const index = visible.findIndex((i) => i.id === menuItem.id);
            setMenuItem(null);
            if (index >= 0) onPlay(visible, index);
          }}
        />
        <MenuRow icon="folder-outline" text="과목 옮기기" onPress={() => setMoveOpen(true)} />
        <MenuRow icon="create-outline" text="이름 바꾸기" onPress={() => setRenameOpen(true)} />
        <MenuRow
          icon="trash-outline"
          text="삭제"
          danger
          onPress={() =>
            runAction(() => TtsFile.deleteItem(menuItem.uri), '삭제했습니다')
          }
        />
      </Sheet>

      <Sheet visible={manageOpen} title="과목 관리" onClose={() => setManageOpen(false)}>
        {userFolders.length === 0 ? (
          <Text style={styles.manageEmpty}>
            아직 만든 과목이 없습니다. 저장할 때 새 과목을 만들 수 있습니다.
          </Text>
        ) : (
          userFolders.map((name) => (
            <View key={name} style={styles.manageRow}>
              <Ionicons name="folder-outline" size={18} color={colors.accentSoft} />
              <View style={styles.manageBody}>
                <Text style={styles.manageName}>{name}</Text>
                <Text style={styles.manageCount}>
                  {items.filter((i) => i.folder === name).length}개
                </Text>
              </View>
              <Pressable
                onPress={() => deleteFolder(name)}
                hitSlop={10}
                style={styles.manageDelete}
              >
                <Ionicons name="trash-outline" size={18} color={colors.danger} />
              </Pressable>
            </View>
          ))
        )}
        <Text style={styles.manageNote}>
          과목을 지워도 오디오 파일은 지워지지 않고 미분류로 옮겨집니다.
        </Text>
      </Sheet>

      <Sheet visible={moveOpen} title="과목 옮기기" onClose={() => setMoveOpen(false)}>
        {[UNSORTED, ...userFolders].map((name) => (
          <MenuRow
            key={name}
            icon={name === UNSORTED ? 'file-tray-outline' : 'folder-outline'}
            text={name}
            onPress={() =>
              runAction(
                () => TtsFile.moveItem(menuItem.uri, name === UNSORTED ? null : name),
                `${name}(으)로 옮겼습니다`
              )
            }
          />
        ))}
      </Sheet>

      <Sheet visible={renameOpen} title="이름 바꾸기" onClose={() => setRenameOpen(false)}>
        <TextInput
          style={styles.renameInput}
          value={newName}
          onChangeText={setNewName}
          placeholder="새 이름"
          placeholderTextColor={colors.textFaint}
          autoFocus
        />
        <Pressable
          style={styles.renameButton}
          onPress={() => {
            const clean = newName.trim();
            if (!clean) return;
            const extension = menuItem.name.match(/\.(m4a|wav)$/i)?.[0] || '.m4a';
            runAction(
              () => TtsFile.renameItem(menuItem.uri, `${clean}${extension}`),
              '이름을 바꿨습니다'
            );
          }}
        >
          <Text style={styles.renameButtonText}>저장</Text>
        </Pressable>
      </Sheet>
    </View>
  );
}

function Row({ item, active, onPress, onMenu }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        active && styles.rowActive,
        pressed && { opacity: 0.85 },
      ]}
    >
      <View style={[styles.rowIcon, active && styles.rowIconActive]}>
        <Ionicons
          name={active ? 'volume-high' : 'musical-note'}
          size={17}
          color={active ? colors.bg : colors.accentSoft}
        />
      </View>

      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={2}>
          {displayName(item.name)}
        </Text>
        <View style={styles.rowMeta}>
          <Text style={styles.metaText}>{item.folder}</Text>
          <Text style={styles.metaDot}>·</Text>
          <Text style={styles.metaText}>{formatDuration(item.durationMs)}</Text>
          <Text style={styles.metaDot}>·</Text>
          <Text style={styles.metaText}>{formatSize(item.bytes)}</Text>
          {item.position > 5 && (
            <>
              <Text style={styles.metaDot}>·</Text>
              <Text style={styles.resumeText}>이어듣기</Text>
            </>
          )}
        </View>
      </View>

      <View style={styles.rowRight}>
        <View style={styles.playCount}>
          <Ionicons name="headset-outline" size={11} color={colors.textDim} />
          <Text style={styles.playCountText}>{item.plays}</Text>
        </View>
        <Pressable onPress={onMenu} hitSlop={10} style={styles.menuButton}>
          <Ionicons name="ellipsis-horizontal" size={18} color={colors.textFaint} />
        </Pressable>
      </View>
    </Pressable>
  );
}

function MenuRow({ icon, text, onPress, danger }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.menuRow, pressed && { opacity: 0.8 }]}
    >
      <Ionicons
        name={icon}
        size={19}
        color={danger ? colors.danger : colors.accentSoft}
      />
      <Text style={[styles.menuText, danger && { color: colors.danger }]}>{text}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  chipBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  chipList: { flex: 1 },
  chipRow: { gap: 8, paddingRight: 8 },
  manageButton: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceHigh,
  },

  manageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceHigh,
    marginBottom: 8,
  },
  manageBody: { flex: 1 },
  manageName: { color: colors.text, fontSize: 15, fontWeight: '600' },
  manageCount: { color: colors.textFaint, fontSize: 12, marginTop: 2 },
  manageDelete: { padding: 4 },
  manageEmpty: {
    color: colors.textDim,
    fontSize: 13,
    lineHeight: 20,
    paddingVertical: 10,
  },
  manageNote: {
    color: colors.textFaint,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 16,
    textAlign: 'center',
  },

  list: { paddingBottom: 8 },
  separator: { height: 8 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowActive: { borderColor: colors.accent },
  rowIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceHigh,
  },
  rowIconActive: { backgroundColor: colors.accentSoft },
  rowBody: { flex: 1, gap: 4 },
  rowTitle: { color: colors.text, fontSize: 14, fontWeight: '600', lineHeight: 19 },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' },
  metaText: { color: colors.textFaint, fontSize: 11 },
  metaDot: { color: colors.textFaint, fontSize: 11 },
  resumeText: { color: colors.accentSoft, fontSize: 11, fontWeight: '600' },

  rowRight: { alignItems: 'center', gap: 6 },
  playCount: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceHigh,
  },
  playCountText: { color: colors.textDim, fontSize: 11, fontWeight: '700' },
  menuButton: { padding: 4 },

  empty: { alignItems: 'center', gap: 10, paddingTop: 70 },
  emptyTitle: { color: colors.text, fontSize: 16, fontWeight: '700', marginTop: 4 },
  emptyBody: {
    color: colors.textDim,
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
  },

  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 16,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceHigh,
    marginBottom: 8,
  },
  menuText: { color: colors.text, fontSize: 15, fontWeight: '600' },

  renameInput: {
    backgroundColor: colors.surfaceHigh,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 14,
    color: colors.text,
    fontSize: 15,
  },
  renameButton: {
    marginTop: 12,
    paddingVertical: 15,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
  },
  renameButtonText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
