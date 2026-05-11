import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, FlatList, Image,
  TouchableOpacity, Alert, ActivityIndicator, ScrollView,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  getCollection, getTrackedSets, removePartFromCollection,
  updatePartCount, removeTrackedSet, calculateSetProgress,
} from '../services/collection';
import { getSetInventory, getSetsForParts } from '../services/rebrickable';
import { scoreSetsByParts } from '../services/setScorer';
import { colors, spacing, radius } from '../constants/theme';

export default function CollectionScreen({ navigation }) {
  const [tab, setTab] = useState('parts'); // 'parts' | 'sets' | 'build'
  const [collection, setCollection] = useState({});
  const [trackedSets, setTrackedSets] = useState([]);
  const [setProgress, setSetProgress] = useState({});
  const [loadingProgress, setLoadingProgress] = useState(false);
  const [canBuildSets, setCanBuildSets] = useState(null); // null=not loaded, []=empty
  const [loadingCanBuild, setLoadingCanBuild] = useState(false);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [])
  );

  async function load() {
    const [col, sets] = await Promise.all([getCollection(), getTrackedSets()]);
    setCollection(col);
    setTrackedSets(sets);
    if (sets.length > 0) loadSetProgress(sets, col);
  }

  async function loadSetProgress(sets, col) {
    setLoadingProgress(true);
    const progress = {};
    await Promise.allSettled(
      sets.map(async (s) => {
        try {
          const inventory = await getSetInventory(s.set_num);
          progress[s.set_num] = calculateSetProgress(inventory, col);
        } catch (_) {
          progress[s.set_num] = null;
        }
      })
    );
    setSetProgress(progress);
    setLoadingProgress(false);
  }

  async function loadCanBuild(col) {
    const partIds = Object.keys(col);
    if (partIds.length === 0) {
      setCanBuildSets([]);
      return;
    }
    setLoadingCanBuild(true);
    try {
      // Cap at 30 most recently added parts to stay within rate limits
      const recent = Object.entries(col)
        .sort((a, b) => b[1].lastAdded - a[1].lastAdded)
        .slice(0, 30)
        .map(([id]) => id);

      const partToSets = await getSetsForParts(recent);
      const scored = scoreSetsByParts(partToSets);
      setCanBuildSets(scored.slice(0, 20));
    } catch (e) {
      setCanBuildSets([]);
    } finally {
      setLoadingCanBuild(false);
    }
  }

  function handleTabChange(t) {
    setTab(t);
    if (t === 'build' && canBuildSets === null) {
      loadCanBuild(collection);
    }
  }

  async function handleRemovePart(partId) {
    Alert.alert('Remove Part', 'Remove this part from your collection?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive',
        onPress: async () => {
          const updated = await removePartFromCollection(partId);
          setCollection(updated);
        },
      },
    ]);
  }

  async function handleCountChange(partId, delta) {
    const current = collection[partId]?.count || 0;
    const next = current + delta;
    if (next < 0) return;
    const updated = await updatePartCount(partId, next);
    setCollection(updated);
  }

  async function handleUntrackSet(setNum) {
    const updated = await removeTrackedSet(setNum);
    setTrackedSets(updated);
    const p = { ...setProgress };
    delete p[setNum];
    setSetProgress(p);
  }

  const parts = Object.entries(collection).sort((a, b) => b[1].lastAdded - a[1].lastAdded);
  const totalParts = parts.reduce((sum, [, v]) => sum + v.count, 0);
  const sortedSets = [...trackedSets].sort((a, b) => {
    const pa = setProgress[a.set_num]?.pct ?? -1;
    const pb = setProgress[b.set_num]?.pct ?? -1;
    return pb - pa;
  });

  return (
    <SafeAreaView style={styles.container}>
      {/* Stats bar */}
      <View style={styles.statsBar}>
        <View style={styles.stat}>
          <Text style={styles.statNum}>{parts.length}</Text>
          <Text style={styles.statLabel}>unique parts</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.stat}>
          <Text style={styles.statNum}>{totalParts}</Text>
          <Text style={styles.statLabel}>total pieces</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.stat}>
          <Text style={styles.statNum}>{trackedSets.length}</Text>
          <Text style={styles.statLabel}>tracked sets</Text>
        </View>
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        {[
          { key: 'parts', label: 'My Parts' },
          { key: 'sets', label: 'Set Progress' },
          { key: 'build', label: '🔨 Can Build' },
        ].map((t) => (
          <TouchableOpacity
            key={t.key}
            style={[styles.tab, tab === t.key && styles.tabActive]}
            onPress={() => handleTabChange(t.key)}
          >
            <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* My Parts */}
      {tab === 'parts' && (
        <FlatList
          data={parts}
          keyExtractor={([id]) => id}
          contentContainerStyle={parts.length === 0 ? styles.emptyContainer : styles.list}
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <Text style={styles.emptyIcon}>📦</Text>
              <Text style={styles.emptyTitle}>No parts yet</Text>
              <Text style={styles.emptyDesc}>
                Scan pieces using any mode and tap "Add to Collection" to build your inventory.
              </Text>
            </View>
          }
          renderItem={({ item: [partId, entry] }) => (
            <View style={styles.partRow}>
              {entry.part.img_url ? (
                <Image source={{ uri: entry.part.img_url }} style={styles.partImg} resizeMode="contain" />
              ) : (
                <View style={[styles.partImg, styles.partImgPlaceholder]}>
                  <Text style={{ fontSize: 20 }}>🧱</Text>
                </View>
              )}
              <View style={styles.partInfo}>
                <Text style={styles.partName} numberOfLines={1}>{entry.part.name}</Text>
                <Text style={styles.partId}>#{partId}</Text>
              </View>
              <View style={styles.countControls}>
                <TouchableOpacity style={styles.countBtn} onPress={() => handleCountChange(partId, -1)}>
                  <Text style={styles.countBtnText}>−</Text>
                </TouchableOpacity>
                <Text style={styles.countNum}>{entry.count}</Text>
                <TouchableOpacity style={styles.countBtn} onPress={() => handleCountChange(partId, 1)}>
                  <Text style={styles.countBtnText}>+</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity style={styles.deleteBtn} onPress={() => handleRemovePart(partId)}>
                <Text style={styles.deleteBtnText}>✕</Text>
              </TouchableOpacity>
            </View>
          )}
        />
      )}

      {/* Set Progress */}
      {tab === 'sets' && (
        <ScrollView contentContainerStyle={styles.list}>
          <TouchableOpacity
            style={styles.addSetBtn}
            onPress={() => navigation.navigate('TrackSet')}
          >
            <Text style={styles.addSetBtnText}>+ Track a New Set</Text>
          </TouchableOpacity>

          {sortedSets.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyIcon}>🎯</Text>
              <Text style={styles.emptyTitle}>No tracked sets</Text>
              <Text style={styles.emptyDesc}>
                Tap "Track a New Set" above or add sets from scan results.
              </Text>
            </View>
          ) : (
            sortedSets.map((set) => {
              const p = setProgress[set.set_num];
              return (
                <TouchableOpacity
                  key={set.set_num}
                  style={styles.setCard}
                  onPress={() => navigation.navigate('SetProgress', { set })}
                  activeOpacity={0.8}
                >
                  <View style={styles.setCardRow}>
                    {set.set_img_url ? (
                      <Image source={{ uri: set.set_img_url }} style={styles.setImg} resizeMode="contain" />
                    ) : (
                      <View style={[styles.setImg, styles.setImgPlaceholder]}>
                        <Text style={{ fontSize: 22 }}>🧱</Text>
                      </View>
                    )}
                    <View style={styles.setInfo}>
                      <Text style={styles.setName} numberOfLines={2}>{set.name}</Text>
                      <Text style={styles.setMeta}>#{set.set_num} · {set.year} · {set.num_parts} parts</Text>
                      {p ? (
                        <>
                          <View style={styles.progressBarBg}>
                            <View style={[styles.progressBarFill, { width: `${p.pct}%` }]} />
                          </View>
                          <Text style={styles.progressPct}>{p.owned}/{p.total} parts · {p.pct}%</Text>
                        </>
                      ) : loadingProgress ? (
                        <Text style={styles.setMeta}>Calculating...</Text>
                      ) : null}
                    </View>
                    <TouchableOpacity style={styles.untrackBtn} onPress={() => handleUntrackSet(set.set_num)}>
                      <Text style={styles.untrackBtnText}>✕</Text>
                    </TouchableOpacity>
                  </View>
                </TouchableOpacity>
              );
            })
          )}
        </ScrollView>
      )}

      {/* Can Build */}
      {tab === 'build' && (
        <ScrollView contentContainerStyle={styles.list}>
          {loadingCanBuild ? (
            <View style={styles.emptyBox}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={styles.emptyDesc}>Scanning your collection against Rebrickable...</Text>
            </View>
          ) : canBuildSets === null || parts.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyIcon}>🔨</Text>
              <Text style={styles.emptyTitle}>Nothing to check yet</Text>
              <Text style={styles.emptyDesc}>
                Add parts to your collection first, then come back to see which sets you can build.
              </Text>
            </View>
          ) : canBuildSets.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyIcon}>🤷</Text>
              <Text style={styles.emptyTitle}>No matches found</Text>
              <Text style={styles.emptyDesc}>No sets matched your current collection. Try scanning more parts.</Text>
            </View>
          ) : (
            <>
              <View style={styles.canBuildNotice}>
                <Text style={styles.canBuildNoticeText}>
                  Based on your {parts.length} unique parts. Tap any set to see exact completion %.
                </Text>
                <TouchableOpacity onPress={() => { setCanBuildSets(null); loadCanBuild(collection); }}>
                  <Text style={styles.refreshText}>Refresh</Text>
                </TouchableOpacity>
              </View>
              {canBuildSets.map((item, i) => (
                <TouchableOpacity
                  key={item.set.set_num}
                  style={styles.setCard}
                  onPress={() => navigation.navigate('SetProgress', { set: item.set })}
                  activeOpacity={0.8}
                >
                  <View style={styles.setCardRow}>
                    {item.set.set_img_url ? (
                      <Image source={{ uri: item.set.set_img_url }} style={styles.setImg} resizeMode="contain" />
                    ) : (
                      <View style={[styles.setImg, styles.setImgPlaceholder]}>
                        <Text style={{ fontSize: 22 }}>🧱</Text>
                      </View>
                    )}
                    <View style={styles.setInfo}>
                      {i === 0 && <Text style={styles.bestMatchBadge}>Best Match</Text>}
                      <Text style={styles.setName} numberOfLines={2}>{item.set.name}</Text>
                      <Text style={styles.setMeta}>#{item.set.set_num} · {item.set.year} · {item.set.num_parts} parts</Text>
                      <Text style={styles.matchCount}>
                        {item.matchedParts} of your parts appear in this set
                      </Text>
                    </View>
                  </View>
                </TouchableOpacity>
              ))}
            </>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  statsBar: { flexDirection: 'row', backgroundColor: colors.primary, paddingVertical: spacing.md },
  stat: { flex: 1, alignItems: 'center' },
  statNum: { fontSize: 22, fontWeight: '900', color: '#fff' },
  statLabel: { fontSize: 11, color: 'rgba(255,255,255,0.75)', marginTop: 2 },
  statDivider: { width: 1, backgroundColor: 'rgba(255,255,255,0.3)', marginVertical: spacing.xs },
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border },
  tab: { flex: 1, paddingVertical: spacing.md, alignItems: 'center' },
  tabActive: { borderBottomWidth: 3, borderBottomColor: colors.primary },
  tabText: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
  tabTextActive: { color: colors.primary },
  list: { padding: spacing.md },
  emptyContainer: { flex: 1 },
  emptyBox: { alignItems: 'center', justifyContent: 'center', padding: spacing.xl, marginTop: 40 },
  emptyIcon: { fontSize: 52, marginBottom: spacing.md },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },
  emptyDesc: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', lineHeight: 22 },
  addSetBtn: {
    borderWidth: 2, borderColor: colors.primary, borderStyle: 'dashed',
    borderRadius: radius.md, padding: spacing.md, alignItems: 'center', marginBottom: spacing.md,
  },
  addSetBtnText: { color: colors.primary, fontWeight: '700', fontSize: 14 },
  partRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface,
    borderRadius: radius.md, overflow: 'hidden', marginBottom: spacing.sm,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 3, elevation: 2,
  },
  partImg: { width: 60, height: 60, backgroundColor: '#f0f0f0' },
  partImgPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  partInfo: { flex: 1, paddingHorizontal: spacing.sm },
  partName: { fontSize: 13, fontWeight: '600', color: colors.text },
  partId: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  countControls: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.xs },
  countBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  countBtnText: { fontSize: 16, fontWeight: '700', color: colors.text, lineHeight: 20 },
  countNum: { fontSize: 15, fontWeight: '800', color: colors.text, minWidth: 24, textAlign: 'center' },
  deleteBtn: { padding: spacing.md },
  deleteBtnText: { color: colors.textSecondary, fontSize: 14 },
  setCard: {
    backgroundColor: colors.surface, borderRadius: radius.md, marginBottom: spacing.sm,
    overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07, shadowRadius: 4, elevation: 2,
  },
  setCardRow: { flexDirection: 'row', alignItems: 'center', padding: spacing.sm },
  setImg: { width: 80, height: 80, backgroundColor: '#f0f0f0', borderRadius: radius.sm },
  setImgPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  setInfo: { flex: 1, paddingHorizontal: spacing.sm },
  setName: { fontSize: 14, fontWeight: '700', color: colors.text, marginBottom: 2 },
  setMeta: { fontSize: 12, color: colors.textSecondary, marginBottom: spacing.xs },
  progressBarBg: { height: 6, backgroundColor: colors.border, borderRadius: 3, overflow: 'hidden', marginBottom: 4 },
  progressBarFill: { height: '100%', backgroundColor: colors.success, borderRadius: 3 },
  progressPct: { fontSize: 12, color: colors.success, fontWeight: '600' },
  untrackBtn: { padding: spacing.sm },
  untrackBtnText: { color: colors.textSecondary, fontSize: 14 },
  canBuildNotice: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#EEF9EE', borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md,
  },
  canBuildNoticeText: { flex: 1, fontSize: 12, color: colors.textSecondary, lineHeight: 18 },
  refreshText: { color: colors.primary, fontWeight: '700', fontSize: 13, marginLeft: spacing.sm },
  bestMatchBadge: {
    backgroundColor: colors.primary, color: '#fff', fontSize: 10, fontWeight: '900',
    paddingHorizontal: spacing.xs, paddingVertical: 2, borderRadius: radius.sm,
    alignSelf: 'flex-start', marginBottom: 4, overflow: 'hidden',
  },
  matchCount: { fontSize: 12, color: colors.success, fontWeight: '600' },
});
