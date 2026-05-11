import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Alert,
  Image,
  ActivityIndicator,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors, spacing, radius, shadows, typography } from '../constants/theme';

const FLASH_MODES = ['off', 'on', 'auto'];
const FLASH_ICONS = { off: 'flash-off-outline', on: 'flash-outline', auto: 'flash-outline' };

export default function CameraScreen({ navigation, route }) {
  const { mode, setNum, setName, gridRows, gridCols } = route.params || {};
  const [permission, requestPermission] = useCameraPermissions();
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [flash, setFlash] = useState('off');
  const cameraRef = useRef(null);

  function cycleFlash() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setFlash((f) => FLASH_MODES[(FLASH_MODES.indexOf(f) + 1) % FLASH_MODES.length]);
  }

  async function takePicture() {
    if (!cameraRef.current) return;
    const photo = await cameraRef.current.takePictureAsync({ quality: 0.85 });
    setPreview(photo.uri);
  }

  async function pickFromLibrary() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
    });
    if (!result.canceled) {
      setPreview(result.assets[0].uri);
    }
  }

  async function confirm() {
    if (!preview) return;
    setLoading(true);
    try {
      if (mode === 'multiScan') {
        navigation.navigate('MultiResults', { imageUri: preview, gridRows, gridCols });
      } else {
        navigation.navigate('Results', { imageUri: preview, mode, setNum, setName });
      }
    } finally {
      setLoading(false);
    }
  }

  if (!permission) return <View style={styles.container} />;

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.permissionBox}>
          <Text style={styles.permissionTitle}>Camera Access Needed</Text>
          <Text style={styles.permissionDesc}>
            We need camera access to photograph your LEGO pieces.
          </Text>
          <TouchableOpacity style={styles.btn} onPress={requestPermission}>
            <Text style={styles.btnText}>Grant Permission</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (preview) {
    return (
      <SafeAreaView style={styles.container}>
        <Image source={{ uri: preview }} style={styles.preview} resizeMode="cover" />
        <View style={styles.previewActions}>
          <TouchableOpacity
            style={[styles.btn, styles.btnOutline]}
            onPress={() => setPreview(null)}
          >
            <Text style={[styles.btnText, styles.btnTextOutline]}>Retake</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btn, { flex: 1 }]}
            onPress={confirm}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.btnText}>Analyze</Text>
            )}
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {mode === 'setChecker' && setName && (
        <View style={styles.contextBadge}>
          <Text style={styles.contextText}>Checking: {setName}</Text>
        </View>
      )}

      <CameraView ref={cameraRef} style={styles.camera} facing="back" flash={flash}>
        <View style={styles.overlay}>
          {/* Flash toggle */}
          <TouchableOpacity style={styles.flashBtn} onPress={cycleFlash}>
            <Ionicons name={FLASH_ICONS[flash]} size={22} color={flash === 'on' ? colors.secondary : '#fff'} />
            <Text style={[styles.flashLabel, flash === 'on' && { color: colors.secondary }]}>
              {flash.toUpperCase()}
            </Text>
          </TouchableOpacity>
          <View style={styles.frame} />
          <Text style={styles.hint}>
            {mode === 'setChecker'
              ? 'Photograph your pile of pieces'
              : mode === 'multiScan'
              ? `Spread out your pieces · ${gridRows}×${gridCols} grid`
              : 'Photograph a single LEGO piece'}
          </Text>
        </View>
      </CameraView>

      <View style={styles.controls}>
        <TouchableOpacity style={styles.galleryBtn} onPress={pickFromLibrary}>
          <Ionicons name="images-outline" size={22} color="#fff" />
          <Text style={styles.galleryBtnText}>Gallery</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.shutterBtn} onPress={takePicture}>
          <View style={styles.shutterInner} />
        </TouchableOpacity>
        <View style={{ width: 70 }} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  camera: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingBottom: spacing.lg,
  },
  flashBtn: {
    position: 'absolute',
    top: spacing.lg,
    right: spacing.lg,
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  flashLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: 'rgba(255,255,255,0.7)',
    marginTop: 1,
  },
  frame: {
    position: 'absolute',
    top: '15%',
    left: '10%',
    right: '10%',
    bottom: '20%',
    borderWidth: 2,
    borderColor: colors.secondary,
    borderRadius: radius.md,
  },
  hint: {
    color: '#fff',
    backgroundColor: colors.overlay,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    fontSize: 14,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    backgroundColor: '#111',
  },
  shutterBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#fff',
  },
  galleryBtn: {
    width: 70,
    alignItems: 'center',
  },
  galleryBtnText: {
    color: '#fff',
    fontSize: 14,
  },
  preview: {
    flex: 1,
  },
  previewActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: '#111',
  },
  btn: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnOutline: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: '#fff',
  },
  btnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },
  btnTextOutline: {
    color: '#fff',
  },
  permissionBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  permissionTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#fff',
    marginBottom: spacing.sm,
  },
  permissionDesc: {
    color: '#aaa',
    textAlign: 'center',
    marginBottom: spacing.lg,
    lineHeight: 22,
  },
  contextBadge: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
  },
  contextText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 13,
  },
});
