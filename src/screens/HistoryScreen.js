import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, FlatList,
  Image, TouchableOpacity, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { getHistory, clearHistory } from '../services/history';
import { colors, spacing, radius, shadows, typography } from '../constants/theme';

const MODE_META = {
  partFinder:  { label: 'Part Finder',    icon: 'search-outline',    color: '#7C3AED', bg: '#EDE9FE' },
  setChecker:  { label: 'Set Checker',    icon: 'layers-outline',    color: colors.primary, bg: colors.errorLight },
  multiScan:   { label: 'Multi-Scan',     icon: 'scan-outline',      color: colors.secondary, bg: colors.warningLight },
  sequential:  { label: 'Sequential',     icon: 'camera-outline',    color: colors.success, bg: colors.successLight },
};

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(diff / 86400000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${d}d ago`;
}

export default function HistoryScreen({ navigation }) {
  const [entries, setEntries] = useState([]);

  useFocusEffect(useCallback(() => { getHistory().then(setEntries); }, []));

  function handleClear() {
    Alert.alert('Clear History', 'Delete all scan history?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: async () => { await clearHistory(); setEntries([]); } },
    ]);
  }

  function handleTap(entry) {
    if (!entry.imageUri && !entry.identifiedPart && !entry.identifiedParts?.length) return;

    if (entry.mode === 'multiScan' || entry.mode === 'sequential') {
      if (entry.identifiedParts?.length) {
        navigation.navigate('MultiResults', { identifiedParts: entry.identifiedParts });
      }
    } else {
      if (entry.imageUri) {
        navigation.navigate('Results', {
          imageUri: entry.imageUri,
          mode: entry.mode,
          setNum: entry.setNum,
          setName: entry.setName,
        });
      }
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <FlatList
        data={entries}
        keyExtractor={(item) => item.id}
        contentContainerStyle={entries.length === 0 ? styles.emptyContainer : styles.list}
        ListHeaderComponent={entries.length > 0 ? (
          <TouchableOpacity style={styles.clearBtn} onPress={handleClear}>
            <Ionicons name="trash-outline" size={14} color={colors.error} />
            <Text style={styles.clearBtnText}>Clear History</Text>
          </TouchableOpacity>
        ) : null}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <View style={styles.emptyIconWrap}>
              <Ionicons name="time-outline" size={36} color={colors.textTertiary} />
            </View>
            <Text style={styles.emptyTitle}>No scans yet</Text>
            <Text style={styles.emptyDesc}>Your last 20 scans will appear here.</Text>
          </View>
        }
        renderItem={({ item }) => {
          const meta = MODE_META[item.mode] || MODE_META.partFinder;
          const mainPart = item.identifiedPart || item.identifiedParts?.[0];
          const partCount = item.identifiedParts?.length || (item.identifiedPart ? 1 : 0);

          return (
            <TouchableOpacity style={styles.entry} onPress={() => handleTap(item)} activeOpacity={0.75}>
              {/* Part image or mode icon */}
              {mainPart?.img_url ? (
                <Image source={{ uri: mainPart.img_url }} style={styles.partImg} resizeMode="contain" />
              ) : (
                <View style={[styles.partImg, { backgroundColor: meta.bg, alignItems: 'center', justifyContent: 'center' }]}>
                  <Ionicons name={meta.icon} size={24} color={meta.color} />
                </View>
              )}

              <View style={styles.entryInfo}>
                <View style={styles.entryTopRow}>
                  <View style={[styles.modePill, { backgroundColor: meta.bg }]}>
                    <Text style={[styles.modePillText, { color: meta.color }]}>{meta.label}</Text>
                  </View>
                  <Text style={styles.timeText}>{timeAgo(item.timestamp)}</Text>
                </View>

                {mainPart && (
                  <Text style={styles.partName} numberOfLines={1}>
                    {mainPart.name || `#${mainPart.id}`}
                  </Text>
                )}
                {item.setName && (
                  <Text style={styles.setName} numberOfLines={1}>Set: {item.setName}</Text>
                )}

                <Text style={styles.resultSub}>
                  {partCount > 1 ? `${partCount} parts identified` : partCount === 1 ? '1 part identified' : ''}
                  {item.resultCount ? ` · ${item.resultCount} sets found` : ''}
                </Text>
              </View>

              <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
            </TouchableOpacity>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  list: { padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.xxl },
  emptyContainer: { flex: 1 },
  clearBtn: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    alignSelf: 'flex-end', marginBottom: spacing.sm,
  },
  clearBtnText: { fontSize: 12, color: colors.error, fontWeight: '600' },
  entry: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surface, borderRadius: radius.md, overflow: 'hidden', ...shadows.sm,
  },
  partImg: { width: 68, height: 68, backgroundColor: colors.surface2 },
  entryInfo: { flex: 1, paddingVertical: spacing.sm },
  entryTopRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: 3 },
  modePill: {
    paddingHorizontal: spacing.sm, paddingVertical: 2,
    borderRadius: radius.full,
  },
  modePillText: { fontSize: 10, fontWeight: '800' },
  timeText: { fontSize: 11, color: colors.textTertiary },
  partName: { ...typography.bodySmall, fontWeight: '600', color: colors.text },
  setName: { fontSize: 11, color: colors.textSecondary, marginTop: 1 },
  resultSub: { fontSize: 11, color: colors.textTertiary, marginTop: 2 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, marginTop: 80 },
  emptyIconWrap: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
  emptyTitle: { ...typography.h3, marginBottom: spacing.xs },
  emptyDesc: { ...typography.bodySmall, color: colors.textSecondary, textAlign: 'center' },
});
