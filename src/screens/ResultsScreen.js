import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  SafeAreaView,
  Image,
  ActivityIndicator,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { identifyPart } from '../services/brickognize';
import { getSetInventory, getSetsForPart, getPartDetails } from '../services/rebrickable';
import { addPartsToCollection, addTrackedSet } from '../services/collection';
import { colors, spacing, radius } from '../constants/theme';

export default function ResultsScreen({ navigation, route }) {
  const { imageUri, mode, setNum, setName } = route.params;
  const [status, setStatus] = useState('identifying');
  const [errorMsg, setErrorMsg] = useState('');
  const [identifiedPart, setIdentifiedPart] = useState(null);
  const [results, setResults] = useState([]);
  const [matchCount, setMatchCount] = useState(null);
  const [totalCount, setTotalCount] = useState(null);
  const [addedToCollection, setAddedToCollection] = useState(false);

  useEffect(() => {
    run();
  }, []);

  async function run() {
    try {
      setStatus('identifying');
      const brickData = await identifyPart(imageUri);
      const items = brickData?.items;

      if (!items || items.length === 0) {
        setErrorMsg('Could not identify any LEGO parts in that photo. Try a clearer photo with better lighting.');
        setStatus('error');
        return;
      }

      const topItem = items[0];
      setIdentifiedPart(topItem);
      setStatus('fetching');

      if (mode === 'partFinder') {
        const sets = await getSetsForPart(topItem.id);
        setResults(sets);
      } else if (mode === 'setChecker') {
        const inventory = await getSetInventory(setNum);
        setTotalCount(inventory.length);

        // Build a set of part IDs from the inventory for quick lookup
        const inventoryIds = new Set(inventory.map((i) => i.part.part_num));

        // Check each identified item against inventory
        const matched = items.filter((item) => inventoryIds.has(item.id));
        const unmatched = items.filter((item) => !inventoryIds.has(item.id));

        setMatchCount(matched.length);
        setResults([
          ...matched.map((i) => ({ ...i, inSet: true })),
          ...unmatched.map((i) => ({ ...i, inSet: false })),
        ]);
      }

      setStatus('done');
    } catch (e) {
      console.error(e);
      setErrorMsg(
        e?.response?.status === 401
          ? 'API key error — check your .env file.'
          : `Something went wrong: ${e.message}`
      );
      setStatus('error');
    }
  }

  if (status === 'identifying' || status === 'fetching') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>
            {status === 'identifying' ? 'Identifying parts...' : 'Looking up set data...'}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (status === 'error') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingBox}>
          <Text style={styles.errorIcon}>⚠️</Text>
          <Text style={styles.errorTitle}>Couldn't complete scan</Text>
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
        {/* Photo preview */}
        <Image source={{ uri: imageUri }} style={styles.photoPreview} resizeMode="cover" />

        {/* Identified part chip */}
        {identifiedPart && (
          <View style={styles.identifiedCard}>
            {identifiedPart.img_url ? (
              <Image
                source={{ uri: identifiedPart.img_url }}
                style={styles.partImg}
                resizeMode="contain"
              />
            ) : null}
            <View style={styles.identifiedInfo}>
              <Text style={styles.identifiedLabel}>Identified Part</Text>
              <Text style={styles.identifiedName}>{identifiedPart.name || identifiedPart.id}</Text>
              <Text style={styles.identifiedId}>#{identifiedPart.id}</Text>
              {identifiedPart.score !== undefined && (
                <Text style={styles.confidence}>
                  Confidence: {Math.round(identifiedPart.score * 100)}%
                </Text>
              )}
              <TouchableOpacity
                style={[styles.addCollectionBtn, addedToCollection && styles.addCollectionBtnDone]}
                onPress={async () => {
                  await addPartsToCollection([identifiedPart]);
                  setAddedToCollection(true);
                }}
                disabled={addedToCollection}
              >
                <Text style={styles.addCollectionBtnText}>
                  {addedToCollection ? '✓ In Collection' : '+ Add to Collection'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Mode-specific header */}
        {mode === 'setChecker' && (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{setName}</Text>
            <Text style={styles.sectionSubtitle}>
              {matchCount} of {results.length} identified pieces are in this set
            </Text>
          </View>
        )}

        {mode === 'partFinder' && (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Sets containing this part</Text>
            <Text style={styles.sectionSubtitle}>{results.length} sets found</Text>
          </View>
        )}

        {/* Results list */}
        {mode === 'partFinder'
          ? results.map((set) => <SetCard key={set.set_num} set={set} navigation={navigation} />)
          : results.map((item) => <PartMatchCard key={item.id} item={item} />)}

        {results.length === 0 && (
          <Text style={styles.empty}>
            {mode === 'partFinder'
              ? 'No sets found for this part.'
              : 'None of the identified pieces matched this set.'}
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function SetCard({ set, navigation }) {
  const [tracked, setTracked] = useState(false);
  return (
    <View style={styles.card}>
      {set.set_img_url ? (
        <Image source={{ uri: set.set_img_url }} style={styles.cardImg} resizeMode="contain" />
      ) : (
        <View style={[styles.cardImg, styles.cardImgPlaceholder]}>
          <Text style={{ fontSize: 24 }}>🧱</Text>
        </View>
      )}
      <View style={styles.cardInfo}>
        <Text style={styles.cardName} numberOfLines={2}>{set.name}</Text>
        <Text style={styles.cardMeta}>#{set.set_num} · {set.year}</Text>
        <Text style={styles.cardMeta}>{set.num_parts} parts</Text>
        <TouchableOpacity
          style={[styles.addCollectionBtn, tracked && styles.addCollectionBtnDone]}
          onPress={async () => { await addTrackedSet(set); setTracked(true); }}
          disabled={tracked}
        >
          <Text style={styles.addCollectionBtnText}>
            {tracked ? '✓ Tracked' : '+ Track Set'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function PartMatchCard({ item }) {
  return (
    <View style={[styles.card, item.inSet ? styles.cardMatch : styles.cardNoMatch]}>
      {item.img_url ? (
        <Image source={{ uri: item.img_url }} style={styles.cardImg} resizeMode="contain" />
      ) : (
        <View style={[styles.cardImg, styles.cardImgPlaceholder]}>
          <Text style={{ fontSize: 24 }}>🧱</Text>
        </View>
      )}
      <View style={styles.cardInfo}>
        <View style={styles.matchBadgeRow}>
          <View style={[styles.matchBadge, item.inSet ? styles.matchBadgeGreen : styles.matchBadgeRed]}>
            <Text style={styles.matchBadgeText}>{item.inSet ? '✓ In Set' : '✗ Not in Set'}</Text>
          </View>
        </View>
        <Text style={styles.cardName} numberOfLines={2}>{item.name || item.id}</Text>
        <Text style={styles.cardMeta}>#{item.id}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
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
  },
  loadingText: {
    color: colors.textSecondary,
    fontSize: 16,
    marginTop: spacing.sm,
  },
  photoPreview: {
    width: '100%',
    height: 220,
  },
  identifiedCard: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    margin: spacing.md,
    borderRadius: radius.md,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: colors.secondary,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 3,
  },
  partImg: {
    width: 80,
    height: 80,
    backgroundColor: '#f5f5f5',
  },
  identifiedInfo: {
    flex: 1,
    padding: spacing.md,
    justifyContent: 'center',
  },
  identifiedLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 2,
  },
  identifiedName: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  identifiedId: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  confidence: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  sectionHeader: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.text,
  },
  sectionSubtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  card: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    borderRadius: radius.md,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  cardMatch: {
    borderLeftWidth: 4,
    borderLeftColor: colors.success,
  },
  cardNoMatch: {
    borderLeftWidth: 4,
    borderLeftColor: colors.error,
    opacity: 0.7,
  },
  cardImg: {
    width: 80,
    height: 80,
    backgroundColor: '#f0f0f0',
  },
  cardImgPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardInfo: {
    flex: 1,
    padding: spacing.md,
    justifyContent: 'center',
  },
  cardName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 2,
  },
  cardMeta: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  matchBadgeRow: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  matchBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.full,
  },
  matchBadgeGreen: {
    backgroundColor: colors.success,
  },
  matchBadgeRed: {
    backgroundColor: colors.error,
  },
  matchBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  empty: {
    textAlign: 'center',
    color: colors.textSecondary,
    padding: spacing.xl,
    lineHeight: 22,
  },
  errorIcon: {
    fontSize: 48,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
  },
  errorMsg: {
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  retryBtn: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.full,
    marginTop: spacing.sm,
  },
  retryBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },
  addCollectionBtn: {
    marginTop: spacing.xs,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  addCollectionBtnDone: {
    borderColor: colors.success,
    backgroundColor: 'rgba(46,125,50,0.1)',
  },
  addCollectionBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.primary,
  },
});
