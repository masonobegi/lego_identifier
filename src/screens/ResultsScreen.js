import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, Image,
  ActivityIndicator, TouchableOpacity, ScrollView, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { identifyPart } from '../services/brickognize';
import { getSetInventory, getSetsForPart } from '../services/rebrickable';
import { addPartsToCollection, addTrackedSet } from '../services/collection';
import { colors, spacing, radius, shadows, typography } from '../constants/theme';

export default function ResultsScreen({ navigation, route }) {
  const { imageUri, mode, setNum, setName } = route.params;
  const [status, setStatus] = useState('identifying');
  const [errorMsg, setErrorMsg] = useState('');
  const [identifiedPart, setIdentifiedPart] = useState(null);
  const [results, setResults] = useState([]);
  const [matchCount, setMatchCount] = useState(null);
  const [addedToCollection, setAddedToCollection] = useState(false);

  useEffect(() => { run(); }, []);

  async function run() {
    try {
      setStatus('identifying');
      const brickData = await identifyPart(imageUri);
      const items = brickData?.items;
      if (!items?.length) { setErrorMsg('No LEGO parts identified. Try better lighting or a cleaner background.'); setStatus('error'); return; }
      const topItem = items[0];
      setIdentifiedPart(topItem);
      setStatus('fetching');
      if (mode === 'partFinder') {
        setResults(await getSetsForPart(topItem.id));
      } else {
        const inventory = await getSetInventory(setNum);
        const inventoryIds = new Set(inventory.map((i) => i.part.part_num));
        const matched = items.filter((i) => inventoryIds.has(i.id));
        setMatchCount(matched.length);
        setResults([...matched.map((i) => ({ ...i, inSet: true })), ...items.filter((i) => !inventoryIds.has(i.id)).map((i) => ({ ...i, inSet: false }))]);
      }
      setStatus('done');
    } catch (e) {
      setErrorMsg(e?.response?.status === 401 ? 'API key error — check Settings.' : `Something went wrong: ${e.message}`);
      setStatus('error');
    }
  }

  if (status === 'identifying' || status === 'fetching') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <View style={styles.spinnerWrap}><ActivityIndicator size="large" color={colors.primary} /></View>
          <Text style={styles.loadingTitle}>{status === 'identifying' ? 'Identifying part…' : 'Looking up sets…'}</Text>
          <Text style={styles.loadingSubtitle}>This takes a few seconds</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (status === 'error') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <View style={[styles.spinnerWrap, styles.errorWrap]}><Ionicons name="alert-circle-outline" size={36} color={colors.error} /></View>
          <Text style={styles.errorTitle}>Scan failed</Text>
          <Text style={styles.errorDesc}>{errorMsg}</Text>
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
        <Image source={{ uri: imageUri }} style={styles.photo} resizeMode="cover" />

        {identifiedPart && (
          <View style={styles.partCard}>
            <View style={styles.partCardLeft}>
              {identifiedPart.img_url
                ? <Image source={{ uri: identifiedPart.img_url }} style={styles.partImg} resizeMode="contain" />
                : <View style={[styles.partImg, styles.imgPlaceholder]}><Ionicons name="cube-outline" size={28} color={colors.textTertiary} /></View>
              }
            </View>
            <View style={styles.partCardInfo}>
              <Text style={styles.partCardLabel}>Identified Part</Text>
              <Text style={styles.partCardName}>{identifiedPart.name || identifiedPart.id}</Text>
              <Text style={styles.partCardId}>#{identifiedPart.id}</Text>
              {identifiedPart.score !== undefined && (
                <View style={styles.confidenceRow}>
                  <View style={[styles.confidenceBar, { width: `${Math.round(identifiedPart.score * 100)}%` }]} />
                  <Text style={styles.confidenceText}>{Math.round(identifiedPart.score * 100)}% confidence</Text>
                </View>
              )}
            </View>
            <TouchableOpacity
              style={[styles.addBtn, addedToCollection && styles.addBtnDone]}
              onPress={async () => { await addPartsToCollection([identifiedPart]); setAddedToCollection(true); }}
              disabled={addedToCollection}
            >
              <Ionicons name={addedToCollection ? 'checkmark' : 'add'} size={18} color={addedToCollection ? colors.success : colors.primary} />
            </TouchableOpacity>
          </View>
        )}

        {mode === 'setChecker' && (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{setName}</Text>
            <Text style={styles.sectionSub}>{matchCount} of {results.length} pieces matched</Text>
          </View>
        )}
        {mode === 'partFinder' && (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Sets containing this part</Text>
            <Text style={styles.sectionSub}>{results.length} sets found</Text>
          </View>
        )}

        <View style={styles.resultsList}>
          {mode === 'partFinder'
            ? results.map((set) => <SetCard key={set.set_num} set={set} />)
            : results.map((item) => <PartMatchCard key={item.id} item={item} />)}
          {results.length === 0 && (
            <View style={styles.emptyBox}>
              <Ionicons name="search-outline" size={36} color={colors.textTertiary} />
              <Text style={styles.emptyText}>{mode === 'partFinder' ? 'No sets found for this part.' : 'None matched this set.'}</Text>
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function SetCard({ set }) {
  const [tracked, setTracked] = useState(false);
  return (
    <View style={styles.card}>
      {set.set_img_url
        ? <Image source={{ uri: set.set_img_url }} style={styles.cardImg} resizeMode="contain" />
        : <View style={[styles.cardImg, styles.imgPlaceholder]}><Ionicons name="cube-outline" size={24} color={colors.textTertiary} /></View>
      }
      <View style={styles.cardInfo}>
        <Text style={styles.cardName} numberOfLines={2}>{set.name}</Text>
        <Text style={styles.cardMeta}>#{set.set_num} · {set.year} · {set.num_parts} parts</Text>
        <TouchableOpacity
          style={[styles.trackChip, tracked && styles.trackChipDone]}
          onPress={async () => { await addTrackedSet(set); setTracked(true); }}
          disabled={tracked}
        >
          <Ionicons name={tracked ? 'bookmark' : 'bookmark-outline'} size={11} color={tracked ? colors.success : colors.primary} />
          <Text style={[styles.trackChipText, tracked && styles.trackChipTextDone]}>{tracked ? 'Tracked' : 'Track'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function PartMatchCard({ item }) {
  return (
    <View style={[styles.card, item.inSet ? styles.cardMatchBorder : styles.cardNoMatchBorder]}>
      {item.img_url
        ? <Image source={{ uri: item.img_url }} style={styles.cardImg} resizeMode="contain" />
        : <View style={[styles.cardImg, styles.imgPlaceholder]}><Ionicons name="cube-outline" size={24} color={colors.textTertiary} /></View>
      }
      <View style={styles.cardInfo}>
        <View style={[styles.matchBadge, item.inSet ? styles.matchBadgeGreen : styles.matchBadgeRed]}>
          <Ionicons name={item.inSet ? 'checkmark-circle' : 'close-circle'} size={12} color="#fff" />
          <Text style={styles.matchBadgeText}>{item.inSet ? 'In Set' : 'Not in Set'}</Text>
        </View>
        <Text style={styles.cardName} numberOfLines={1}>{item.name || item.id}</Text>
        <Text style={styles.cardMeta}>#{item.id}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { paddingBottom: spacing.xxl },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md },
  spinnerWrap: { width: 80, height: 80, borderRadius: 40, backgroundColor: colors.errorLight, alignItems: 'center', justifyContent: 'center' },
  errorWrap: { backgroundColor: colors.errorLight },
  loadingTitle: { ...typography.h2 },
  loadingSubtitle: { ...typography.body, color: colors.textSecondary },
  errorTitle: { ...typography.h2 },
  errorDesc: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  retryBtn: { backgroundColor: colors.primary, paddingVertical: spacing.md, paddingHorizontal: spacing.xl, borderRadius: radius.full },
  retryBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  photo: { width: '100%', height: 240 },
  partCard: {
    flexDirection: 'row', alignItems: 'center', margin: spacing.md,
    backgroundColor: colors.surface, borderRadius: radius.md,
    borderWidth: 1.5, borderColor: colors.secondary,
    overflow: 'hidden', ...shadows.md,
  },
  partCardLeft: { backgroundColor: colors.surface2 },
  partImg: { width: 80, height: 80 },
  imgPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  partCardInfo: { flex: 1, padding: spacing.md },
  partCardLabel: { ...typography.label, color: colors.textTertiary, marginBottom: 2 },
  partCardName: { ...typography.bodySmall, fontWeight: '700', color: colors.text },
  partCardId: { fontSize: 11, color: colors.textTertiary, marginTop: 1 },
  confidenceRow: { marginTop: spacing.xs },
  confidenceBar: { height: 3, backgroundColor: colors.success, borderRadius: 2, marginBottom: 2 },
  confidenceText: { fontSize: 10, color: colors.textSecondary, fontWeight: '600' },
  addBtn: { padding: spacing.md, marginRight: spacing.sm },
  addBtnDone: { opacity: 0.6 },
  sectionHeader: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  sectionTitle: { ...typography.h3 },
  sectionSub: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  resultsList: { padding: spacing.md, gap: spacing.sm },
  emptyBox: { alignItems: 'center', padding: spacing.xl, gap: spacing.sm },
  emptyText: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  card: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface,
    borderRadius: radius.md, overflow: 'hidden', ...shadows.sm,
  },
  cardMatchBorder: { borderLeftWidth: 4, borderLeftColor: colors.success },
  cardNoMatchBorder: { borderLeftWidth: 4, borderLeftColor: colors.error, opacity: 0.75 },
  cardImg: { width: 80, height: 80, backgroundColor: colors.surface2 },
  cardInfo: { flex: 1, padding: spacing.md },
  cardName: { ...typography.bodySmall, fontWeight: '600', marginBottom: 2 },
  cardMeta: { fontSize: 11, color: colors.textTertiary },
  matchBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.full, marginBottom: 4 },
  matchBadgeGreen: { backgroundColor: colors.success },
  matchBadgeRed: { backgroundColor: colors.error },
  matchBadgeText: { fontSize: 10, fontWeight: '800', color: '#fff' },
  trackChip: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: spacing.xs, alignSelf: 'flex-start', borderWidth: 1, borderColor: colors.primary, borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  trackChipDone: { borderColor: colors.success },
  trackChipText: { fontSize: 10, fontWeight: '700', color: colors.primary },
  trackChipTextDone: { color: colors.success },
});
