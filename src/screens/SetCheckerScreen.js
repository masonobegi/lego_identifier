import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  SafeAreaView,
  Image,
  ActivityIndicator,
  Keyboard,
} from 'react-native';
import { searchSets } from '../services/rebrickable';
import { colors, spacing, radius } from '../constants/theme';

export default function SetCheckerScreen({ navigation }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
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
    } catch (e) {
      setError('Search failed. Check your API key in .env');
    } finally {
      setLoading(false);
    }
  }

  function selectSet(set) {
    navigation.navigate('Camera', {
      mode: 'setChecker',
      setNum: set.set_num,
      setName: set.name,
    });
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.searchRow}>
        <TextInput
          style={styles.input}
          placeholder="Search sets (e.g. Millennium Falcon)"
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
            searched ? (
              <Text style={styles.empty}>No sets found. Try a different search.</Text>
            ) : (
              <Text style={styles.empty}>Search for a LEGO set above, then select it to scan your pieces.</Text>
            )
          }
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.setCard} onPress={() => selectSet(item)} activeOpacity={0.8}>
              {item.set_img_url ? (
                <Image source={{ uri: item.set_img_url }} style={styles.setImg} resizeMode="contain" />
              ) : (
                <View style={[styles.setImg, styles.setImgPlaceholder]}>
                  <Text style={{ fontSize: 28 }}>🧱</Text>
                </View>
              )}
              <View style={styles.setInfo}>
                <Text style={styles.setName} numberOfLines={2}>{item.name}</Text>
                <Text style={styles.setMeta}>
                  #{item.set_num} · {item.year} · {item.num_parts} parts
                </Text>
              </View>
            </TouchableOpacity>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  searchRow: {
    flexDirection: 'row',
    padding: spacing.md,
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 15,
    color: colors.text,
  },
  searchBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
  list: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  setCard: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 4,
    elevation: 2,
    marginBottom: spacing.sm,
  },
  setImg: {
    width: 90,
    height: 90,
    backgroundColor: '#f0f0f0',
  },
  setImgPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  setInfo: {
    flex: 1,
    padding: spacing.md,
    justifyContent: 'center',
  },
  setName: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 4,
  },
  setMeta: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  empty: {
    textAlign: 'center',
    color: colors.textSecondary,
    marginTop: spacing.xl,
    paddingHorizontal: spacing.xl,
    lineHeight: 22,
  },
  error: {
    color: colors.error,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
});
