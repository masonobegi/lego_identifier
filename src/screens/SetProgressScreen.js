import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, FlatList, Image,
  ActivityIndicator, TouchableOpacity, Alert,
} from 'react-native';
import { getSetInventory } from '../services/rebrickable';
import { getCollection, addTrackedSet, removeTrackedSet, calculateSetProgress } from '../services/collection';
import { colors, spacing, radius } from '../constants/theme';

export default function SetProgressScreen({ route, navigation }) {
  const { set } = route.params;
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(null);
  const [isTracked, setIsTracked] = useState(false);
  const [filter, setFilter] = useState('missing'); // 'all' | 'owned' | 'missing'

  useEffect(() => {
    navigation.setOptions({ title: set.name });
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const [inventory, collection] = await Promise.all([
        getSetInventory(set.set_num),
        getCollection(),
      ]);
      setProgress(calculateSetProgress(inventory, collection));
    } catch (e) {
      Alert.alert('Error', 'Could not load set inventory.');
    } finally {
      setLoading(false);
    }
  }

  async function toggleTrack() {
    if (isTracked) {
      await removeTrackedSet(set.set_num);
      setIsTracked(false);
    } else {
      await addTrackedSet(set);
      setIsTracked(true);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading set inventory...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!progress) return null;

  const filteredMissing = filter === 'all'
    ? null
    : filter === 'missing'
    ? progress.missing
    : null;

  return (
    <SafeAreaView style={styles.container}>
      {/* Progress header */}
      <View style={styles.progressHeader}>
        {set.set_img_url ? (
          <Image source={{ uri: set.set_img_url }} style={styles.setImg} resizeMode="contain" />
        ) : null}
        <View style={styles.progressInfo}>
          <Text style={styles.setName} numberOfLines={2}>{set.name}</Text>
          <Text style={styles.setMeta}>#{set.set_num} · {set.year}</Text>
          <View style={styles.bigProgressBar}>
            <View style={[styles.bigProgressFill, { width: `${progress.pct}%` }]} />
          </View>
          <Text style={styles.progressLabel}>
            {progress.owned} / {progress.total} parts · {progress.pct}% complete
          </Text>
        </View>
      </View>

      <TouchableOpacity
        style={[styles.trackBtn, isTracked && styles.trackBtnActive]}
        onPress={toggleTrack}
      >
        <Text style={[styles.trackBtnText, isTracked && styles.trackBtnTextActive]}>
          {isTracked ? '✓ Tracked' : '+ Track this Set'}
        </Text>
      </TouchableOpacity>

      {/* Filter tabs */}
      <View style={styles.filterRow}>
        {['missing', 'all'].map((f) => (
          <TouchableOpacity
            key={f}
            style={[styles.filterBtn, filter === f && styles.filterBtnActive]}
            onPress={() => setFilter(f)}
          >
            <Text style={[styles.filterBtnText, filter === f && styles.filterBtnTextActive]}>
              {f === 'missing' ? `Missing (${progress.missing.length})` : `All (${progress.total})`}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={filter === 'missing' ? progress.missing : null}
        keyExtractor={(item) => `${item.part.part_num}-${item.color?.id}`}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          filter === 'missing' && progress.missing.length === 0 ? (
            <View style={styles.completeBox}>
              <Text style={styles.completeIcon}>🎉</Text>
              <Text style={styles.completeTitle}>Complete!</Text>
              <Text style={styles.completeDesc}>You have all the parts for this set.</Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <View style={styles.partRow}>
            {item.part.part_img_url ? (
              <Image source={{ uri: item.part.part_img_url }} style={styles.partImg} resizeMode="contain" />
            ) : (
              <View style={[styles.partImg, styles.partImgPlaceholder]}>
                <Text style={{ fontSize: 18 }}>🧱</Text>
              </View>
            )}
            <View style={styles.partInfo}>
              <Text style={styles.partName} numberOfLines={1}>{item.part.name}</Text>
              <Text style={styles.partMeta}>#{item.part.part_num}</Text>
              {item.color && <Text style={styles.partColor}>{item.color.name}</Text>}
            </View>
            <View style={styles.needBadge}>
              <Text style={styles.needHave}>Have {item.have}</Text>
              <Text style={styles.needNeed}>Need {item.stillNeed} more</Text>
            </View>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  loadingText: { color: colors.textSecondary, fontSize: 15 },
  progressHeader: {
    flexDirection: 'row', padding: spacing.md, backgroundColor: colors.surface,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  setImg: { width: 100, height: 100, backgroundColor: '#f0f0f0', borderRadius: radius.sm },
  progressInfo: { flex: 1, paddingLeft: spacing.md, justifyContent: 'center' },
  setName: { fontSize: 15, fontWeight: '700', color: colors.text, marginBottom: 2 },
  setMeta: { fontSize: 12, color: colors.textSecondary, marginBottom: spacing.sm },
  bigProgressBar: {
    height: 10, backgroundColor: colors.border, borderRadius: 5,
    overflow: 'hidden', marginBottom: 4,
  },
  bigProgressFill: { height: '100%', backgroundColor: colors.success, borderRadius: 5 },
  progressLabel: { fontSize: 13, fontWeight: '600', color: colors.success },
  trackBtn: {
    margin: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.full,
    borderWidth: 2, borderColor: colors.primary, alignItems: 'center',
  },
  trackBtnActive: { backgroundColor: colors.primary },
  trackBtnText: { color: colors.primary, fontWeight: '700', fontSize: 14 },
  trackBtnTextActive: { color: '#fff' },
  filterRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border },
  filterBtn: { flex: 1, paddingVertical: spacing.md, alignItems: 'center' },
  filterBtnActive: { borderBottomWidth: 3, borderBottomColor: colors.primary },
  filterBtnText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  filterBtnTextActive: { color: colors.primary },
  list: { padding: spacing.md },
  completeBox: { alignItems: 'center', paddingTop: 60 },
  completeIcon: { fontSize: 52, marginBottom: spacing.md },
  completeTitle: { fontSize: 22, fontWeight: '800', color: colors.success, marginBottom: spacing.xs },
  completeDesc: { fontSize: 14, color: colors.textSecondary },
  partRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface,
    borderRadius: radius.md, marginBottom: spacing.sm, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 2, elevation: 1,
  },
  partImg: { width: 56, height: 56, backgroundColor: '#f0f0f0' },
  partImgPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  partInfo: { flex: 1, paddingHorizontal: spacing.sm },
  partName: { fontSize: 13, fontWeight: '600', color: colors.text },
  partMeta: { fontSize: 11, color: colors.textSecondary },
  partColor: { fontSize: 11, color: colors.textSecondary, fontStyle: 'italic' },
  needBadge: { paddingRight: spacing.md, alignItems: 'flex-end' },
  needHave: { fontSize: 11, color: colors.success, fontWeight: '600' },
  needNeed: { fontSize: 11, color: colors.error, fontWeight: '600' },
});
