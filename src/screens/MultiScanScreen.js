import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, SafeAreaView, ScrollView,
} from 'react-native';
import { colors, spacing, radius, shadows, typography } from '../constants/theme';

const GRID_OPTIONS = [
  { label: '2 × 2', rows: 2, cols: 2, cells: 4, desc: 'Fast · best for 2-4 pieces' },
  { label: '2 × 3', rows: 2, cols: 3, cells: 6, desc: 'Balanced · best for 4-6 pieces' },
  { label: '3 × 3', rows: 3, cols: 3, cells: 9, desc: 'Thorough · best for 6-9 pieces' },
];

export default function MultiScanScreen({ navigation }) {
  const [mode, setMode] = useState('grid'); // 'grid' | 'sequential'
  const [selectedGrid, setSelectedGrid] = useState(1);

  const grid = GRID_OPTIONS[selectedGrid];

  function launch() {
    if (mode === 'sequential') {
      navigation.navigate('SequentialScan');
    } else {
      navigation.navigate('Camera', {
        mode: 'multiScan',
        gridRows: grid.rows,
        gridCols: grid.cols,
      });
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <Text style={styles.devBadge}>DEV MODE</Text>
          <Text style={styles.title}>Multi-Part Scanner</Text>
          <Text style={styles.desc}>
            Identify multiple pieces and find the best matching sets.
          </Text>
        </View>

        {/* Mode toggle */}
        <Text style={styles.sectionLabel}>Scan Method</Text>
        <View style={styles.modeToggle}>
          <TouchableOpacity
            style={[styles.modeOption, mode === 'grid' && styles.modeOptionActive]}
            onPress={() => setMode('grid')}
            activeOpacity={0.8}
          >
            <Text style={styles.modeOptionIcon}>⊞</Text>
            <Text style={[styles.modeOptionTitle, mode === 'grid' && styles.modeOptionTitleActive]}>
              Grid Split
            </Text>
            <Text style={styles.modeOptionDesc}>
              One photo, split into cells. Fast — single shot.
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.modeOption, mode === 'sequential' && styles.modeOptionActive]}
            onPress={() => setMode('sequential')}
            activeOpacity={0.8}
          >
            <Text style={styles.modeOptionIcon}>📸</Text>
            <Text style={[styles.modeOptionTitle, mode === 'sequential' && styles.modeOptionTitleActive]}>
              Sequential
            </Text>
            <Text style={styles.modeOptionDesc}>
              One piece per photo. More accurate — confirm each piece.
            </Text>
          </TouchableOpacity>
        </View>

        {/* Grid options (only shown in grid mode) */}
        {mode === 'grid' && (
          <>
            <Text style={styles.sectionLabel}>Grid Size</Text>
            <View style={styles.gridOptions}>
              {GRID_OPTIONS.map((opt, i) => (
                <TouchableOpacity
                  key={opt.label}
                  style={[styles.optionCard, selectedGrid === i && styles.optionCardSelected]}
                  onPress={() => setSelectedGrid(i)}
                  activeOpacity={0.8}
                >
                  <GridPreview rows={opt.rows} cols={opt.cols} selected={selectedGrid === i} />
                  <Text style={[styles.optionLabel, selectedGrid === i && styles.optionLabelSelected]}>
                    {opt.label}
                  </Text>
                  <Text style={styles.optionDesc}>{opt.desc}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}

        {/* Info box */}
        <View style={styles.infoBox}>
          {mode === 'grid' ? (
            <>
              <Text style={styles.infoTitle}>Grid Split</Text>
              <Text style={styles.info}>• Single photo split into {grid.cells} cells simultaneously</Text>
              <Text style={styles.info}>• All {grid.cells} cells sent to Brickognize in parallel (~4-6s)</Text>
              <Text style={styles.info}>• Best when pieces are spread out, not stacked or overlapping</Text>
              <Text style={styles.info}>• Pieces on cell boundaries may not identify correctly</Text>
            </>
          ) : (
            <>
              <Text style={styles.infoTitle}>Sequential Scan</Text>
              <Text style={styles.info}>• Photograph one piece at a time</Text>
              <Text style={styles.info}>• Confirm or discard each identification before moving on</Text>
              <Text style={styles.info}>• Tap "Find Sets →" when you've scanned enough pieces</Text>
              <Text style={styles.info}>• More accurate than grid — great for important pieces</Text>
            </>
          )}
        </View>

        <TouchableOpacity style={styles.btn} onPress={launch} activeOpacity={0.85}>
          <Text style={styles.btnText}>
            {mode === 'grid' ? `Start  (${grid.label} grid)` : 'Start Scanning'}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function GridPreview({ rows, cols, selected }) {
  const cells = Array.from({ length: rows * cols });
  return (
    <View style={[styles.gridPreview, { aspectRatio: cols / rows }]}>
      {cells.map((_, i) => (
        <View
          key={i}
          style={[
            styles.gridCell,
            { width: `${100 / cols}%`, height: `${100 / rows}%` },
            selected && styles.gridCellSelected,
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xl },
  header: { alignItems: 'center', marginBottom: spacing.xl },
  devBadge: {
    backgroundColor: '#222', color: colors.secondary, fontSize: 11,
    fontWeight: '900', letterSpacing: 2, paddingHorizontal: spacing.sm,
    paddingVertical: 3, borderRadius: radius.sm, marginBottom: spacing.sm, overflow: 'hidden',
  },
  title: { fontSize: 26, fontWeight: '800', color: colors.text, marginBottom: spacing.sm },
  desc: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', lineHeight: 22 },
  sectionLabel: {
    fontSize: 12, fontWeight: '700', color: colors.textSecondary,
    textTransform: 'uppercase', letterSpacing: 1, marginBottom: spacing.sm,
  },
  modeToggle: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  modeOption: {
    flex: 1, backgroundColor: colors.surface, borderRadius: radius.md,
    padding: spacing.md, borderWidth: 2, borderColor: colors.border,
  },
  modeOptionActive: { borderColor: colors.primary, backgroundColor: '#fff5f5' },
  modeOptionIcon: { fontSize: 28, marginBottom: spacing.xs },
  modeOptionTitle: { fontSize: 15, fontWeight: '800', color: colors.text, marginBottom: 4 },
  modeOptionTitleActive: { color: colors.primary },
  modeOptionDesc: { fontSize: 12, color: colors.textSecondary, lineHeight: 18 },
  gridOptions: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  optionCard: {
    flex: 1, backgroundColor: colors.surface, borderRadius: radius.md,
    padding: spacing.sm, alignItems: 'center', borderWidth: 2, borderColor: colors.border,
  },
  optionCardSelected: { borderColor: colors.primary, backgroundColor: '#fff5f5' },
  optionLabel: { fontWeight: '700', fontSize: 13, color: colors.text, marginTop: spacing.xs },
  optionLabelSelected: { color: colors.primary },
  optionDesc: { fontSize: 10, color: colors.textSecondary, textAlign: 'center', marginTop: 2 },
  gridPreview: {
    width: '100%', flexDirection: 'row', flexWrap: 'wrap',
    borderRadius: radius.sm, overflow: 'hidden',
    borderWidth: 1, borderColor: colors.border,
  },
  gridCell: { borderWidth: 0.5, borderColor: colors.border },
  gridCellSelected: { borderColor: colors.primary, backgroundColor: 'rgba(227,0,11,0.08)' },
  infoBox: {
    backgroundColor: '#1a1a1a', borderRadius: radius.md,
    padding: spacing.lg, marginBottom: spacing.xl, borderLeftWidth: 4, borderLeftColor: colors.secondary,
  },
  infoTitle: { color: colors.secondary, fontWeight: '700', marginBottom: spacing.sm, fontSize: 13 },
  info: { color: '#ccc', fontSize: 13, lineHeight: 22 },
  btn: {
    backgroundColor: '#222', paddingVertical: spacing.md,
    borderRadius: radius.full, alignItems: 'center',
    borderWidth: 2, borderColor: colors.secondary,
  },
  btnText: { color: colors.secondary, fontWeight: '800', fontSize: 16 },
});
