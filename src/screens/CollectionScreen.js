import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, FlatList, Image,
  TouchableOpacity, Alert, ActivityIndicator, ScrollView, TextInput,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import {
  getCollection, getTrackedSets, removePartFromCollection,
  updatePartCount, removeTrackedSet, calculateSetProgress,
} from '../services/collection';
import { getSetInventory, getSetsForParts } from '../services/rebrickable';
import { scoreSetsByParts } from '../services/setScorer';
import { colors, spacing, radius, shadows, typography, gradients } from '../constants/theme';

const TABS = [
  { key: 'parts', label: 'Parts', icon: 'cube-outline' },
  { key: 'sets', label: 'Progress', icon: 'trophy-outline' },
  { key: 'build', label: 'Can Build', icon: 'construct-outline' },
];

export default function CollectionScreen({ navigation }) {
  const [tab, setTab] = useState('parts');
  const [partsSearch, setPartsSearch] = useState('');
  const [collection, setCollection] = useState({});
  const [trackedSets, setTrackedSets] = useState([]);
  const [setProgress, setSetProgress] = useState({});
  const [loadingProgress, setLoadingProgress] = useState(false);
  const [canBuildSets, setCanBuildSets] = useState(null);
  const [loadingCanBuild, setLoadingCanBuild] = useState(false);

  useFocusEffect(useCallback(() => { load(); }, []));

  async function load() {
    const [col, sets] = await Promise.all([getCollection(), getTrackedSets()]);
    setCollection(col);
    setTrackedSets(sets);
    if (sets.length > 0) loadSetProgress(sets, col);
  }

  async function loadSetProgress(sets, col) {
    setLoadingProgress(true);
    const progress = {};
    await Promise.allSettled(sets.map(async (s) => {
      try { progress[s.set_num] = calculateSetProgress(await getSetInventory(s.set_num), col); }
      catch (_) { progress[s.set_num] = null; }
    }));
    setSetProgress(progress);
    setLoadingProgress(false);
  }

  async function loadCanBuild(col) {
    const partIds = Object.keys(col);
    if (!partIds.length) { setCanBuildSets([]); return; }
    setLoadingCanBuild(true);
    try {
      const recent = Object.entries(col).sort((a, b) => b[1].lastAdded - a[1].lastAdded).slice(0, 30).map(([id]) => id);
      const scored = scoreSetsByParts(await getSetsForParts(recent));
      setCanBuildSets(scored.slice(0, 20));
    } catch { setCanBuildSets([]); }
    finally { setLoadingCanBuild(false); }
  }

  function handleTabChange(t) {
    setTab(t);
    if (t === 'build' && canBuildSets === null) loadCanBuild(collection);
  }

  async function handleRemovePart(partId) {
    Alert.alert('Remove Part', 'Remove this part?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => setCollection(await removePartFromCollection(partId)) },
    ]);
  }

  async function handleCountChange(partId, delta) {
    const next = (collection[partId]?.count || 0) + delta;
    if (next < 0) return;
    setCollection(await updatePartCount(partId, next));
  }

  async function handleUntrackSet(setNum) {
    setTrackedSets(await removeTrackedSet(setNum));
    const p = { ...setProgress }; delete p[setNum]; setSetProgress(p);
  }

  const allParts = Object.entries(collection).sort((a, b) => b[1].lastAdded - a[1].lastAdded);
  const parts = partsSearch.trim()
    ? allParts.filter(([id, entry]) =>
        entry.part.name?.toLowerCase().includes(partsSearch.toLowerCase()) ||
        id.toLowerCase().includes(partsSearch.toLowerCase())
      )
    : allParts;
  const totalParts = parts.reduce((sum, [, v]) => sum + v.count, 0);
  const sortedSets = [...trackedSets].sort((a, b) => (setProgress[b.set_num]?.pct ?? -1) - (setProgress[a.set_num]?.pct ?? -1));

  return (
    <SafeAreaView style={styles.container}>
      {/* Stats header */}
      <LinearGradient colors={gradients.primary} style={styles.statsHeader}>
        <StatPill value={parts.length} label="unique parts" />
        <View style={styles.statsDivider} />
        <StatPill value={totalParts} label="total pieces" />
        <View style={styles.statsDivider} />
        <StatPill value={trackedSets.length} label="tracked sets" />
      </LinearGradient>

      {/* Tabs */}
      <View style={styles.tabBar}>
        {TABS.map((t) => (
          <TouchableOpacity key={t.key} style={[styles.tab, tab === t.key && styles.tabActive]} onPress={() => handleTabChange(t.key)}>
            <Ionicons name={t.icon} size={16} color={tab === t.key ? colors.primary : colors.textTertiary} />
            <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Parts */}
      {tab === 'parts' && (
        <FlatList
          data={parts}
          keyExtractor={([id]) => id}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            allParts.length > 0 ? (
              <View style={styles.searchWrap}>
                <Ionicons name="search-outline" size={16} color={colors.textTertiary} style={styles.searchIcon} />
                <TextInput
                  style={styles.searchInput}
                  placeholder="Search parts…"
                  placeholderTextColor={colors.textTertiary}
                  value={partsSearch}
                  onChangeText={setPartsSearch}
                  returnKeyType="search"
                  clearButtonMode="while-editing"
                />
                {partsSearch.length > 0 && (
                  <TouchableOpacity onPress={() => setPartsSearch('')} style={styles.searchClear}>
                    <Ionicons name="close-circle" size={16} color={colors.textTertiary} />
                  </TouchableOpacity>
                )}
              </View>
            ) : null
          }
          ListEmptyComponent={
            partsSearch.trim()
              ? <EmptyState icon="search-outline" title="No matches" desc={`No parts matching "${partsSearch}"`} />
              : <EmptyState icon="cube-outline" title="No parts yet" desc='Scan pieces and tap "Add to Collection"' />
          }
          renderItem={({ item: [partId, entry] }) => (
            <View style={styles.partCard}>
              {entry.part.img_url
                ? <Image source={{ uri: entry.part.img_url }} style={styles.partImg} resizeMode="contain" />
                : <View style={[styles.partImg, styles.imgPlaceholder]}><Ionicons name="cube-outline" size={24} color={colors.textTertiary} /></View>
              }
              <View style={styles.partInfo}>
                <Text style={styles.partName} numberOfLines={1}>{entry.part.name}</Text>
                <Text style={styles.partId}>#{partId}</Text>
              </View>
              <View style={styles.countRow}>
                <TouchableOpacity style={styles.countBtn} onPress={() => handleCountChange(partId, -1)}>
                  <Ionicons name="remove" size={16} color={colors.text} />
                </TouchableOpacity>
                <Text style={styles.countNum}>{entry.count}</Text>
                <TouchableOpacity style={styles.countBtn} onPress={() => handleCountChange(partId, 1)}>
                  <Ionicons name="add" size={16} color={colors.text} />
                </TouchableOpacity>
              </View>
              <TouchableOpacity onPress={() => handleRemovePart(partId)} style={styles.deleteBtn}>
                <Ionicons name="close" size={16} color={colors.textTertiary} />
              </TouchableOpacity>
            </View>
          )}
        />
      )}

      {/* Set Progress */}
      {tab === 'sets' && (
        <ScrollView contentContainerStyle={styles.list}>
          <TouchableOpacity style={styles.addSetBtn} onPress={() => navigation.navigate('TrackSet')}>
            <Ionicons name="add-circle-outline" size={18} color={colors.primary} />
            <Text style={styles.addSetBtnText}>Track a New Set</Text>
          </TouchableOpacity>
          {sortedSets.length === 0
            ? <EmptyState icon="trophy-outline" title="No tracked sets" desc='Tap "Track a New Set" to monitor completion progress' />
            : sortedSets.map((set) => {
              const p = setProgress[set.set_num];
              return (
                <TouchableOpacity key={set.set_num} style={styles.setCard} onPress={() => navigation.navigate('SetProgress', { set })} activeOpacity={0.75}>
                  {set.set_img_url
                    ? <Image source={{ uri: set.set_img_url }} style={styles.setImg} resizeMode="contain" />
                    : <View style={[styles.setImg, styles.imgPlaceholder]}><Ionicons name="cube-outline" size={22} color={colors.textTertiary} /></View>
                  }
                  <View style={styles.setInfo}>
                    <Text style={styles.setName} numberOfLines={2}>{set.name}</Text>
                    <Text style={styles.setMeta}>#{set.set_num} · {set.year} · {set.num_parts} parts</Text>
                    {p ? (
                      <>
                        <View style={styles.progressTrack}>
                          <View style={[styles.progressFill, { width: `${p.pct}%`, backgroundColor: p.pct >= 100 ? colors.success : colors.primary }]} />
                        </View>
                        <Text style={[styles.progressLabel, { color: p.pct >= 100 ? colors.success : colors.primary }]}>
                          {p.pct >= 100 ? '🎉 Complete!' : `${p.pct}% · ${p.owned}/${p.total} parts`}
                        </Text>
                      </>
                    ) : loadingProgress ? <Text style={styles.setMeta}>Loading...</Text> : null}
                  </View>
                  <TouchableOpacity onPress={() => handleUntrackSet(set.set_num)} style={styles.deleteBtn}>
                    <Ionicons name="close" size={16} color={colors.textTertiary} />
                  </TouchableOpacity>
                </TouchableOpacity>
              );
            })
          }
        </ScrollView>
      )}

      {/* Can Build */}
      {tab === 'build' && (
        <ScrollView contentContainerStyle={styles.list}>
          {loadingCanBuild
            ? <View style={styles.center}><ActivityIndicator color={colors.primary} size="large" /><Text style={styles.loadingText}>Scanning your collection...</Text></View>
            : parts.length === 0
            ? <EmptyState icon="construct-outline" title="Nothing to check" desc="Add parts to your collection first" />
            : canBuildSets?.length === 0
            ? <EmptyState icon="search-outline" title="No matches found" desc="Try scanning more parts to find matching sets" />
            : (
              <>
                <View style={styles.canBuildBanner}>
                  <Ionicons name="information-circle-outline" size={16} color={colors.textSecondary} />
                  <Text style={styles.canBuildBannerText}>Based on your {parts.length} unique parts · Tap a set for exact %</Text>
                  <TouchableOpacity onPress={() => { setCanBuildSets(null); loadCanBuild(collection); }}>
                    <Ionicons name="refresh-outline" size={18} color={colors.primary} />
                  </TouchableOpacity>
                </View>
                {canBuildSets?.map((item, i) => (
                  <TouchableOpacity key={item.set.set_num} style={[styles.setCard, i === 0 && styles.setCardTop]} onPress={() => navigation.navigate('SetProgress', { set: item.set })} activeOpacity={0.75}>
                    {i === 0 && <View style={styles.topBadge}><Ionicons name="star" size={10} color={colors.secondaryDark} /><Text style={styles.topBadgeText}>Best Match</Text></View>}
                    {item.set.set_img_url
                      ? <Image source={{ uri: item.set.set_img_url }} style={styles.setImg} resizeMode="contain" />
                      : <View style={[styles.setImg, styles.imgPlaceholder]}><Ionicons name="cube-outline" size={22} color={colors.textTertiary} /></View>
                    }
                    <View style={styles.setInfo}>
                      <Text style={styles.setName} numberOfLines={2}>{item.set.name}</Text>
                      <Text style={styles.setMeta}>#{item.set.set_num} · {item.set.year}</Text>
                      <Text style={styles.matchText}>{item.matchedParts} of your parts match</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
                  </TouchableOpacity>
                ))}
              </>
            )
          }
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function StatPill({ value, label }) {
  return (
    <View style={styles.statPill}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function EmptyState({ icon, title, desc }) {
  return (
    <View style={styles.emptyState}>
      <View style={styles.emptyIconWrap}>
        <Ionicons name={icon} size={36} color={colors.textTertiary} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyDesc}>{desc}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  statsHeader: { flexDirection: 'row', paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
  statPill: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 26, fontWeight: '900', color: '#fff' },
  statLabel: { fontSize: 10, fontWeight: '600', color: 'rgba(255,255,255,0.7)', marginTop: 2 },
  statsDivider: { width: 1, backgroundColor: 'rgba(255,255,255,0.25)', marginVertical: spacing.xs },
  tabBar: { flexDirection: 'row', backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingVertical: spacing.md },
  tabActive: { borderBottomWidth: 2.5, borderBottomColor: colors.primary },
  tabText: { fontSize: 12, fontWeight: '600', color: colors.textTertiary },
  tabTextActive: { color: colors.primary },
  list: { padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.xxl },
  center: { alignItems: 'center', paddingTop: spacing.xxl, gap: spacing.md },
  loadingText: { ...typography.body, color: colors.textSecondary },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.surface, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.sm, marginBottom: spacing.sm,
    ...shadows.sm,
  },
  searchIcon: { marginRight: spacing.xs },
  searchInput: { flex: 1, paddingVertical: spacing.sm, fontSize: 14, color: colors.text },
  searchClear: { padding: spacing.xs },
  addSetBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    borderWidth: 2, borderColor: colors.primary, borderStyle: 'dashed',
    borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.xs,
  },
  addSetBtnText: { color: colors.primary, fontWeight: '700', fontSize: 14 },
  partCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface,
    borderRadius: radius.md, overflow: 'hidden', ...shadows.sm,
  },
  partImg: { width: 64, height: 64, backgroundColor: colors.surface2 },
  imgPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  partInfo: { flex: 1, paddingHorizontal: spacing.sm },
  partName: { ...typography.bodySmall, fontWeight: '600', color: colors.text },
  partId: { fontSize: 11, color: colors.textTertiary, marginTop: 2 },
  countRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingRight: spacing.xs },
  countBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  countNum: { fontSize: 15, fontWeight: '800', color: colors.text, minWidth: 22, textAlign: 'center' },
  deleteBtn: { padding: spacing.md },
  setCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface,
    borderRadius: radius.md, overflow: 'hidden', ...shadows.sm,
  },
  setCardTop: { borderWidth: 1.5, borderColor: colors.secondary },
  topBadge: {
    position: 'absolute', top: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: colors.secondary, paddingHorizontal: spacing.sm, paddingVertical: 3,
    borderBottomLeftRadius: radius.sm,
  },
  topBadgeText: { fontSize: 9, fontWeight: '900', color: colors.secondaryDark },
  setImg: { width: 80, height: 80, backgroundColor: colors.surface2 },
  setInfo: { flex: 1, padding: spacing.sm },
  setName: { ...typography.bodySmall, fontWeight: '700', color: colors.text, marginBottom: 2 },
  setMeta: { fontSize: 11, color: colors.textTertiary, marginBottom: spacing.xs },
  progressTrack: { height: 5, backgroundColor: colors.border, borderRadius: 3, overflow: 'hidden', marginBottom: 3 },
  progressFill: { height: '100%', borderRadius: 3 },
  progressLabel: { fontSize: 11, fontWeight: '700' },
  matchText: { fontSize: 11, fontWeight: '600', color: colors.success },
  canBuildBanner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    backgroundColor: colors.surface, borderRadius: radius.sm,
    padding: spacing.sm, marginBottom: spacing.xs,
  },
  canBuildBannerText: { flex: 1, fontSize: 11, color: colors.textSecondary },
  emptyState: { alignItems: 'center', paddingTop: spacing.xxl, paddingHorizontal: spacing.xl },
  emptyIconWrap: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
  emptyTitle: { ...typography.h3, marginBottom: spacing.xs },
  emptyDesc: { ...typography.bodySmall, color: colors.textSecondary, textAlign: 'center' },
});
