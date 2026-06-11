// ── Step 1 · Identity — optional photo + required name ───────────────────────
import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { TriangleAlert } from 'lucide-react-native';
import AvatarPicker from '../components/AvatarPicker';
import { useOnbTheme } from '../theme';
import { useT } from '../strings';
import { s, vs } from '../../../../utils/responsive';

/**
 * @param {object} props
 * @param {{uri:string|null,uploading:boolean,progress:number,error:boolean}} props.photo
 * @param {(asset:object)=>void} props.onPickPhoto
 * @param {() => void} props.onRemovePhoto
 * @param {string} props.name
 * @param {(v:string)=>void} props.onChangeName
 * @param {string|null} props.nameError
 */
export default function StepIdentity({ photo, onPickPhoto, onRemovePhoto, name, onChangeName, nameError }) {
  const theme = useOnbTheme();
  const t = useT();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [focused, setFocused] = useState(false);

  return (
    <View style={styles.wrap}>
      <AvatarPicker
        uri={photo.uri}
        uploading={photo.uploading}
        progress={photo.progress}
        error={photo.error}
        onPick={onPickPhoto}
        onRemove={onRemovePhoto}
      />

      <View style={styles.field}>
        <Text style={styles.label}>{t('onb.nameLabel')}</Text>
        <TextInput
          style={[styles.input, focused && styles.inputFocused, nameError && styles.inputError]}
          value={name}
          onChangeText={onChangeName}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={t('onb.namePlaceholder')}
          placeholderTextColor={theme.textPlaceholder}
          autoCapitalize="words"
          returnKeyType="done"
          selectionColor={theme.primary}
          maxFontSizeMultiplier={1.5}
          accessibilityLabel={t('onb.nameLabel')}
          accessibilityHint={nameError || undefined}
        />
        {nameError ? (
          <View style={styles.errorRow} accessibilityLiveRegion="assertive">
            <TriangleAlert size={s(14)} color={theme.error} strokeWidth={2.25} />
            <Text style={styles.errorText}>{nameError}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function makeStyles(t) {
  return StyleSheet.create({
    wrap: { gap: vs(t.space.xxl) },
    field: { gap: vs(t.space.sm) },
    label: { ...t.text.label, color: t.textSecondary },
    input: {
      ...t.text.body,
      color: t.textPrimary,
      minHeight: Math.max(vs(56), t.tap + 8),
      borderWidth: 1.5, borderColor: t.border, borderRadius: t.radius.md,
      backgroundColor: t.surfaceAlt,
      paddingHorizontal: s(t.space.base), paddingVertical: vs(t.space.md),
    },
    inputFocused: { borderColor: t.borderFocus, backgroundColor: t.surfaceFocus },
    inputError: { borderColor: t.error },
    errorRow: { flexDirection: 'row', alignItems: 'center', gap: s(t.space.xs) },
    errorText: { ...t.text.helper, color: t.error, flex: 1 },
  });
}
