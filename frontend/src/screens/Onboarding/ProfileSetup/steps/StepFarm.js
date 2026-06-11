// ── Step 4 · Farm details — land, crops, soil, water (all optional) ──────────
import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import StepperInput from '../components/StepperInput';
import ChipSelect from '../components/ChipSelect';
import { useOnbTheme } from '../theme';
import { useT } from '../strings';
import { CROPS, SOILS, IRRIGATIONS, LAND } from '../options';
import { vs } from '../../../../utils/responsive';

/**
 * @param {object} props
 * @param {number} props.landAcres
 * @param {(n:number)=>void} props.onChangeLand
 * @param {string[]} props.cropTypes
 * @param {(v:string[])=>void} props.onChangeCrops
 * @param {string} props.soilType
 * @param {(v:string)=>void} props.onChangeSoil
 * @param {string} props.irrigationType
 * @param {(v:string)=>void} props.onChangeIrrigation
 */
export default function StepFarm({
  landAcres, onChangeLand,
  cropTypes, onChangeCrops,
  soilType, onChangeSoil,
  irrigationType, onChangeIrrigation,
}) {
  const theme = useOnbTheme();
  const t = useT();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  return (
    <View style={styles.wrap}>
      <Section label={t('onb.landLabel')} styles={styles}>
        <StepperInput
          value={landAcres}
          onChange={onChangeLand}
          min={LAND.min}
          max={LAND.max}
          step={LAND.step}
          unitLabel={t('onb.acres')}
        />
      </Section>

      <Section label={t('onb.cropLabel')} hint={t('onb.cropHint')} styles={styles}>
        <ChipSelect mode="multi" options={CROPS} value={cropTypes} onChange={onChangeCrops} columns={3} showCount />
      </Section>

      <Section label={t('onb.soilLabel')} styles={styles}>
        <ChipSelect mode="single" options={SOILS} value={soilType} onChange={onChangeSoil} columns={3} />
      </Section>

      <Section label={t('onb.irrigationLabel')} styles={styles}>
        <ChipSelect mode="single" options={IRRIGATIONS} value={irrigationType} onChange={onChangeIrrigation} columns={3} />
      </Section>
    </View>
  );
}

function Section({ label, hint, children, styles }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel} maxFontSizeMultiplier={1.5}>{label}</Text>
      {hint ? <Text style={styles.sectionHint} maxFontSizeMultiplier={1.5}>{hint}</Text> : null}
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function makeStyles(t) {
  return StyleSheet.create({
    wrap: { gap: vs(t.space.xxl) },
    section: { gap: vs(t.space.xs) },
    sectionLabel: { ...t.text.bodyStrong, color: t.textPrimary },
    sectionHint: { ...t.text.helper, color: t.textTertiary },
    sectionBody: { marginTop: vs(t.space.md) },
  });
}
