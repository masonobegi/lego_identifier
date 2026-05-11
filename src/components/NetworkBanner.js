import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography } from '../constants/theme';

export default function NetworkBanner() {
  const [isOffline, setIsOffline] = useState(false);
  const [wasOffline, setWasOffline] = useState(false);
  const [showBack, setShowBack] = useState(false);
  const slideAnim = React.useRef(new Animated.Value(-60)).current;

  useEffect(() => {
    const unsub = NetInfo.addEventListener((state) => {
      const offline = !state.isConnected || !state.isInternetReachable;
      setIsOffline((prev) => {
        if (!offline && prev) {
          // Just came back online
          setShowBack(true);
          setTimeout(() => setShowBack(false), 3000);
        }
        return offline;
      });
    });
    return unsub;
  }, []);

  const visible = isOffline || showBack;

  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: visible ? 0 : -60,
      useNativeDriver: true,
      tension: 80,
      friction: 10,
    }).start();
  }, [visible]);

  if (!visible && slideAnim._value === -60) return null;

  return (
    <Animated.View style={[styles.banner, showBack && styles.bannerBack, { transform: [{ translateY: slideAnim }] }]}>
      <Ionicons
        name={showBack ? 'wifi-outline' : 'cloud-offline-outline'}
        size={16}
        color="#fff"
      />
      <Text style={styles.text}>
        {showBack ? 'Back online' : 'No internet connection'}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: '#1a1a1a',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  bannerBack: {
    backgroundColor: colors.success,
  },
  text: {
    ...typography.caption,
    color: '#fff',
    letterSpacing: 0.3,
  },
});
