import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, FlatList, Image,
  ActivityIndicator, TouchableOpacity, Alert, Share, Linking,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { getSetInventory } from '../services/rebrickable';
import { getCollection, addTrackedSet, removeTrackedSet, calculateSetProgress } from '../services/collection';
import { colors, spacing, radius, shadows, typography, gradients } from '../constants/theme';

function buildBrickLinkXml(missingParts) {
  const items = missingParts.map((entry) => {
    const colorId = entry.color?.external_ids?.BrickLink?.ext_ids?.[0] ?? '';
    return ['  <ITEM>', '    <ITEMTYPE>P</ITEMTYPE>', `    <ITEMID>${entry.part.part_num}</ITEMID>`,
      colorId ? `    <COLOR>${colorId}</COLOR>` : '', `    <MINQTY>${entry.stillNeed}</MINQTY>`, '    <CONDITION>X</CONDITION>', '  </ITEM>',
    ].filter(Boolean).join('\n');
  }).join('\n');
  return `<INVENTORY>\n${items}\n</INVENTORY>`;
}

// Simple arc-based circular progress using View border trick
function CircularProgress({ pct, size = 100 }) {
  const color = pct >= 100 ? colors.success : pct >= 60 ? colors.primary : colors.warning;
  return (
    <View style={[styles.circleWrap, { width: size, height: size }]}>
      <View style={[styles.circleTrack, { width: size, height: size, borderRadius: size / 2, borderColor: colors.border }]} />
      <View style={styles.circleCenter}>
        <Text style={[styles.circlePct, { color, fontSize: size * 0.26 }]}>{pct}%</Text>
        <Text style={styles.circleLabel}>complete</Text>
      </View>
    </View>
  );
}

export default function SetProgressScreen({ route, navigation }) {
  const { set } = route.params;
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(null);
  const [isTracked, setIsTracked] = useState(false);
  const [filter, setFilter] = useState('missing');

  useEffect(() => { navigation.setOptions({ title: set.name }); load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const [inventory, collection] = await Promise.all([getSetInventory(set.set_num), getCollection()]);
      setProgress(calculateSetProgress(inventory, collection));
    } catch { Alert.alert('Error', 'Could not load set inventory.'); }
    finally { setLoading(false); }
  }

  async function toggleTrack() {
    if (isTracked) { await removeTrackedSet(set.set_num); setIsTracked(false); }
    else { await addTrackedSet(set); setIsTracked(true); }
  }

  function handleBrickLink() {
    if (!progress?.missing.length) return;
    Alert.alert('Find Missing Parts', `Export ${progress.missing.length} parts for BrickLink`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Copy XML', onPress: async () => { await Clipboard.setStringAsync(buildBrickLinkXml(progress.missing)); Alert.alert('Copied!', 'Paste into BrickLink → Wanted List → Upload'); } },
      { text: 'Open BrickLink', onPress: () => Linking.openURL('https://www.bricklink.com/v2/wanted/upload.page') },
    ]);
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /><Text style={styles.loadingText}>Loading inventory...</Text></View>
      </SafeAreaView>
    );
  }

  if (!progress) return null;

  return (
    <SafeAreaView style={styles.container}>
      {/* Hero card */}
      <View style={styles.hero}>
        {set.set_img_url && <Image source={{ uri: set.set_img_url }} style={styles.heroImg} resizeMode="contain" />}
        <View style={styles.heroInfo}>
          <Text style={styles.heroName} numberOfLines={2}>{set.name}</Text>
          <Text style={styles.heroMeta}>#{set.set_num} · {set.year} · {set.num_parts} parts</Text>
          <View style={styles.progressBarTrack}>
            <View style={[styles.progressBarFill, {
              width: `${progress.pct}%`,
              backgroundColor: progress.pct >= 100 ? colors.success : colors.primary,
            }]} />
          </View>
          <Text style={[styles.progressLabel, { color: progress.pct >= 100 ? colors.success : colors.primary }]}>
            {progress.pct >= 100 ? '🎉 Complete!' : `${progress.owned} / ${progress.total} parts · ${progress.pct}%`}
          </Text>
        </View>
      </View>

      {/* Actions */}
      <View style={styles.actionRow}>
        <TouchableOpacity style={[styles.actionBtn, isTracked && styles.actionBtnActive]} onPress={toggleTrack}>
          <Ionicons name={isTracked ? 'bookmark' : 'bookmark-outline'} size={16} color={isTracked ? '#fff' : colors.primary} />
          <Text style={[styles.actionBtnText, isTracked && styles.actionBtnTextActive]}>{isTracked ? 'Tracked' : 'Track Set'}</Text>
        </TouchableOpacity>
        {progress.missing.length > 0 && (
          <TouchableOpacity style={styles.brickLinkBtn} onPress={handleBrickLink}>
            <Ionicons name="cart-outline" size={16} color="#fff" />
            <Text style={styles.brickLinkBtnText}>BrickLink</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Filter tabs */}
      <View style={styles.filterRow}>
        {[
          { key: 'missing', label: `Missing (${progress.missing.length})` },
          { key: 'all', label: `All Parts (${progress.total})` },
        ].map((f) => (
          <TouchableOpacity key={f.key} style={[styles.filterTab, filter === f.key && styles.filterTabActive]} onPress={() => setFilter(f.key)}>
            <Text style={[styles.filterTabText, filter === f.key && styles.filterTabTextActive]}>{f.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={filter === 'missing' ? progress.missing : null}
        keyExtractor={(item) => `${item.part.part_num}-${item.color?.id}`}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          filter === 'missing' && progress.missing.length === 0
            ? <View style={styles.center}><Ionicons name="checkmark-circle" size={56} color={colors.success} /><Text style={styles.completeTitle}>Complete!</Text><Text style={styles.completeDesc}>You have all the parts for this set.</Text></View>
            : null
        }
        renderItem={({ item }) => (
          <View style={styles.partRow}>
            {item.part.part_img_url
              ? <Image source={{ uri: item.part.part_img_url }} style={styles.partImg} resizeMode="contain" />
              : <View style={[styles.partImg, styles.imgPlaceholder]}><Ionicons name="cube-outline" size={20} color={colors.textTertiary} /></View>
            }
            <View style={styles.partInfo}>
              <Text style={styles.partName} numberOfLines={1}>{item.part.name}</Text>
              <Text style={styles.partMeta}>#{item.part.part_num}{item.color ? ` · ${item.color.name}` : ''}</Text>
            </View>
            <View style={styles.needBadge}>
              <Text style={styles.needHave}>Have {item.have}</Text>
              <Text style={styles.needNeed}>Need {item.stillNeed}</Text>
            </View>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
  loadingText: { ...typography.body, color: colors.textSecondary },
  hero: {
    flexDirection: 'row', backgroundColor: colors.surface, padding: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border, ...shadows.sm,
  },
  heroImg: { width: 100, height: 100, backgroundColor: colors.surface2, borderRadius: radius.sm },
  heroInfo: { flex: 1, paddingLeft: spacing.md, justifyContent: 'center' },
  heroName: { ...typography.h3, marginBottom: 2 },
  heroMeta: { fontSize: 11, color: colors.textTertiary, marginBottom: spacing.sm },
  progressBarTrack: { height: 8, backgroundColor: colors.border, borderRadius: 4, overflow: 'hidden', marginBottom: 4 },
  progressBarFill: { height: '100%', borderRadius: 4 },
  progressLabel: { fontSize: 12, fontWeight: '700' },
  circleWrap: { alignItems: 'center', justifyContent: 'center' },
  circleTrack: { position: 'absolute', borderWidth: 8 },
  circleCenter: { alignItems: 'center' },
  circlePct: { fontWeight: '900' },
  circleLabel: { fontSize: 10, color: colors.textTertiary, fontWeight: '600' },
  actionRow: { flexDirection: 'row', gap: spacing.sm, padding: spacing.md },
  actionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
    borderWidth: 1.5, borderColor: colors.primary, borderRadius: radius.full, paddingVertical: spacing.sm,
  },
  actionBtnActive: { backgroundColor: colors.primary },
  actionBtnText: { color: colors.primary, fontWeight: '700', fontSize: 14 },
  actionBtnTextActive: { color: '#fff' },
  brickLinkBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
    backgroundColor: '#0053A0', borderRadius: radius.full, paddingVertical: spacing.sm, paddingHorizontal: spacing.lg,
  },
  brickLinkBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  filterRow: { flexDirection: 'row', backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  filterTab: { flex: 1, paddingVertical: spacing.md, alignItems: 'center' },
  filterTabActive: { borderBottomWidth: 2.5, borderBottomColor: colors.primary },
  filterTabText: { fontSize: 13, fontWeight: '600', color: colors.textTertiary },
  filterTabTextActive: { color: colors.primary },
  list: { padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.xxl },
  completeTitle: { ...typography.h2, color: colors.success },
  completeDesc: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  partRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface,
    borderRadius: radius.md, overflow: 'hidden', ...shadows.sm,
  },
  partImg: { width: 60, height: 60, backgroundColor: colors.surface2 },
  imgPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  partInfo: { flex: 1, paddingHorizontal: spacing.sm },
  partName: { ...typography.bodySmall, fontWeight: '600' },
  partMeta: { fontSize: 11, color: colors.textTertiary, marginTop: 2 },
  needBadge: { paddingRight: spacing.md, alignItems: 'flex-end' },
  needHave: { fontSize: 11, color: colors.success, fontWeight: '700' },
  needNeed: { fontSize: 11, color: colors.error, fontWeight: '700' },
});
