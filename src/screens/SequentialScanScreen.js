import React, { useState, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, SafeAreaView,
  Image, ActivityIndicator, ScrollView, Alert,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { identifyPart } from '../services/brickognize';
import { colors, spacing, radius, shadows, typography } from '../constants/theme';

export default function SequentialScanScreen({ navigation }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [parts, setParts] = useState([]); // accumulated identified parts
  const [preview, setPreview] = useState(null);
  const [identifying, setIdentifying] = useState(false);
  const [lastResult, setLastResult] = useState(null); // { part, error }
  const cameraRef = useRef(null);

  async function takePicture() {
    if (!cameraRef.current) return;
    const photo = await cameraRef.current.takePictureAsync({ quality: 0.85 });
    setPreview(photo.uri);
    await identify(photo.uri);
  }

  async function pickFromLibrary() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
    });
    if (!result.canceled) {
      const uri = result.assets[0].uri;
      setPreview(uri);
      await identify(uri);
    }
  }

  async function identify(uri) {
    setIdentifying(true);
    setLastResult(null);
    try {
      const data = await identifyPart(uri);
      const top = data?.items?.[0];
      if (top) {
        setLastResult({ part: top });
        // Don't auto-add — let user confirm
      } else {
        setLastResult({ error: 'No part identified. Try a different angle or better lighting.' });
      }
    } catch (e) {
      setLastResult({ error: `Failed: ${e.message}` });
    } finally {
      setIdentifying(false);
    }
  }

  function confirmAdd() {
    if (!lastResult?.part) return;
    const part = lastResult.part;
    // Deduplicate — if already in list, increment notionally (we track just unique for set matching)
    setParts((prev) => {
      const exists = prev.find((p) => p.id === part.id);
      if (exists) return prev; // already have it, still counts as one unique part for set scoring
      return [...prev, part];
    });
    setPreview(null);
    setLastResult(null);
  }

  function discardAndRetry() {
    setPreview(null);
    setLastResult(null);
  }

  function handleDone() {
    if (parts.length === 0) {
      Alert.alert('No parts yet', 'Scan at least one piece before finding sets.');
      return;
    }
    navigation.navigate('MultiResults', { identifiedParts: parts });
  }

  function removePart(id) {
    setParts((prev) => prev.filter((p) => p.id !== id));
  }

  if (!permission) return <View style={styles.container} />;

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <Text style={styles.permTitle}>Camera Access Needed</Text>
          <TouchableOpacity style={styles.btn} onPress={requestPermission}>
            <Text style={styles.btnText}>Grant Permission</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Parts tray at top */}
      <View style={styles.tray}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.trayScroll}>
          {parts.length === 0 ? (
            <Text style={styles.trayEmpty}>Confirmed pieces will appear here</Text>
          ) : (
            parts.map((p) => (
              <TouchableOpacity key={p.id} style={styles.trayChip} onLongPress={() => removePart(p.id)}>
                {p.img_url ? (
                  <Image source={{ uri: p.img_url }} style={styles.trayChipImg} resizeMode="contain" />
                ) : (
                  <Text style={{ fontSize: 18 }}>🧱</Text>
                )}
                <Text style={styles.trayChipId}>#{p.id}</Text>
              </TouchableOpacity>
            ))
          )}
        </ScrollView>
        <View style={styles.trayRight}>
          <Text style={styles.trayCount}>{parts.length}</Text>
          <TouchableOpacity
            style={[styles.doneBtn, parts.length === 0 && styles.doneBtnDisabled]}
            onPress={handleDone}
            disabled={parts.length === 0}
          >
            <Text style={styles.doneBtnText}>Find Sets →</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Camera or result overlay */}
      {preview && lastResult ? (
        <View style={styles.resultOverlay}>
          <Image source={{ uri: preview }} style={styles.previewImg} resizeMode="cover" />

          {identifying ? (
            <View style={styles.identifyingBox}>
              <ActivityIndicator color={colors.secondary} />
              <Text style={styles.identifyingText}>Identifying...</Text>
            </View>
          ) : lastResult.error ? (
            <View style={styles.resultBox}>
              <Text style={styles.resultError}>{lastResult.error}</Text>
              <TouchableOpacity style={[styles.btn, styles.btnOutline]} onPress={discardAndRetry}>
                <Text style={[styles.btnText, { color: '#fff' }]}>Try Again</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.resultBox}>
              <View style={styles.resultPartRow}>
                {lastResult.part.img_url ? (
                  <Image source={{ uri: lastResult.part.img_url }} style={styles.resultPartImg} resizeMode="contain" />
                ) : null}
                <View>
                  <Text style={styles.resultPartName}>{lastResult.part.name || lastResult.part.id}</Text>
                  <Text style={styles.resultPartId}>#{lastResult.part.id}</Text>
                  {lastResult.part.score !== undefined && (
                    <Text style={styles.resultConfidence}>
                      {Math.round(lastResult.part.score * 100)}% confidence
                    </Text>
                  )}
                </View>
              </View>
              <View style={styles.resultActions}>
                <TouchableOpacity style={[styles.btn, styles.btnOutline]} onPress={discardAndRetry}>
                  <Text style={[styles.btnText, { color: '#fff' }]}>Discard</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.btn, { flex: 1 }]} onPress={confirmAdd}>
                  <Text style={styles.btnText}>Add Piece ✓</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      ) : (
        <>
          <CameraView ref={cameraRef} style={styles.camera} facing="back">
            <View style={styles.cameraOverlay}>
              <View style={styles.cameraFrame} />
              <Text style={styles.cameraHint}>Photograph one piece at a time</Text>
            </View>
          </CameraView>

          <View style={styles.controls}>
            <TouchableOpacity style={styles.galleryBtn} onPress={pickFromLibrary}>
              <Text style={styles.galleryBtnText}>Gallery</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shutterBtn} onPress={takePicture} disabled={identifying}>
              <View style={[styles.shutterInner, identifying && { backgroundColor: '#aaa' }]} />
            </TouchableOpacity>
            <View style={{ width: 70 }} />
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  tray: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#1a1a1a', paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: '#333',
    minHeight: 70,
  },
  trayScroll: { paddingHorizontal: spacing.sm, gap: spacing.sm, alignItems: 'center' },
  trayEmpty: { color: '#555', fontSize: 13, paddingHorizontal: spacing.md },
  trayChip: {
    backgroundColor: '#2a2a2a', borderRadius: radius.sm,
    padding: spacing.xs, alignItems: 'center', width: 56,
    borderWidth: 1, borderColor: '#444',
  },
  trayChipImg: { width: 36, height: 36 },
  trayChipId: { color: '#888', fontSize: 9, marginTop: 2 },
  trayRight: { paddingRight: spacing.sm, alignItems: 'center', gap: spacing.xs },
  trayCount: { fontSize: 20, fontWeight: '900', color: colors.secondary, minWidth: 28, textAlign: 'center' },
  doneBtn: {
    backgroundColor: colors.secondary, paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs, borderRadius: radius.sm,
  },
  doneBtnDisabled: { backgroundColor: '#333' },
  doneBtnText: { fontSize: 12, fontWeight: '800', color: '#111' },
  camera: { flex: 1 },
  cameraOverlay: { flex: 1, justifyContent: 'flex-end', alignItems: 'center', paddingBottom: spacing.lg },
  cameraFrame: {
    position: 'absolute', top: '10%', left: '10%', right: '10%', bottom: '20%',
    borderWidth: 2, borderColor: colors.secondary, borderRadius: radius.md,
  },
  cameraHint: {
    color: '#fff', backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs,
    borderRadius: radius.full, fontSize: 13,
  },
  controls: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.xl, paddingVertical: spacing.lg, backgroundColor: '#111',
  },
  shutterBtn: {
    width: 72, height: 72, borderRadius: 36,
    borderWidth: 4, borderColor: '#fff', alignItems: 'center', justifyContent: 'center',
  },
  shutterInner: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#fff' },
  galleryBtn: { width: 70, alignItems: 'center' },
  galleryBtnText: { color: '#fff', fontSize: 14 },
  resultOverlay: { flex: 1 },
  previewImg: { width: '100%', height: '55%' },
  identifyingBox: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#111', gap: spacing.sm,
  },
  identifyingText: { color: '#fff', fontSize: 15 },
  resultBox: {
    flex: 1, backgroundColor: '#111', padding: spacing.lg,
    justifyContent: 'center', gap: spacing.md,
  },
  resultPartRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  resultPartImg: {
    width: 72, height: 72, backgroundColor: '#222',
    borderRadius: radius.sm, borderWidth: 1, borderColor: '#333',
  },
  resultPartName: { fontSize: 16, fontWeight: '700', color: '#fff', maxWidth: 200 },
  resultPartId: { fontSize: 13, color: '#888', marginTop: 2 },
  resultConfidence: { fontSize: 12, color: colors.secondary, marginTop: 2 },
  resultError: { color: '#ff6b6b', fontSize: 15, textAlign: 'center' },
  resultActions: { flexDirection: 'row', gap: spacing.sm },
  btn: {
    backgroundColor: colors.primary, paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center',
  },
  btnOutline: { backgroundColor: 'transparent', borderWidth: 2, borderColor: '#555' },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  permTitle: { fontSize: 20, fontWeight: '700', color: '#fff', marginBottom: spacing.lg },
});
