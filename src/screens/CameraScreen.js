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
import { colors, spacing, radius } from '../constants/theme';

export default function CameraScreen({ navigation, route }) {
  const { mode, setNum, setName } = route.params || {};
  const [permission, requestPermission] = useCameraPermissions();
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const cameraRef = useRef(null);

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
      navigation.navigate('Results', { imageUri: preview, mode, setNum, setName });
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

      <CameraView ref={cameraRef} style={styles.camera} facing="back">
        <View style={styles.overlay}>
          <View style={styles.frame} />
          <Text style={styles.hint}>
            {mode === 'setChecker'
              ? 'Photograph your pile of pieces'
              : 'Photograph a single LEGO piece'}
          </Text>
        </View>
      </CameraView>

      <View style={styles.controls}>
        <TouchableOpacity style={styles.galleryBtn} onPress={pickFromLibrary}>
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
