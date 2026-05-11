import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, Image, ActivityIndicator,
  TouchableOpacity, ScrollView, Alert,
} from 'react-native';
import { identifyPart } from '../services/brickognize';
import { getSetsForParts } from '../services/rebrickable';
import { splitImageIntoGrid } from '../services/imageGrid';
import { scoreSetsByParts } from '../services/setScorer';
import { addPartsToCollection, addTrackedSet } from '../services/collection';
import { colors, spacing, radius } from '../constants/theme';

const STEPS = {
  splitting: 'Splitting photo into grid...',
  identifying: 'Identifying parts in parallel...',
  fetching: 'Looking up matching sets...',
  scoring: 'Scoring results...',
  done: 'Done',
  error: 'Error',
};

export default function MultiResultsScreen({ navigation, route }) {
  // Grid mode: receives imageUri + gridRows + gridCols
  // Sequential mode: receives identifiedParts directly (already identified)
  const { imageUri, gridRows, gridCols, identifiedParts: preIdentified } = route.params;
  const isSequential = !!preIdentified;
  const totalCells = isSequential ? preIdentified.length : gridRows * gridCols;

  const [step, setStep] = useState(isSequential ? 'fetching' : 'splitting');
  const [errorMsg, setErrorMsg] = useState('');
  const [identifiedParts, setIdentifiedParts] = useState(preIdentified || []);
  const [rankedSets, setRankedSets] = useState([]);
  const [cellsDone, setCellsDone] = useState(isSequential ? preIdentified.length : 0);
  const [addedToCollection, setAddedToCollection] = useState(false);
  const [trackedSet, setTrackedSet] = useState(null);

  useEffect(() => {
    run();
  }, []);

  async function run() {
    try {
      let parts = preIdentified || [];

      if (!isSequential) {
        // Grid mode: split + identify
        setStep('splitting');
        const crops = await splitImageIntoGrid(imageUri, gridRows, gridCols);

        setStep('identifying');
        setCellsDone(0);
        const identifyResults = await Promise.allSettled(
          crops.map(async (crop) => {
            const result = await identifyPart(crop.uri);
            setCellsDone((n) => n + 1);
            return result;
          })
        );

        const partMap = {};
        for (const r of identifyResults) {
          if (r.status !== 'fulfilled') continue;
          const items = r.value?.items;
          if (!items || items.length === 0) continue;
          const top = items[0];
          if (!partMap[top.id]) partMap[top.id] = top;
        }
        parts = Object.values(partMap);
        setIdentifiedParts(parts);
      }

      if (parts.length === 0) {
        setErrorMsg('No LEGO parts could be identified. Try better lighting or a cleaner background.');
        setStep('error');
        return;
      }

      setStep('fetching');
      const partToSets = await getSetsForParts(parts.map((p) => p.id));

      setStep('scoring');
      const scored = scoreSetsByParts(partToSets);
      setRankedSets(scored.slice(0, 15));

      setStep('done');
    } catch (e) {
      console.error(e);
      setErrorMsg(e?.response?.status === 401
        ? 'API key error — check your .env file.'
        : `Something went wrong: ${e.message}`);
      setStep('error');
    }
  }

  async function handleAddToCollection() {
    await addPartsToCollection(identifiedParts);
    setAddedToCollection(true);
    Alert.alert('Added!', `${identifiedParts.length} part(s) added to your collection.`);
  }

  async function handleTrackSet(set) {
    await addTrackedSet(set);
    setTrackedSet(set.set_num);
    Alert.alert('Tracking!', `"${set.name}" added to your tracked sets.`);
  }

  if (step !== 'done' && step !== 'error') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color={colors.secondary} />
          <Text style={styles.loadingStep}>{STEPS[step]}</Text>
          {step === 'identifying' && !isSequential && (
            <Text style={styles.loadingProgress}>{cellsDone} / {totalCells} cells processed</Text>
          )}
          {step === 'fetching' && isSequential && (
            <Text style={styles.loadingProgress}>Looking up {identifiedParts.length} parts...</Text>
          )}
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, {
              width: step === 'splitting' ? '10%'
                : step === 'identifying' ? `${10 + (cellsDone / totalCells) * 60}%`
                : step === 'fetching' ? '80%'
                : '95%',
            }]} />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (step === 'error') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingBox}>
          <Text style={styles.errorIcon}>⚠️</Text>
          <Text style={styles.errorTitle}>Scan failed</Text>
          <Text style={styles.errorMsg}>{errorMsg}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => navigation.goBack()}>
            <Text style={styles.retryBtnText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Photo + grid overlay (grid mode only) */}
        {!isSequential && imageUri && (
          <View style={styles.photoContainer}>
            <Image source={{ uri: imageUri }} style={styles.photo} resizeMode="cover" />
            <View style={styles.gridOverlay}>
              {Array.from({ length: gridRows }).map((_, r) =>
                Array.from({ length: gridCols }).map((_, c) => (
                  <View
                    key={`${r}-${c}`}
                    style={[styles.gridOverlayCell, {
                      width: `${100 / gridCols}%`, height: `${100 / gridRows}%`,
                      left: `${(c / gridCols) * 100}%`, top: `${(r / gridRows) * 100}%`,
                    }]}
                  />
                ))
              )}
            </View>
          </View>
        )}

        {isSequential && (
          <View style={styles.seqHeader}>
            <Text style={styles.seqHeaderText}>
              📸 Sequential scan · {identifiedParts.length} pieces confirmed
            </Text>
          </View>
        )}

        {/* Stats */}
        <View style={styles.summaryRow}>
          <View style={styles.summaryChip}>
            <Text style={styles.summaryNum}>{identifiedParts.length}</Text>
            <Text style={styles.summaryLabel}>unique parts{'\n'}identified</Text>
          </View>
          <View style={styles.summaryChip}>
            <Text style={styles.summaryNum}>{rankedSets.length}</Text>
            <Text style={styles.summaryLabel}>matching{'\n'}sets found</Text>
          </View>
          <View style={styles.summaryChip}>
            <Text style={styles.summaryNum}>{isSequential ? '📸' : `${gridRows}×${gridCols}`}</Text>
            <Text style={styles.summaryLabel}>{isSequential ? 'sequential' : 'grid\nused'}</Text>
          </View>
        </View>

        {/* Add to Collection button */}
        <TouchableOpacity
          style={[styles.collectionBtn, addedToCollection && styles.collectionBtnDone]}
          onPress={handleAddToCollection}
          disabled={addedToCollection}
        >
          <Text style={styles.collectionBtnText}>
            {addedToCollection ? `✓ Added ${identifiedParts.length} parts to Collection` : `+ Add ${identifiedParts.length} Parts to Collection`}
          </Text>
        </TouchableOpacity>

        {/* Identified parts chips */}
        <Text style={styles.sectionLabel}>Identified Parts</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.partsScroll}>
          {identifiedParts.map((p) => (
            <View key={p.id} style={styles.partChip}>
              {p.img_url ? (
                <Image source={{ uri: p.img_url }} style={styles.partChipImg} resizeMode="contain" />
              ) : null}
              <Text style={styles.partChipId}>#{p.id}</Text>
              <Text style={styles.partChipName} numberOfLines={1}>{p.name || '—'}</Text>
            </View>
          ))}
        </ScrollView>

        {/* Ranked sets */}
        <Text style={styles.sectionLabel}>Best Matching Sets</Text>
        {rankedSets.map((item, i) => (
          <RankedSetCard
            key={item.set.set_num}
            item={item}
            rank={i + 1}
            isTracked={trackedSet === item.set.set_num}
            onTrack={() => handleTrackSet(item.set)}
            onViewProgress={() => navigation.navigate('SetProgress', { set: item.set })}
          />
        ))}

        {rankedSets.length === 0 && (
          <Text style={styles.empty}>No matching sets found for the identified parts.</Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function RankedSetCard({ item, rank, isTracked, onTrack, onViewProgress }) {
  const pct = Math.round(item.score * 100);
  const isTopMatch = rank === 1;

  return (
    <View style={[styles.setCard, isTopMatch && styles.setCardTop]}>
      {isTopMatch && (
        <View style={styles.topBadge}>
          <Text style={styles.topBadgeText}>Best Match</Text>
        </View>
      )}
      <View style={styles.setCardRow}>
        <Text style={styles.rankNum}>#{rank}</Text>
        {item.set.set_img_url ? (
          <Image source={{ uri: item.set.set_img_url }} style={styles.setImg} resizeMode="contain" />
        ) : (
          <View style={[styles.setImg, styles.setImgPlaceholder]}>
            <Text style={{ fontSize: 22 }}>🧱</Text>
          </View>
        )}
        <View style={styles.setInfo}>
          <Text style={styles.setName} numberOfLines={2}>{item.set.name}</Text>
          <Text style={styles.setMeta}>#{item.set.set_num} · {item.set.year} · {item.set.num_parts} parts</Text>
          <View style={styles.matchRow}>
            <View style={styles.matchBarBg}>
              <View style={[styles.matchBarFill, { width: `${pct}%` }]} />
            </View>
            <Text style={styles.matchPct}>{item.matchedParts}/{item.totalIdentified} ({pct}%)</Text>
          </View>
          <View style={styles.setActions}>
            <TouchableOpacity
              style={[styles.setActionBtn, isTracked && styles.setActionBtnActive]}
              onPress={onTrack}
              disabled={isTracked}
            >
              <Text style={[styles.setActionBtnText, isTracked && styles.setActionBtnTextActive]}>
                {isTracked ? '✓ Tracked' : '+ Track'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.setActionBtn} onPress={onViewProgress}>
              <Text style={styles.setActionBtnText}>View Progress →</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111' },
  scroll: { paddingBottom: spacing.xl },
  loadingBox: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    padding: spacing.xl, gap: spacing.md, backgroundColor: '#111',
  },
  loadingStep: { color: '#fff', fontSize: 16, fontWeight: '600' },
  loadingProgress: { color: colors.textSecondary, fontSize: 14 },
  progressBar: {
    width: '80%', height: 6, backgroundColor: '#333',
    borderRadius: 3, overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: colors.secondary, borderRadius: 3 },
  photoContainer: { width: '100%', height: 220, position: 'relative' },
  photo: { width: '100%', height: '100%' },
  gridOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  gridOverlayCell: { position: 'absolute', borderWidth: 1, borderColor: colors.secondary },
  seqHeader: {
    backgroundColor: '#1a1a1a', padding: spacing.md,
    borderBottomWidth: 1, borderBottomColor: '#333',
  },
  seqHeaderText: { color: colors.secondary, fontWeight: '600', fontSize: 14, textAlign: 'center' },
  summaryRow: { flexDirection: 'row', backgroundColor: '#1a1a1a', paddingVertical: spacing.md },
  summaryChip: { flex: 1, alignItems: 'center' },
  summaryNum: { fontSize: 24, fontWeight: '900', color: colors.secondary },
  summaryLabel: { fontSize: 11, color: '#888', textAlign: 'center', lineHeight: 16 },
  collectionBtn: {
    margin: spacing.md, backgroundColor: '#2a2a2a', paddingVertical: spacing.sm,
    borderRadius: radius.full, alignItems: 'center',
    borderWidth: 1.5, borderColor: colors.secondary,
  },
  collectionBtnDone: { borderColor: colors.success, backgroundColor: 'rgba(46,125,50,0.15)' },
  collectionBtnText: { color: colors.secondary, fontWeight: '700', fontSize: 14 },
  sectionLabel: {
    fontSize: 12, fontWeight: '700', color: '#888',
    textTransform: 'uppercase', letterSpacing: 1,
    paddingHorizontal: spacing.md, paddingTop: spacing.lg, paddingBottom: spacing.sm,
  },
  partsScroll: { paddingLeft: spacing.md, marginBottom: spacing.xs },
  partChip: {
    backgroundColor: '#1a1a1a', borderRadius: radius.md, padding: spacing.sm,
    marginRight: spacing.sm, alignItems: 'center', width: 80,
    borderWidth: 1, borderColor: '#333',
  },
  partChipImg: { width: 48, height: 48, marginBottom: 4 },
  partChipId: { color: colors.secondary, fontSize: 11, fontWeight: '700' },
  partChipName: { color: '#888', fontSize: 10, textAlign: 'center' },
  setCard: {
    backgroundColor: '#1a1a1a', marginHorizontal: spacing.md, marginBottom: spacing.sm,
    borderRadius: radius.md, overflow: 'hidden', borderWidth: 1, borderColor: '#333',
  },
  setCardTop: { borderColor: colors.secondary },
  topBadge: { backgroundColor: colors.secondary, paddingHorizontal: spacing.md, paddingVertical: 3, alignSelf: 'flex-start' },
  topBadgeText: { fontSize: 11, fontWeight: '900', color: '#111', letterSpacing: 0.5 },
  setCardRow: { flexDirection: 'row', alignItems: 'flex-start', padding: spacing.sm },
  rankNum: { color: '#555', fontWeight: '800', fontSize: 16, width: 30, textAlign: 'center', paddingTop: 4 },
  setImg: { width: 72, height: 72, backgroundColor: '#222', borderRadius: radius.sm },
  setImgPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  setInfo: { flex: 1, paddingLeft: spacing.sm },
  setName: { fontSize: 14, fontWeight: '700', color: '#fff', marginBottom: 2 },
  setMeta: { fontSize: 12, color: '#888', marginBottom: spacing.xs },
  matchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.xs },
  matchBarBg: { flex: 1, height: 5, backgroundColor: '#333', borderRadius: 3, overflow: 'hidden' },
  matchBarFill: { height: '100%', backgroundColor: colors.secondary, borderRadius: 3 },
  matchPct: { fontSize: 11, color: colors.secondary, fontWeight: '700', minWidth: 80 },
  setActions: { flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' },
  setActionBtn: {
    borderWidth: 1, borderColor: '#444', borderRadius: radius.sm,
    paddingHorizontal: spacing.sm, paddingVertical: 4,
  },
  setActionBtnActive: { borderColor: colors.success, backgroundColor: 'rgba(46,125,50,0.2)' },
  setActionBtnText: { fontSize: 11, color: '#aaa', fontWeight: '600' },
  setActionBtnTextActive: { color: colors.success },
  empty: { textAlign: 'center', color: '#666', padding: spacing.xl, lineHeight: 22 },
  errorIcon: { fontSize: 48 },
  errorTitle: { fontSize: 20, fontWeight: '700', color: '#fff' },
  errorMsg: { color: '#888', textAlign: 'center', lineHeight: 22 },
  retryBtn: {
    backgroundColor: colors.primary, paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl, borderRadius: radius.full, marginTop: spacing.sm,
  },
  retryBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
