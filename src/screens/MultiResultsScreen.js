import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, Image, ActivityIndicator,
  TouchableOpacity, ScrollView, Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { identifyPart } from '../services/brickognize';
import { getSetsForParts } from '../services/rebrickable';
import { splitImageIntoGrid } from '../services/imageGrid';
import { scoreSetsByParts } from '../services/setScorer';
import { addPartsToCollection, addTrackedSet } from '../services/collection';
import { colors, spacing, radius, shadows, typography, gradients } from '../constants/theme';

const STEPS = {
  splitting: { label: 'Splitting photo into grid…', pct: '10%' },
  fetching:  { label: 'Looking up matching sets…', pct: '80%' },
  scoring:   { label: 'Scoring results…',          pct: '95%' },
};

export default function MultiResultsScreen({ navigation, route }) {
  const { imageUri, gridRows, gridCols, identifiedParts: preIdentified } = route.params;
  const isSequential = !!preIdentified;
  const totalCells = isSequential ? preIdentified.length : (gridRows * gridCols);

  const [step, setStep] = useState(isSequential ? 'fetching' : 'splitting');
  const [cellsDone, setCellsDone] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const [identifiedParts, setIdentifiedParts] = useState(preIdentified || []);
  const [rankedSets, setRankedSets] = useState([]);
  const [addedToCollection, setAddedToCollection] = useState(false);
  const [trackedSet, setTrackedSet] = useState(null);

  useEffect(() => { run(); }, []);

  async function run() {
    try {
      let parts = preIdentified || [];
      if (!isSequential) {
        setStep('splitting');
        const crops = await splitImageIntoGrid(imageUri, gridRows, gridCols);
        setStep('identifying');
        setCellsDone(0);
        const identifyResults = await Promise.allSettled(crops.map(async (crop) => {
          const result = await identifyPart(crop.uri);
          setCellsDone((n) => n + 1);
          return result;
        }));
        const partMap = {};
        for (const r of identifyResults) {
          if (r.status !== 'fulfilled') continue;
          const top = r.value?.items?.[0];
          if (top && !partMap[top.id]) partMap[top.id] = top;
        }
        parts = Object.values(partMap);
        setIdentifiedParts(parts);
      }
      if (!parts.length) { setErrorMsg('No parts identified. Try better lighting or a cleaner background.'); setStep('error'); return; }
      setStep('fetching');
      const scored = scoreSetsByParts(await getSetsForParts(parts.map((p) => p.id)));
      setStep('scoring');
      setRankedSets(scored.slice(0, 15));
      setStep('done');
    } catch (e) {
      setErrorMsg(e?.response?.status === 401 ? 'API key error — check Settings.' : `Something went wrong: ${e.message}`);
      setStep('error');
    }
  }

  const identifyingPct = step === 'identifying' ? `${10 + (cellsDone / totalCells) * 60}%` : undefined;
  const progressPct = STEPS[step]?.pct ?? identifyingPct ?? '0%';
  const progressLabel = step === 'identifying'
    ? `Identifying parts… ${cellsDone}/${totalCells} cells`
    : STEPS[step]?.label ?? '';

  if (step !== 'done' && step !== 'error') {
    return (
      <LinearGradient colors={gradients.dark} style={styles.loadingScreen}>
        <View style={styles.loadingContent}>
          <View style={styles.loadingIcon}><Ionicons name="scan-outline" size={40} color={colors.secondary} /></View>
          <Text style={styles.loadingTitle}>{progressLabel}</Text>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: progressPct }]} />
          </View>
          <Text style={styles.loadingHint}>{isSequential ? 'Sequential scan' : `${gridRows}×${gridCols} grid`}</Text>
        </View>
      </LinearGradient>
    );
  }

  if (step === 'error') {
    return (
      <LinearGradient colors={gradients.dark} style={styles.loadingScreen}>
        <View style={styles.loadingContent}>
          <View style={[styles.loadingIcon, { backgroundColor: 'rgba(220,38,38,0.2)' }]}>
            <Ionicons name="alert-circle-outline" size={40} color={colors.error} />
          </View>
          <Text style={styles.loadingTitle}>Scan failed</Text>
          <Text style={styles.loadingHint}>{errorMsg}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => navigation.goBack()}>
            <Text style={styles.retryBtnText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      </LinearGradient>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Photo with grid overlay */}
        {!isSequential && imageUri && (
          <View style={styles.photoWrap}>
            <Image source={{ uri: imageUri }} style={styles.photo} resizeMode="cover" />
            <View style={styles.gridOverlay}>
              {Array.from({ length: gridRows }).map((_, r) =>
                Array.from({ length: gridCols }).map((_, c) => (
                  <View key={`${r}-${c}`} style={[styles.gridCell, { width: `${100/gridCols}%`, height: `${100/gridRows}%`, left: `${(c/gridCols)*100}%`, top: `${(r/gridRows)*100}%` }]} />
                ))
              )}
            </View>
          </View>
        )}

        {/* Stats bar */}
        <LinearGradient colors={gradients.dark} style={styles.statsBar}>
          <StatChip value={identifiedParts.length} label="parts found" icon="cube-outline" />
          <View style={styles.statsDivider} />
          <StatChip value={rankedSets.length} label="sets matched" icon="layers-outline" />
          <View style={styles.statsDivider} />
          <StatChip value={isSequential ? '📸' : `${gridRows}×${gridCols}`} label={isSequential ? 'sequential' : 'grid'} icon="scan-outline" />
        </LinearGradient>

        {/* Add to collection */}
        <TouchableOpacity
          style={[styles.collectBtn, addedToCollection && styles.collectBtnDone]}
          onPress={async () => { await addPartsToCollection(identifiedParts); setAddedToCollection(true); Alert.alert('Added!', `${identifiedParts.length} part(s) saved to your collection.`); }}
          disabled={addedToCollection}
        >
          <Ionicons name={addedToCollection ? 'checkmark-circle' : 'add-circle-outline'} size={18} color={addedToCollection ? colors.success : colors.secondary} />
          <Text style={[styles.collectBtnText, addedToCollection && { color: colors.success }]}>
            {addedToCollection ? `Saved ${identifiedParts.length} parts to Collection` : `Add ${identifiedParts.length} Parts to Collection`}
          </Text>
        </TouchableOpacity>

        {/* Parts scroll */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Identified Parts</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.partsRow} contentContainerStyle={{ gap: spacing.sm, paddingHorizontal: spacing.md }}>
            {identifiedParts.map((p) => (
              <View key={p.id} style={styles.partChip}>
                {p.img_url && <Image source={{ uri: p.img_url }} style={styles.partChipImg} resizeMode="contain" />}
                <Text style={styles.partChipId}>#{p.id}</Text>
                <Text style={styles.partChipName} numberOfLines={1}>{p.name?.split(' ').slice(0, 2).join(' ') || '—'}</Text>
              </View>
            ))}
          </ScrollView>
        </View>

        {/* Ranked sets */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Best Matching Sets</Text>
          {rankedSets.map((item, i) => (
            <RankedCard
              key={item.set.set_num}
              item={item}
              rank={i + 1}
              isTracked={trackedSet === item.set.set_num}
              onTrack={async () => { await addTrackedSet(item.set); setTrackedSet(item.set.set_num); }}
              onViewProgress={() => navigation.navigate('SetProgress', { set: item.set })}
            />
          ))}
          {!rankedSets.length && <Text style={styles.emptyText}>No matching sets found.</Text>}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function StatChip({ value, label, icon }) {
  return (
    <View style={styles.statChip}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function RankedCard({ item, rank, isTracked, onTrack, onViewProgress }) {
  const pct = Math.round(item.score * 100);
  const isTop = rank === 1;
  return (
    <View style={[styles.rankCard, isTop && styles.rankCardTop]}>
      {isTop && (
        <LinearGradient colors={gradients.gold} style={styles.topBadge}>
          <Ionicons name="star" size={10} color="#fff" />
          <Text style={styles.topBadgeText}>Best Match</Text>
        </LinearGradient>
      )}
      <View style={styles.rankCardRow}>
        <Text style={styles.rankNum}>#{rank}</Text>
        {item.set.set_img_url
          ? <Image source={{ uri: item.set.set_img_url }} style={styles.rankImg} resizeMode="contain" />
          : <View style={[styles.rankImg, styles.rankImgPlaceholder]}><Ionicons name="cube-outline" size={22} color="#555" /></View>
        }
        <View style={styles.rankInfo}>
          <Text style={styles.rankName} numberOfLines={2}>{item.set.name}</Text>
          <Text style={styles.rankMeta}>#{item.set.set_num} · {item.set.year} · {item.set.num_parts} parts</Text>
          <View style={styles.matchRow}>
            <View style={styles.matchBarBg}><View style={[styles.matchBarFill, { width: `${pct}%` }]} /></View>
            <Text style={styles.matchPct}>{item.matchedParts}/{item.totalIdentified}</Text>
          </View>
          <View style={styles.rankActions}>
            <TouchableOpacity style={[styles.rankActionBtn, isTracked && styles.rankActionBtnActive]} onPress={onTrack} disabled={isTracked}>
              <Ionicons name={isTracked ? 'bookmark' : 'bookmark-outline'} size={12} color={isTracked ? colors.success : '#888'} />
              <Text style={[styles.rankActionText, isTracked && { color: colors.success }]}>{isTracked ? 'Tracked' : 'Track'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.rankActionBtn} onPress={onViewProgress}>
              <Ionicons name="stats-chart-outline" size={12} color="#888" />
              <Text style={styles.rankActionText}>Progress</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  scroll: { paddingBottom: spacing.xxl },
  loadingScreen: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingContent: { alignItems: 'center', gap: spacing.lg, padding: spacing.xl },
  loadingIcon: { width: 88, height: 88, borderRadius: 44, backgroundColor: 'rgba(245,168,0,0.15)', alignItems: 'center', justifyContent: 'center' },
  loadingTitle: { ...typography.h2, color: '#fff', textAlign: 'center' },
  loadingHint: { ...typography.bodySmall, color: '#888', textAlign: 'center' },
  progressTrack: { width: 260, height: 6, backgroundColor: '#2C2C2E', borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: colors.secondary, borderRadius: 3 },
  retryBtn: { backgroundColor: colors.primary, paddingVertical: spacing.md, paddingHorizontal: spacing.xl, borderRadius: radius.full },
  retryBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  photoWrap: { height: 220, position: 'relative' },
  photo: { width: '100%', height: '100%' },
  gridOverlay: { position: 'absolute', inset: 0 },
  gridCell: { position: 'absolute', borderWidth: 1, borderColor: 'rgba(245,168,0,0.6)' },
  statsBar: { flexDirection: 'row', paddingVertical: spacing.md },
  statChip: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 22, fontWeight: '900', color: colors.secondary },
  statLabel: { fontSize: 10, fontWeight: '600', color: '#666', marginTop: 2 },
  statsDivider: { width: 1, backgroundColor: '#2C2C2E', marginVertical: spacing.xs },
  collectBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    margin: spacing.md, borderWidth: 1.5, borderColor: colors.secondary,
    borderRadius: radius.full, paddingVertical: spacing.sm, backgroundColor: 'rgba(245,168,0,0.08)',
  },
  collectBtnDone: { borderColor: colors.success, backgroundColor: 'rgba(5,150,105,0.08)' },
  collectBtnText: { ...typography.bodySmall, fontWeight: '700', color: colors.secondary },
  section: { marginBottom: spacing.md },
  sectionLabel: { ...typography.label, color: '#555', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  partsRow: { paddingVertical: spacing.xs },
  partChip: { backgroundColor: '#1C1C1E', borderRadius: radius.sm, padding: spacing.sm, alignItems: 'center', width: 76, borderWidth: 1, borderColor: '#2C2C2E' },
  partChipImg: { width: 44, height: 44, marginBottom: 3 },
  partChipId: { fontSize: 10, fontWeight: '700', color: colors.secondary },
  partChipName: { fontSize: 9, color: '#666', textAlign: 'center', marginTop: 1 },
  rankCard: { backgroundColor: '#1C1C1E', marginHorizontal: spacing.md, marginBottom: spacing.sm, borderRadius: radius.md, overflow: 'hidden', borderWidth: 1, borderColor: '#2C2C2E' },
  rankCardTop: { borderColor: colors.secondary },
  topBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.md, paddingVertical: 4, alignSelf: 'flex-start' },
  topBadgeText: { fontSize: 10, fontWeight: '900', color: '#fff' },
  rankCardRow: { flexDirection: 'row', alignItems: 'flex-start', padding: spacing.sm },
  rankNum: { color: '#444', fontWeight: '800', fontSize: 14, width: 28, textAlign: 'center', paddingTop: 4 },
  rankImg: { width: 72, height: 72, backgroundColor: '#111', borderRadius: radius.sm },
  rankImgPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  rankInfo: { flex: 1, paddingLeft: spacing.sm },
  rankName: { ...typography.bodySmall, fontWeight: '700', color: '#fff', marginBottom: 2 },
  rankMeta: { fontSize: 11, color: '#666', marginBottom: spacing.xs },
  matchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.xs },
  matchBarBg: { flex: 1, height: 4, backgroundColor: '#2C2C2E', borderRadius: 2, overflow: 'hidden' },
  matchBarFill: { height: '100%', backgroundColor: colors.secondary, borderRadius: 2 },
  matchPct: { fontSize: 11, color: colors.secondary, fontWeight: '700' },
  rankActions: { flexDirection: 'row', gap: spacing.xs },
  rankActionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: '#333', borderRadius: radius.xs, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  rankActionBtnActive: { borderColor: colors.success },
  rankActionText: { fontSize: 10, color: '#888', fontWeight: '600' },
  emptyText: { ...typography.body, color: '#555', textAlign: 'center', padding: spacing.xl },
});
