import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, TouchableOpacity,
  ActivityIndicator, Image, Alert,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { searchSets } from '../services/rebrickable';
import { addTrackedSet } from '../services/collection';
import * as Haptics from 'expo-haptics';
import { colors, spacing, radius, shadows, typography } from '../constants/theme';

export default function BarcodeScannerScreen({ navigation }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [searching, setSearching] = useState(false);
  const [foundSets, setFoundSets] = useState(null); // null = not searched, [] = no results
  const [barcodeValue, setBarcodeValue] = useState('');
  const [trackedNums, setTrackedNums] = useState({});

  async function handleBarcode({ data, type }) {
    if (scanned || searching) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setScanned(true);
    setBarcodeValue(data);
    await lookupBarcode(data);
  }

  async function lookupBarcode(value) {
    setSearching(true);
    setFoundSets(null);
    try {
      // Try the raw value first (covers EAN codes that embed set numbers)
      let results = await searchSets(value);

      // If no results, try stripping leading zeros / country prefix from EAN-13
      // LEGO EAN-13 format is often: 50304 + set_num_digits + check_digit
      // Try last 5-6 digits as a fallback query
      if (results.length === 0 && value.length >= 10) {
        const stripped = value.replace(/^0+/, '');
        results = await searchSets(stripped);
      }

      setFoundSets(results.slice(0, 5));
    } catch (e) {
      Alert.alert('Lookup failed', 'Could not search Rebrickable. Check your API key in Settings.');
      setFoundSets([]);
    } finally {
      setSearching(false);
    }
  }

  async function handleTrack(set) {
    await addTrackedSet(set);
    setTrackedNums((prev) => ({ ...prev, [set.set_num]: true }));
  }

  function reset() {
    setScanned(false);
    setFoundSets(null);
    setBarcodeValue('');
    setSearching(false);
  }

  if (!permission) return <View style={styles.container} />;

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <Text style={styles.permTitle}>Camera Access Needed</Text>
          <Text style={styles.permDesc}>Required to scan barcodes on LEGO boxes.</Text>
          <TouchableOpacity style={styles.btn} onPress={requestPermission}>
            <Text style={styles.btnText}>Grant Permission</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {!scanned ? (
        <>
          <CameraView
            style={styles.camera}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'qr'] }}
            onBarcodeScanned={handleBarcode}
          >
            <View style={styles.overlay}>
              <Text style={styles.overlayTop}>Point at the barcode on a LEGO box</Text>
              <View style={styles.scanFrame}>
                <View style={[styles.corner, styles.cornerTL]} />
                <View style={[styles.corner, styles.cornerTR]} />
                <View style={[styles.corner, styles.cornerBL]} />
                <View style={[styles.corner, styles.cornerBR]} />
              </View>
              <Text style={styles.overlayBottom}>EAN-13 · EAN-8 · UPC-A</Text>
            </View>
          </CameraView>
        </>
      ) : (
        <View style={styles.resultContainer}>
          <View style={styles.scannedBadge}>
            <Text style={styles.scannedLabel}>Scanned</Text>
            <Text style={styles.scannedValue}>{barcodeValue}</Text>
          </View>

          {searching ? (
            <View style={styles.center}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={styles.searchingText}>Looking up set...</Text>
            </View>
          ) : foundSets && foundSets.length === 0 ? (
            <View style={styles.center}>
              <Text style={styles.noResultIcon}>🔍</Text>
              <Text style={styles.noResultTitle}>No sets found</Text>
              <Text style={styles.noResultDesc}>
                This barcode didn't match a known set. Try searching manually.
              </Text>
              <TouchableOpacity style={styles.btn} onPress={() => navigation.navigate('TrackSet')}>
                <Text style={styles.btnText}>Search Manually</Text>
              </TouchableOpacity>
            </View>
          ) : foundSets ? (
            <View style={styles.setsContainer}>
              <Text style={styles.setsTitle}>
                {foundSets.length === 1 ? 'Set found!' : `${foundSets.length} possible matches`}
              </Text>
              {foundSets.map((set) => (
                <View key={set.set_num} style={styles.setCard}>
                  {set.set_img_url ? (
                    <Image source={{ uri: set.set_img_url }} style={styles.setImg} resizeMode="contain" />
                  ) : (
                    <View style={[styles.setImg, styles.setImgPlaceholder]}>
                      <Text style={{ fontSize: 24 }}>🧱</Text>
                    </View>
                  )}
                  <View style={styles.setInfo}>
                    <Text style={styles.setName} numberOfLines={2}>{set.name}</Text>
                    <Text style={styles.setMeta}>#{set.set_num} · {set.year} · {set.num_parts} parts</Text>
                    <TouchableOpacity
                      style={[styles.trackBtn, trackedNums[set.set_num] && styles.trackBtnDone]}
                      onPress={() => handleTrack(set)}
                      disabled={!!trackedNums[set.set_num]}
                    >
                      <Text style={[styles.trackBtnText, trackedNums[set.set_num] && styles.trackBtnTextDone]}>
                        {trackedNums[set.set_num] ? '✓ Tracked' : '+ Track Set'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </View>
          ) : null}

          <TouchableOpacity style={styles.scanAgainBtn} onPress={reset}>
            <Text style={styles.scanAgainText}>Scan Another</Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  camera: { flex: 1 },
  overlay: { flex: 1, justifyContent: 'space-between', alignItems: 'center', padding: spacing.xl },
  overlayTop: {
    color: '#fff', fontSize: 14, backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs,
    borderRadius: radius.full, marginTop: spacing.xl,
  },
  scanFrame: {
    width: 280, height: 140,
    position: 'relative',
  },
  corner: {
    position: 'absolute', width: 24, height: 24,
    borderColor: colors.secondary, borderWidth: 3,
  },
  cornerTL: { top: 0, left: 0, borderRightWidth: 0, borderBottomWidth: 0 },
  cornerTR: { top: 0, right: 0, borderLeftWidth: 0, borderBottomWidth: 0 },
  cornerBL: { bottom: 0, left: 0, borderRightWidth: 0, borderTopWidth: 0 },
  cornerBR: { bottom: 0, right: 0, borderLeftWidth: 0, borderTopWidth: 0 },
  overlayBottom: {
    color: 'rgba(255,255,255,0.5)', fontSize: 12,
    marginBottom: spacing.xl,
  },
  resultContainer: { flex: 1, backgroundColor: colors.background },
  scannedBadge: {
    backgroundColor: '#1a1a1a', padding: spacing.md, alignItems: 'center',
    borderBottomWidth: 1, borderBottomColor: '#333',
  },
  scannedLabel: { fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 1 },
  scannedValue: { fontSize: 16, fontWeight: '700', color: colors.secondary, fontFamily: 'monospace' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md },
  searchingText: { color: colors.textSecondary, fontSize: 15 },
  noResultIcon: { fontSize: 48 },
  noResultTitle: { fontSize: 20, fontWeight: '700', color: colors.text },
  noResultDesc: { color: colors.textSecondary, textAlign: 'center', lineHeight: 22 },
  setsContainer: { flex: 1, padding: spacing.md },
  setsTitle: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: spacing.md },
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
  scanAgainBtn: {
    margin: spacing.md, backgroundColor: '#222', borderRadius: radius.full,
    paddingVertical: spacing.md, alignItems: 'center',
    borderWidth: 2, borderColor: colors.secondary,
  },
  scanAgainText: { color: colors.secondary, fontWeight: '700', fontSize: 15 },
  btn: { backgroundColor: colors.primary, paddingVertical: spacing.md, paddingHorizontal: spacing.xl, borderRadius: radius.full },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  permTitle: { fontSize: 20, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },
  permDesc: { color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.lg },
});
