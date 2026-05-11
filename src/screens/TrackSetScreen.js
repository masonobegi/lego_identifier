import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  StyleSheet, SafeAreaView, Image, ActivityIndicator, Keyboard, Alert,
} from 'react-native';
import { searchSets } from '../services/rebrickable';
import { addTrackedSet, getTrackedSets } from '../services/collection';
import { colors, spacing, radius, shadows, typography } from '../constants/theme';

export default function TrackSetScreen({ navigation }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [tracked, setTracked] = useState({}); // setNum -> true
  const [error, setError] = useState('');

  async function handleSearch() {
    if (!query.trim()) return;
    Keyboard.dismiss();
    setLoading(true);
    setError('');
    try {
      const sets = await searchSets(query.trim());
      setResults(sets);
      setSearched(true);
      // Check which ones are already tracked
      const existing = await getTrackedSets();
      const map = {};
      existing.forEach((s) => { map[s.set_num] = true; });
      setTracked(map);
    } catch (e) {
      setError('Search failed. Make sure your API key is set up in Settings.');
    } finally {
      setLoading(false);
    }
  }

  async function handleTrack(set) {
    await addTrackedSet(set);
    setTracked((prev) => ({ ...prev, [set.set_num]: true }));
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.searchRow}>
        <TextInput
          style={styles.input}
          placeholder="Search by name or set number"
          placeholderTextColor={colors.textSecondary}
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={handleSearch}
          returnKeyType="search"
        />
        <TouchableOpacity style={styles.searchBtn} onPress={handleSearch}>
          <Text style={styles.searchBtnText}>Go</Text>
        </TouchableOpacity>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {loading ? (
        <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.primary} size="large" />
      ) : (
        <FlatList
          data={results}
          keyExtractor={(item) => item.set_num}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <Text style={styles.empty}>
              {searched
                ? 'No sets found. Try a different search.'
                : 'Search for any LEGO set to start tracking your progress toward completing it.'}
            </Text>
          }
          renderItem={({ item }) => {
            const isTracked = tracked[item.set_num];
            return (
              <View style={styles.setCard}>
                {item.set_img_url ? (
                  <Image source={{ uri: item.set_img_url }} style={styles.setImg} resizeMode="contain" />
                ) : (
                  <View style={[styles.setImg, styles.setImgPlaceholder]}>
                    <Text style={{ fontSize: 26 }}>🧱</Text>
                  </View>
                )}
                <View style={styles.setInfo}>
                  <Text style={styles.setName} numberOfLines={2}>{item.name}</Text>
                  <Text style={styles.setMeta}>#{item.set_num} · {item.year} · {item.num_parts} parts</Text>
                  <TouchableOpacity
                    style={[styles.trackBtn, isTracked && styles.trackBtnDone]}
                    onPress={() => handleTrack(item)}
                    disabled={isTracked}
                  >
                    <Text style={[styles.trackBtnText, isTracked && styles.trackBtnTextDone]}>
                      {isTracked ? '✓ Tracked' : '+ Track Set'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  searchRow: { flexDirection: 'row', padding: spacing.md, gap: spacing.sm },
  input: {
    flex: 1, backgroundColor: colors.surface, borderWidth: 1.5,
    borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    fontSize: 15, color: colors.text,
  },
  searchBtn: {
    backgroundColor: colors.primary, paddingHorizontal: spacing.lg,
    borderRadius: radius.md, alignItems: 'center', justifyContent: 'center',
  },
  searchBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  list: { padding: spacing.md },
  setCard: {
    flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radius.md,
    overflow: 'hidden', marginBottom: spacing.sm,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07, shadowRadius: 4, elevation: 2,
  },
  setImg: { width: 90, height: 90, backgroundColor: '#f0f0f0' },
  setImgPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  setInfo: { flex: 1, padding: spacing.md, justifyContent: 'center' },
  setName: { fontSize: 14, fontWeight: '700', color: colors.text, marginBottom: 4 },
  setMeta: { fontSize: 12, color: colors.textSecondary, marginBottom: spacing.sm },
  trackBtn: {
    borderWidth: 1.5, borderColor: colors.primary, borderRadius: radius.sm,
    paddingHorizontal: spacing.sm, paddingVertical: 4, alignSelf: 'flex-start',
  },
  trackBtnDone: { borderColor: colors.success, backgroundColor: 'rgba(46,125,50,0.1)' },
  trackBtnText: { fontSize: 12, fontWeight: '700', color: colors.primary },
  trackBtnTextDone: { color: colors.success },
  empty: { textAlign: 'center', color: colors.textSecondary, marginTop: spacing.xl, paddingHorizontal: spacing.xl, lineHeight: 22 },
  error: { color: colors.error, textAlign: 'center', paddingHorizontal: spacing.lg, marginBottom: spacing.sm },
});
