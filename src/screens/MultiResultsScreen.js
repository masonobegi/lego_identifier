import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  Image,
  ActivityIndicator,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { identifyPart } from '../services/brickognize';
import { getSetsForParts } from '../services/rebrickable';
import { splitImageIntoGrid } from '../services/imageGrid';
import { scoreSetsByParts } from '../services/setScorer';
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
  const { imageUri, gridRows, gridCols } = route.params;
  const totalCells = gridRows * gridCols;

  const [step, setStep] = useState('splitting');
  const [errorMsg, setErrorMsg] = useState('');
  const [identifiedParts, setIdentifiedParts] = useState([]);
  const [rankedSets, setRankedSets] = useState([]);
  const [cellsDone, setCellsDone] = useState(0);

  useEffect(() => {
    run();
  }, []);

  async function run() {
    try {
      // 1. Split image into grid crops
      setStep('splitting');
      const crops = await splitImageIntoGrid(imageUri, gridRows, gridCols);

      // 2. Run Brickognize on all crops in parallel, tracking progress
      setStep('identifying');
      setCellsDone(0);
      const identifyResults = await Promise.allSettled(
        crops.map(async (crop) => {
          const result = await identifyPart(crop.uri);
          setCellsDone((n) => n + 1);
          return result;
        })
      );

      // Collect top result from each cell, deduplicate by part ID
      const partMap = {};
      for (const r of identifyResults) {
        if (r.status !== 'fulfilled') continue;
        const items = r.value?.items;
        if (!items || items.length === 0) continue;
        const top = items[0];
        if (!partMap[top.id]) {
          partMap[top.id] = top;
        }
      }

      const parts = Object.values(partMap);
      setIdentifiedParts(parts);

      if (parts.length === 0) {
        setErrorMsg('No LEGO parts could be identified in any grid cell. Try better lighting or a cleaner background.');
        setStep('error');
        return;
      }

      // 3. Fetch sets for all identified parts in parallel
      setStep('fetching');
      const partToSets = await getSetsForParts(parts.map((p) => p.id));

      // 4. Score and rank sets
      setStep('scoring');
      const scored = scoreSetsByParts(partToSets);
      setRankedSets(scored.slice(0, 15)); // top 15

      setStep('done');
    } catch (e) {
      console.error(e);
      setErrorMsg(`Something went wrong: ${e.message}`);
      setStep('error');
    }
  }

  if (step !== 'done' && step !== 'error') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color={colors.secondary} />
          <Text style={styles.loadingStep}>{STEPS[step]}</Text>
          {step === 'identifying' && (
            <Text style={styles.loadingProgress}>
              {cellsDone} / {totalCells} cells processed
            </Text>
          )}
          <View style={styles.progressBar}>
          <View
              style={[
                styles.progressFill,
                {
                  width: step === 'splitting' ? '10%'
                    : step === 'identifying' ? `${10 + (cellsDone / totalCells) * 60}%`
                    : step === 'fetching' ? '80%'
                    : '95%',
                },
              ]}
            />
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
        {/* Photo + grid overlay */}
        <View style={styles.photoContainer}>
          <Image source={{ uri: imageUri }} style={styles.photo} resizeMode="cover" />
          <View style={styles.gridOverlay}>
            {Array.from({ length: gridRows }).map((_, r) =>
              Array.from({ length: gridCols }).map((_, c) => (
                <View
                  key={`${r}-${c}`}
                  style={[
                    styles.gridOverlayCell,
                    {
                      width: `${100 / gridCols}%`,
                      height: `${100 / gridRows}%`,
                      left: `${(c / gridCols) * 100}%`,
                      top: `${(r / gridRows) * 100}%`,
                    },
                  ]}
                />
              ))
            )}
          </View>
        </View>

        {/* Identified parts summary */}
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
            <Text style={styles.summaryNum}>{gridRows}×{gridCols}</Text>
            <Text style={styles.summaryLabel}>grid{'\n'}used</Text>
          </View>
        </View>

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
          <RankedSetCard key={item.set.set_num} item={item} rank={i + 1} />
        ))}

        {rankedSets.length === 0 && (
          <Text style={styles.empty}>No matching sets found for the identified parts.</Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function RankedSetCard({ item, rank }) {
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
            <Text style={styles.matchPct}>
              {item.matchedParts}/{item.totalIdentified} parts ({pct}%)
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#111',
  },
  scroll: {
    paddingBottom: spacing.xl,
  },
  loadingBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.md,
    backgroundColor: '#111',
  },
  loadingStep: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  loadingProgress: {
    color: colors.textSecondary,
    fontSize: 14,
  },
  progressBar: {
    width: '80%',
    height: 6,
    backgroundColor: '#333',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.secondary,
    borderRadius: 3,
  },
  photoContainer: {
    width: '100%',
    height: 220,
    position: 'relative',
  },
  photo: {
    width: '100%',
    height: '100%',
  },
  gridOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  gridOverlayCell: {
    position: 'absolute',
    borderWidth: 1,
    borderColor: colors.secondary,
  },
  summaryRow: {
    flexDirection: 'row',
    backgroundColor: '#1a1a1a',
    paddingVertical: spacing.md,
  },
  summaryChip: {
    flex: 1,
    alignItems: 'center',
  },
  summaryNum: {
    fontSize: 24,
    fontWeight: '900',
    color: colors.secondary,
  },
  summaryLabel: {
    fontSize: 11,
    color: '#888',
    textAlign: 'center',
    lineHeight: 16,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 1,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  partsScroll: {
    paddingLeft: spacing.md,
    marginBottom: spacing.xs,
  },
  partChip: {
    backgroundColor: '#1a1a1a',
    borderRadius: radius.md,
    padding: spacing.sm,
    marginRight: spacing.sm,
    alignItems: 'center',
    width: 80,
    borderWidth: 1,
    borderColor: '#333',
  },
  partChipImg: {
    width: 48,
    height: 48,
    marginBottom: 4,
  },
  partChipId: {
    color: colors.secondary,
    fontSize: 11,
    fontWeight: '700',
  },
  partChipName: {
    color: '#888',
    fontSize: 10,
    textAlign: 'center',
  },
  setCard: {
    backgroundColor: '#1a1a1a',
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    borderRadius: radius.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#333',
  },
  setCardTop: {
    borderColor: colors.secondary,
  },
  topBadge: {
    backgroundColor: colors.secondary,
    paddingHorizontal: spacing.md,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  topBadgeText: {
    fontSize: 11,
    fontWeight: '900',
    color: '#111',
    letterSpacing: 0.5,
  },
  setCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.sm,
  },
  rankNum: {
    color: '#555',
    fontWeight: '800',
    fontSize: 16,
    width: 30,
    textAlign: 'center',
  },
  setImg: {
    width: 72,
    height: 72,
    backgroundColor: '#222',
    borderRadius: radius.sm,
  },
  setImgPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  setInfo: {
    flex: 1,
    paddingLeft: spacing.sm,
  },
  setName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 2,
  },
  setMeta: {
    fontSize: 12,
    color: '#888',
    marginBottom: spacing.xs,
  },
  matchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  matchBarBg: {
    flex: 1,
    height: 5,
    backgroundColor: '#333',
    borderRadius: 3,
    overflow: 'hidden',
  },
  matchBarFill: {
    height: '100%',
    backgroundColor: colors.secondary,
    borderRadius: 3,
  },
  matchPct: {
    fontSize: 11,
    color: colors.secondary,
    fontWeight: '700',
    minWidth: 100,
  },
  empty: {
    textAlign: 'center',
    color: '#666',
    padding: spacing.xl,
    lineHeight: 22,
  },
  errorIcon: { fontSize: 48 },
  errorTitle: { fontSize: 20, fontWeight: '700', color: '#fff' },
  errorMsg: { color: '#888', textAlign: 'center', lineHeight: 22 },
  retryBtn: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.full,
    marginTop: spacing.sm,
  },
  retryBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
