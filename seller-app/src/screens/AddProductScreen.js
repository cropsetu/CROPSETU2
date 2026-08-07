/**
 * AddProductScreen — create / edit a listing.
 *
 * Payload, endpoints and field names are unchanged.
 *
 * THE FORM HAS A SHAPE NOW
 * ------------------------
 * This is the longest form in the app and the one sellers abandon. Three
 * things were added to make the distance legible instead of infinite:
 *
 *   1. A progress card at the top counting the five REQUIRED fields — not the
 *      thirty optional ones. It answers "how much of this actually matters"
 *      before the seller starts scrolling, and it turns green the moment the
 *      listing is publishable, which is the only threshold that matters.
 *   2. Every section is numbered "01 / 05" in its head. A numbered section is
 *      a landmark; an unnumbered one is more form.
 *   3. Each section head states in one line what the section is for, so a
 *      seller can skip "Highlights & specifications" with confidence rather
 *      than reading four fields to discover it is optional.
 *
 * The photo grid was rebuilt around the fact that photos are the single
 * highest-leverage thing on a listing: the tiles are large, the first one is
 * marked as the cover (it is what a buyer sees in search), and upload state is
 * drawn ON the tile it belongs to rather than as a sentence somewhere below.
 *
 * WHAT ELSE THIS SCREEN ALREADY FIXED, AND STILL DOES:
 *
 *   - VALIDATION. It used to be a chain of `Alert.alert` calls that reported one
 *     problem at a time — and on web, where Alert is a no-op, reported nothing
 *     at all: tapping Save on an invalid form did visibly nothing. Errors are
 *     now inline, per field, all at once, and the form scrolls to the first one.
 *   - IMAGE UPLOADS. Five images were uploaded in a sequential loop with no
 *     progress; a failure on image 4 discarded the three already uploaded and
 *     failed the whole save, so retrying re-uploaded everything. Successful
 *     uploads are now cached by URI, so a retry only sends what is missing, and
 *     progress is visible per image.
 *   - PERMISSIONS. `launchImageLibraryAsync` was called without ever requesting
 *     or checking permission; a denial just returned `canceled`, which looked
 *     identical to the user backing out. Permission is now requested, and a
 *     permanent denial explains how to fix it in Settings.
 *   - Camera capture is offered alongside the library.
 *   - Leaving with unsaved edits asks first.
 *   - Save is blocked (with an explanation) while offline rather than failing
 *     after a 15-second timeout.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Image, KeyboardAvoidingView, Linking, Platform,
  Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@cropsetu/shared/context/AuthContext';
import { useLanguage } from '@cropsetu/shared/context/LanguageContext';
import api, { safeErrorMessage } from '@cropsetu/shared/services/api';
import { compressImage } from '@cropsetu/shared/utils/mediaCompressor';
import { DISTRICT_LIST, getTalukas, SELLING_SCOPES } from '@cropsetu/shared/constants/locations';
import { SUBCATEGORIES_MAP } from '@cropsetu/shared/constants/categories';

import { C, E, R, SP, T, alpha, useResponsive } from '../theme';
import { useNetwork } from '../hooks/useNetwork';
import useUnsavedChanges from '../hooks/useUnsavedChanges';
import {
  Screen, ActionBar, Button, IconButton, Field, TextField, CharCount,
  Chip, ChipGroup, OptionRow, FormSection, SelectSheet, InlineNotice,
  Card, ProgressBar, Badge,
  useConfirm, useToast,
} from '../components/ui';

const UNITS = ['kg', 'quintal', 'gram', 'litre', 'ml', 'piece', 'bag', 'packet', 'bundle', 'acre', 'dozen'];
const MAX_IMAGES = 5;
const MAX_NAME = 120;
const MAX_DESC = 2000;
/** Sections in the form, in scroll order. Drives the "01 / 05" counters. */
const TOTAL_SECTIONS = 5;

/**
 * The fields that decide whether this listing can go live at all. The progress
 * meter counts ONLY these — a meter that also counted `manufacturer` and
 * `harvestDate` would sit at 40% on a perfectly publishable listing and read
 * as "you are not done".
 */
function requiredProgress(form) {
  const done = [
    !!form.categoryId,
    form.name.trim().length >= 3,
    Number(form.price) > 0,
    form.stock.trim() !== '' && Number(form.stock) >= 0,
    !!form.district,
  ].filter(Boolean).length;
  return { done, total: 5, percent: Math.round((done / 5) * 100) };
}

// ── Validation ───────────────────────────────────────────────────────────────

/**
 * Pure: form values in, `{ field: message }` out. Kept separate from the
 * component so the rules are readable in one place and every rule fires on the
 * same pass — the old sequential Alerts stopped at the first failure, so a
 * seller with three problems had to submit three times to find them all.
 */
function validate(form, t) {
  const errors = {};

  if (!form.categoryId) {
    errors.categoryId = t('products.selectCategoryMsg');
  }

  const name = form.name.trim();
  if (!name) errors.name = t('products.productNameRequired');
  else if (name.length < 3) {
    errors.name = t('products.nameTooShort', 'Use at least 3 characters so buyers can find it.');
  }

  const price = Number(form.price);
  if (!form.price.trim()) errors.price = t('products.validPrice');
  else if (!Number.isFinite(price) || price <= 0) errors.price = t('products.validPrice');
  else if (price > 10_000_000) {
    errors.price = t('products.priceTooHigh', 'That price looks wrong. Please check it.');
  }

  if (form.mrp.trim()) {
    const mrp = Number(form.mrp);
    if (!Number.isFinite(mrp) || mrp < 0) {
      errors.mrp = t('products.validMrp', 'Enter a valid MRP, or leave it blank.');
    } else if (Number.isFinite(price) && mrp > 0 && mrp < price) {
      // Selling above MRP is not legal retail practice, and buyers see the
      // strikethrough as an increase — worth catching before it goes live.
      errors.mrp = t('products.mrpBelowPrice', 'MRP cannot be less than your selling price.');
    }
  }

  const stock = Number(form.stock);
  if (!form.stock.trim()) errors.stock = t('products.validStock');
  else if (!Number.isFinite(stock) || stock < 0) errors.stock = t('products.validStock');
  else if (!Number.isInteger(stock)) {
    errors.stock = t('products.stockWhole', 'Stock must be a whole number.');
  }

  if (form.moq.trim()) {
    const moq = Number(form.moq);
    if (!Number.isFinite(moq) || moq < 1 || !Number.isInteger(moq)) {
      errors.moq = t('products.validMoq', 'Minimum order must be a whole number of 1 or more.');
    } else if (Number.isFinite(stock) && stock > 0 && moq > stock) {
      errors.moq = t('products.moqOverStock', 'Minimum order cannot be more than your stock.');
    }
  }

  if (!form.district) errors.district = t('products.selectDistrictMsg');

  return errors;
}

// ── Image tile ───────────────────────────────────────────────────────────────

/**
 * One photo. Upload state is drawn on the tile — a scrim plus a spinner while
 * it uploads, a red scrim plus a warning glyph when it failed — so a seller
 * can see *which* of five photos is the problem. The first tile is marked
 * "Cover", because that is the one that appears in buyer search results and
 * nothing else in the UI ever said so.
 */
function ImageTile({ uri, onRemove, status, label, isCover, coverLabel, uploadingLabel, failedLabel }) {
  const uploading = status === 'uploading';
  const failed = status === 'failed';

  return (
    <View
      style={s.imgWrap}
      accessible
      accessibilityLabel={[
        isCover ? coverLabel : null,
        uploading ? uploadingLabel : null,
        failed ? failedLabel : null,
      ].filter(Boolean).join('. ') || undefined}
    >
      <Image
        source={{ uri }}
        style={s.imgThumb}
        resizeMode="cover"
        accessibilityIgnoresInvertColors
        accessible={false}
      />

      {uploading || failed ? (
        <View style={[s.imgOverlay, failed && { backgroundColor: alpha(C.dangerBold, 0.62) }]}>
          {uploading
            ? <ActivityIndicator color={C.onBrand} />
            : <Ionicons name="alert-circle" size={26} color={C.onBrand} />}
        </View>
      ) : null}

      {isCover && !uploading && !failed ? (
        <View style={s.imgCover} importantForAccessibility="no">
          <Text style={s.imgCoverTxt} numberOfLines={1}>{coverLabel}</Text>
        </View>
      ) : null}

      <IconButton
        icon="close"
        size={16}
        color={C.onBrand}
        background={C.text}
        onPress={onRemove}
        accessibilityLabel={label}
        style={s.imgRemove}
        buttonStyle={s.imgRemoveBtn}
      />
    </View>
  );
}

// ── Screen ───────────────────────────────────────────────────────────────────

export default function AddProductScreen({ route, navigation }) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const toast = useToast();
  const confirm = useConfirm();
  const { isOffline } = useNetwork();
  const { gutter, isExpanded, contentMaxWidth } = useResponsive();

  const editProduct = route.params?.product || null;
  const isEdit = !!editProduct;

  // ── Form state ─────────────────────────────────────────────────────────────
  const [form, setForm] = useState(() => ({
    categoryId: editProduct?.categoryId || '',
    subcategory: editProduct?.subcategory || '',
    name: editProduct?.name || '',
    desc: editProduct?.description || '',
    price: editProduct?.price?.toString() || '',
    mrp: editProduct?.mrp?.toString() || '',
    unit: editProduct?.unit || 'kg',
    stock: editProduct?.stock?.toString() || '',
    moq: editProduct?.minOrderQty?.toString() || '1',
    tags: editProduct?.tags?.join(', ') || '',
    harvestDate: editProduct?.harvestDate || '',
    brand: editProduct?.brand || '',
    manufacturer: editProduct?.manufacturer || '',
    countryOfOrigin: editProduct?.countryOfOrigin || 'India',
    district: editProduct?.district || user?.district || '',
    taluka: editProduct?.taluka || user?.taluka || '',
    village: editProduct?.village || user?.village || '',
    sellScope: editProduct?.sellScope || 'district',
  }));

  const [highlights, setHighlights] = useState(() => (
    editProduct?.highlights?.length ? [...editProduct.highlights] : ['']
  ));

  const [specPairs, setSpecPairs] = useState(() => {
    const specs = editProduct?.specifications;
    if (specs && typeof specs === 'object' && Object.keys(specs).length > 0) {
      return Object.entries(specs).map(([k, v]) => ({ key: k, value: String(v) }));
    }
    return [{ key: '', value: '' }];
  });

  const [images, setImages] = useState(() => editProduct?.images || []); // remote urls
  const [localImgs, setLocalImgs] = useState([]);                        // [{ uri }]

  const [errors, setErrors] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadState, setUploadState] = useState({});   // uri -> 'uploading'|'failed'
  const [uploadProgress, setUploadProgress] = useState(null); // { done, total }

  // Successful uploads survive a failed save, so a retry re-sends only what is
  // still missing instead of paying for every image again.
  const uploadedCache = useRef(new Map());              // localUri -> remote url

  // ── Categories ─────────────────────────────────────────────────────────────
  const [categories, setCategories] = useState([]);
  const [catsLoading, setCatsLoading] = useState(true);
  const [catsError, setCatsError] = useState(null);

  const fetchCategories = useCallback(async () => {
    setCatsLoading(true);
    setCatsError(null);
    try {
      const { data } = await api.get('/agristore/categories');
      const listRaw = data?.data ?? data ?? [];
      setCategories(Array.isArray(listRaw) ? listRaw : []);
    } catch (e) {
      setCatsError({ message: safeErrorMessage(e, t('products.catsError')) });
    } finally {
      setCatsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    navigation.setOptions({
      title: isEdit ? t('products.updateProduct') : t('products.listProduct'),
    });
    fetchCategories();
  }, [fetchCategories, isEdit, navigation, t]);

  // ── Field updates ──────────────────────────────────────────────────────────
  const dirtyRef = useRef(false);

  const setField = useCallback((key) => (value) => {
    dirtyRef.current = true;
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      // Changing the parent invalidates the child selection.
      if (key === 'categoryId' && value !== prev.categoryId) next.subcategory = '';
      if (key === 'district' && value !== prev.district) next.taluka = '';
      return next;
    });
    // Clear a field's error the moment the user edits it — leaving red text
    // under a field they just fixed reads as "still wrong".
    setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
  }, []);

  // Live re-validation, but only after the first submit attempt. Validating
  // while someone types their first character is hostile.
  useEffect(() => {
    if (!submitted) return;
    setErrors(validate(form, t));
  }, [form, submitted, t]);

  const isDirty = dirtyRef.current || localImgs.length > 0
    || images.length !== (editProduct?.images?.length || 0);

  const confirmDiscard = useCallback(() => confirm({
    title: t('products.discardTitle', 'Discard changes?'),
    message: t('products.discardMsg', 'Your edits to this listing will be lost.'),
    confirmLabel: t('products.discard', 'Discard'),
    cancelLabel: t('products.keepEditing', 'Keep editing'),
    destructive: true,
    icon: 'trash-outline',
  }), [confirm, t]);

  const { allowNext } = useUnsavedChanges(isDirty && !saving, confirmDiscard);

  // ── Scroll-to-error ────────────────────────────────────────────────────────
  const scrollRef = useRef(null);
  const fieldY = useRef({});
  const registerY = useCallback((key) => (y) => { fieldY.current[key] = y; }, []);

  const scrollToFirstError = useCallback((errs) => {
    const order = ['categoryId', 'name', 'price', 'mrp', 'stock', 'moq', 'district'];
    const first = order.find((k) => errs[k]);
    if (!first) return;
    const y = fieldY.current[first];
    if (typeof y === 'number') {
      scrollRef.current?.scrollTo({ y: Math.max(0, y - 24), animated: true });
    }
  }, []);

  // ── Images ─────────────────────────────────────────────────────────────────
  const allImages = useMemo(() => [
    ...images.map((u) => ({ uri: u, local: false })),
    ...localImgs.map((img) => ({ uri: img.uri, local: true })),
  ], [images, localImgs]);

  const remainingSlots = MAX_IMAGES - allImages.length;

  /**
   * Ask for permission, and tell the user what to do when the OS will no longer
   * show the prompt (`canAskAgain: false`) — otherwise the picker silently does
   * nothing forever and looks like a broken button.
   */
  const ensurePermission = useCallback(async (kind) => {
    const request = kind === 'camera'
      ? ImagePicker.requestCameraPermissionsAsync
      : ImagePicker.requestMediaLibraryPermissionsAsync;

    const result = await request();
    if (result.granted) return true;

    if (result.canAskAgain === false) {
      const open = await confirm({
        title: t('products.permissionTitle', 'Permission needed'),
        message: kind === 'camera'
          ? t('products.cameraDeniedMsg', 'Allow camera access in Settings to photograph your products.')
          : t('products.photosDeniedMsg', 'Allow photo access in Settings to upload product images.'),
        confirmLabel: t('products.openSettings', 'Open Settings'),
        cancelLabel: t('cancel'),
        icon: 'lock-closed-outline',
      });
      if (open) Linking.openSettings?.().catch(() => {});
    } else {
      toast.warning(
        kind === 'camera'
          ? t('products.cameraDenied', 'Camera access was denied.')
          : t('products.photosDenied', 'Photo access was denied.'),
      );
    }
    return false;
  }, [confirm, t, toast]);

  const addAssets = useCallback((assets) => {
    if (!assets?.length) return;
    dirtyRef.current = true;
    setLocalImgs((prev) => {
      const room = MAX_IMAGES - (images.length + prev.length);
      return [...prev, ...assets.slice(0, Math.max(0, room)).map((a) => ({ uri: a.uri }))];
    });
  }, [images.length]);

  const pickFromLibrary = useCallback(async () => {
    if (remainingSlots <= 0) {
      toast.warning(t('products.limitMsg'));
      return;
    }
    if (!(await ensurePermission('library'))) return;

    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: 'images',
        allowsMultipleSelection: true,
        quality: 0.8,
        selectionLimit: remainingSlots,
      });
      if (!result.canceled) addAssets(result.assets);
    } catch (e) {
      toast.error(t('products.pickerError', 'Could not open your photos. Please try again.'));
    }
  }, [remainingSlots, ensurePermission, addAssets, toast, t]);

  const takePhoto = useCallback(async () => {
    if (remainingSlots <= 0) {
      toast.warning(t('products.limitMsg'));
      return;
    }
    if (!(await ensurePermission('camera'))) return;

    try {
      const result = await ImagePicker.launchCameraAsync({ mediaTypes: 'images', quality: 0.8 });
      if (!result.canceled) addAssets(result.assets);
    } catch (e) {
      toast.error(t('products.cameraError', 'Could not open the camera. Please try again.'));
    }
  }, [remainingSlots, ensurePermission, addAssets, toast, t]);

  const removeImage = useCallback((uri, isLocal) => {
    dirtyRef.current = true;
    if (isLocal) {
      setLocalImgs((prev) => prev.filter((img) => img.uri !== uri));
      uploadedCache.current.delete(uri);
      setUploadState((prev) => {
        const next = { ...prev };
        delete next[uri];
        return next;
      });
    } else {
      setImages((prev) => prev.filter((u) => u !== uri));
    }
  }, []);

  // ── Highlights / specs ─────────────────────────────────────────────────────
  const updateHighlight = useCallback((i, value) => {
    dirtyRef.current = true;
    setHighlights((prev) => prev.map((h, idx) => (idx === i ? value : h)));
  }, []);

  const updateSpec = useCallback((i, key, value) => {
    dirtyRef.current = true;
    setSpecPairs((prev) => prev.map((pair, idx) => (idx === i ? { ...pair, [key]: value } : pair)));
  }, []);

  // ── Save ───────────────────────────────────────────────────────────────────
  const uploadOne = useCallback(async (uri) => {
    const cached = uploadedCache.current.get(uri);
    if (cached) return cached;

    setUploadState((prev) => ({ ...prev, [uri]: 'uploading' }));
    try {
      const { base64 } = await compressImage(uri);
      const { data } = await api.post('/upload/image', { base64 }, { timeout: 60_000 });
      const url = data?.data?.url;
      if (!url) throw new Error('Upload returned no URL');
      uploadedCache.current.set(uri, url);
      setUploadState((prev) => {
        const next = { ...prev };
        delete next[uri];
        return next;
      });
      return url;
    } catch (e) {
      setUploadState((prev) => ({ ...prev, [uri]: 'failed' }));
      throw e;
    }
  }, []);

  const handleSave = useCallback(async () => {
    setSubmitted(true);
    const errs = validate(form, t);
    setErrors(errs);

    if (Object.keys(errs).some((k) => errs[k])) {
      toast.error(t('products.fixErrors', 'Please fix the highlighted fields.'));
      scrollToFirstError(errs);
      return;
    }

    if (isOffline) {
      toast.warning(t('common.offlineAction', 'You are offline. Reconnect to save this.'));
      return;
    }

    setSaving(true);
    try {
      // Upload sequentially — the compressor is memory-hungry and five parallel
      // base64 payloads is how low-end devices get killed by the OS.
      const uploaded = [];
      const pending = localImgs.filter((img) => !uploadedCache.current.has(img.uri));
      if (pending.length) setUploadProgress({ done: 0, total: pending.length });

      for (const img of localImgs) {
        const wasCached = uploadedCache.current.has(img.uri);
        uploaded.push(await uploadOne(img.uri));
        if (!wasCached) {
          setUploadProgress((prev) => (prev ? { ...prev, done: prev.done + 1 } : prev));
        }
      }
      setUploadProgress(null);

      const specsObj = {};
      specPairs.forEach(({ key, value }) => {
        if (key.trim() && value.trim()) specsObj[key.trim()] = value.trim();
      });

      const highlightList = highlights.map((h) => h.trim()).filter(Boolean);
      const tagList = form.tags.trim()
        ? form.tags.split(',').map((tag) => tag.trim()).filter(Boolean)
        : undefined;

      const payload = {
        categoryId: form.categoryId,
        subcategory: form.subcategory || undefined,
        name: form.name.trim(),
        description: form.desc.trim() || undefined,
        price: Number(form.price),
        mrp: form.mrp.trim() ? Number(form.mrp) : undefined,
        unit: form.unit,
        stock: Number(form.stock),
        minOrderQty: form.moq.trim() ? Number(form.moq) : 1,
        images: [...images, ...uploaded],
        district: form.district || undefined,
        taluka: form.taluka || undefined,
        village: form.village.trim() || undefined,
        state: 'Maharashtra',
        sellScope: form.sellScope,
        tags: tagList,
        harvestDate: form.harvestDate.trim() || undefined,
        brand: form.brand.trim() || undefined,
        manufacturer: form.manufacturer.trim() || undefined,
        countryOfOrigin: form.countryOfOrigin.trim() || undefined,
        highlights: highlightList.length ? highlightList : undefined,
        specifications: Object.keys(specsObj).length ? specsObj : undefined,
      };

      if (isEdit) await api.put(`/agristore/seller/products/${editProduct.id}`, payload);
      else await api.post('/agristore/seller/products', payload);

      dirtyRef.current = false;
      allowNext();
      toast.success(
        isEdit
          ? t('products.updated', 'Listing updated')
          : t('products.created', 'Listing published'),
      );
      navigation.goBack();
    } catch (e) {
      setUploadProgress(null);
      const message = safeErrorMessage(e, t('products.saveError'));
      toast.error(message);
      // A validation rejection from the server is about the fields, not the
      // network — point the seller back at the form.
      if (e?.response?.status === 400 || e?.response?.status === 422) {
        scrollRef.current?.scrollTo({ y: 0, animated: true });
      }
    } finally {
      setSaving(false);
    }
  }, [
    form, t, toast, isOffline, scrollToFirstError, localImgs, uploadOne, specPairs,
    highlights, images, isEdit, editProduct, allowNext, navigation,
  ]);

  // ── Derived ────────────────────────────────────────────────────────────────
  const categoryOptions = useMemo(
    () => categories.map((c) => ({ value: c.id, label: c.name })),
    [categories],
  );

  const subcategoryOptions = useMemo(() => {
    const cat = categories.find((c) => c.id === form.categoryId);
    return cat ? (SUBCATEGORIES_MAP[cat.name] || []) : [];
  }, [categories, form.categoryId]);

  const talukaOptions = useMemo(() => getTalukas(form.district), [form.district]);

  const failedUploads = Object.values(uploadState).filter((v) => v === 'failed').length;

  // Counted live so the meter moves as the seller types, not on submit.
  const progress = requiredProgress(form);

  return (
    <Screen edges={['left', 'right']} background={C.bg}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={[
            { padding: gutter, paddingBottom: SP.huge },
            isExpanded && { maxWidth: contentMaxWidth, width: '100%', alignSelf: 'center' },
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {/* ── Progress ── */}
          <Card style={s.progressCard}>
            <View style={s.progressTop}>
              <View style={{ flex: 1 }}>
                <Text style={s.progressTitle} numberOfLines={2}>
                  {isEdit ? t('products.updateProduct', 'Update listing') : t('products.listProduct', 'List a product')}
                </Text>
                <Text style={s.progressSub} numberOfLines={2}>
                  {progress.done === progress.total
                    ? t('products.readyToPublish', 'All required details are filled in.')
                    : t('products.requiredLeft', {
                        n: progress.total - progress.done,
                        defaultValue: '{{n}} required detail(s) still to fill in.',
                      })}
                </Text>
              </View>
              <Text style={[s.progressFig, progress.done === progress.total && { color: C.success }]}>
                {progress.done}
                <Text style={s.progressFigDim}> / {progress.total}</Text>
              </Text>
            </View>
            <ProgressBar
              value={progress.percent}
              color={progress.done === progress.total ? C.success : C.brand}
              label={t('products.requiredProgress', 'Required details completed')}
              style={{ marginTop: SP.lg }}
            />
          </Card>

          {submitted && Object.values(errors).some(Boolean) ? (
            <InlineNotice variant="error" style={{ marginBottom: SP.lg }}>
              {t('products.fixErrors', 'Please fix the highlighted fields.')}
            </InlineNotice>
          ) : null}

          {/* ── Photos ── */}
          <FormSection
            icon="images-outline"
            title={t('products.photos', 'Photos')}
            hint={t('products.photosHint')}
            step={1}
            total={TOTAL_SECTIONS}
          >
            <Field label={t('products.photosField')}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={s.imgRow}
                keyboardShouldPersistTaps="handled"
              >
                {allImages.map((img, i) => (
                  <ImageTile
                    key={img.uri}
                    uri={img.uri}
                    status={uploadState[img.uri]}
                    isCover={i === 0}
                    coverLabel={t('products.coverPhoto', 'Cover')}
                    uploadingLabel={t('products.uploading', 'Uploading')}
                    failedLabel={t('products.uploadFailedOne', 'Upload failed')}
                    onRemove={() => removeImage(img.uri, img.local)}
                    label={t('products.removePhoto', 'Remove photo')}
                  />
                ))}

                {remainingSlots > 0 ? (
                  <>
                    <Pressable
                      onPress={pickFromLibrary}
                      accessibilityRole="button"
                      accessibilityLabel={t('products.addPhoto')}
                      accessibilityHint={t('products.addPhotoHint', {
                        n: remainingSlots,
                        defaultValue: '{{n}} more can be added',
                      })}
                      style={({ pressed }) => [s.imgAdd, pressed && { opacity: 0.7 }]}
                    >
                      <Ionicons name="images-outline" size={24} color={C.brandInk} />
                      <Text style={s.imgAddTxt}>{t('products.addPhoto')}</Text>
                    </Pressable>

                    {Platform.OS !== 'web' ? (
                      <Pressable
                        onPress={takePhoto}
                        accessibilityRole="button"
                        accessibilityLabel={t('products.takePhoto', 'Take photo')}
                        style={({ pressed }) => [s.imgAdd, pressed && { opacity: 0.7 }]}
                      >
                        <Ionicons name="camera-outline" size={24} color={C.brandInk} />
                        <Text style={s.imgAddTxt}>{t('products.takePhoto', 'Camera')}</Text>
                      </Pressable>
                    ) : null}
                  </>
                ) : null}
              </ScrollView>

              <View style={s.imgFoot}>
                <Badge
                  label={t('products.photoCount', {
                    n: allImages.length,
                    max: MAX_IMAGES,
                    defaultValue: '{{n}} of {{max}}',
                  })}
                  color={allImages.length > 0 ? C.brandInk : C.neutral}
                  icon="images"
                />
              </View>

              {failedUploads > 0 ? (
                <InlineNotice variant="error" style={{ marginTop: SP.md }}>
                  {t('products.uploadFailed', {
                    n: failedUploads,
                    defaultValue: '{{n}} photo(s) failed to upload. Save again to retry just those.',
                  })}
                </InlineNotice>
              ) : null}
            </Field>
          </FormSection>

          {/* ── Product details ── */}
          <FormSection
            icon="leaf-outline"
            title={t('products.productDetails')}
            hint={t('products.productNameHint')}
            step={2}
            total={TOTAL_SECTIONS}
          >
            <Field
              label={t('products.category')}
              required
              error={errors.categoryId}
              onLayoutY={registerY('categoryId')}
            >
              <SelectSheet
                title={t('products.selectCategoryTitle')}
                placeholder={t('products.selectCategory')}
                items={categoryOptions}
                value={form.categoryId}
                onChange={setField('categoryId')}
                loading={catsLoading}
                error={catsError}
                onRetry={fetchCategories}
                accessibilityLabel={t('products.category')}
              />
            </Field>

            {subcategoryOptions.length > 0 ? (
              <Field label={t('products.subcategory')} hint={t('products.subcategoryHint')}>
                <SelectSheet
                  title={t('products.selectSubcategoryTitle')}
                  placeholder={t('products.noneGeneral')}
                  items={subcategoryOptions}
                  value={form.subcategory}
                  onChange={setField('subcategory')}
                  clearLabel={t('products.noneGeneral')}
                  accessibilityLabel={t('products.subcategory')}
                />
              </Field>
            ) : null}

            <Field
              label={t('products.productName')}
              required
              hint={t('products.productNameHint')}
              error={errors.name}
              onLayoutY={registerY('name')}
            >
              <TextField
                value={form.name}
                onChangeText={setField('name')}
                placeholder={t('products.productNamePlaceholder')}
                error={errors.name}
                maxLength={MAX_NAME}
                label={t('products.productName')}
              />
              <CharCount value={form.name} max={MAX_NAME} />
            </Field>

            <Field label={t('products.description')} hint={t('products.descHint')}>
              <TextField
                value={form.desc}
                onChangeText={setField('desc')}
                placeholder={t('products.descPlaceholder')}
                multiline
                maxLength={MAX_DESC}
                label={t('products.description')}
              />
              <CharCount value={form.desc} max={MAX_DESC} />
            </Field>

            <Field label={t('products.searchTags')} hint={t('products.searchTagsHint')}>
              <TextField
                value={form.tags}
                onChangeText={setField('tags')}
                placeholder={t('products.searchTagsPlaceholder')}
                autoCapitalize="none"
                label={t('products.searchTags')}
              />
            </Field>
          </FormSection>

          {/* ── Pricing & stock ── */}
          <FormSection
            icon="pricetag-outline"
            title={t('products.pricingStock')}
            hint={t('products.mrpHint')}
            step={3}
            total={TOTAL_SECTIONS}
          >
            <View style={s.pairRow}>
              <Field
                label={t('products.sellingPrice')}
                required
                error={errors.price}
                onLayoutY={registerY('price')}
                style={s.pairCell}
              >
                <TextField
                  value={form.price}
                  onChangeText={setField('price')}
                  placeholder="0"
                  keyboardType="decimal-pad"
                  error={errors.price}
                  prefix={<Text style={s.affixTxt}>₹</Text>}
                  label={t('products.sellingPrice')}
                />
              </Field>

              <Field
                label={t('products.mrp')}
                hint={errors.mrp ? undefined : t('products.mrpHint')}
                error={errors.mrp}
                onLayoutY={registerY('mrp')}
                style={s.pairCell}
              >
                <TextField
                  value={form.mrp}
                  onChangeText={setField('mrp')}
                  placeholder="0"
                  keyboardType="decimal-pad"
                  error={errors.mrp}
                  prefix={<Text style={s.affixTxt}>₹</Text>}
                  label={t('products.mrp')}
                />
              </Field>
            </View>

            <Field label={t('products.unit')} required hint={t('products.unitHint')}>
              <ChipGroup accessibilityLabel={t('products.unit')}>
                {UNITS.map((u) => (
                  <Chip
                    key={u}
                    label={u}
                    selected={form.unit === u}
                    onPress={() => setField('unit')(u)}
                  />
                ))}
              </ChipGroup>
            </Field>

            <View style={s.pairRow}>
              <Field
                label={t('products.stock')}
                required
                error={errors.stock}
                onLayoutY={registerY('stock')}
                style={s.pairCell}
              >
                <TextField
                  value={form.stock}
                  onChangeText={setField('stock')}
                  placeholder={t('products.availableQtyPlaceholder')}
                  keyboardType="number-pad"
                  error={errors.stock}
                  suffix={<Text style={s.affixTxt}>{form.unit}</Text>}
                  label={t('products.stock')}
                />
              </Field>

              <Field
                label={t('products.minOrder')}
                hint={errors.moq ? undefined : t('products.minOrderHint')}
                error={errors.moq}
                onLayoutY={registerY('moq')}
                style={s.pairCell}
              >
                <TextField
                  value={form.moq}
                  onChangeText={setField('moq')}
                  placeholder="1"
                  keyboardType="number-pad"
                  error={errors.moq}
                  label={t('products.minOrder')}
                />
              </Field>
            </View>

            <Field label={t('products.harvestDate')} hint={t('products.harvestHint')}>
              <TextField
                value={form.harvestDate}
                onChangeText={setField('harvestDate')}
                placeholder={t('products.harvestPlaceholder')}
                label={t('products.harvestDate')}
              />
            </Field>
          </FormSection>

          {/* ── Highlights & specifications ── */}
          <FormSection
            icon="list-outline"
            title={t('products.highlightsSpecsTitle')}
            hint={t('products.optionalSection', 'Optional — these help buyers compare, but you can publish without them.')}
            step={4}
            total={TOTAL_SECTIONS}
          >
            <Field label={t('rent.brandLabel')} hint={t('products.brandHint')}>
              <TextField
                value={form.brand}
                onChangeText={setField('brand')}
                placeholder={t('products.brandPlaceholder')}
                label={t('rent.brandLabel')}
              />
            </Field>

            <Field label={t('products.manufacturerLabel')} hint={t('products.manufacturerHint')}>
              <TextField
                value={form.manufacturer}
                onChangeText={setField('manufacturer')}
                placeholder={t('products.manufacturerPlaceholder')}
                label={t('products.manufacturerLabel')}
              />
            </Field>

            <Field label={t('products.countryOfOrigin')}>
              <TextField
                value={form.countryOfOrigin}
                onChangeText={setField('countryOfOrigin')}
                placeholder={t('products.countryPlaceholder')}
                label={t('products.countryOfOrigin')}
              />
            </Field>

            <Field label={t('product.highlightsTitle')} hint={t('products.highlightsHint')}>
              {highlights.map((h, i) => (
                <View key={`hl-${i}`} style={s.repeatRow}>
                  <TextField
                    style={{ flex: 1 }}
                    value={h}
                    onChangeText={(v) => updateHighlight(i, v)}
                    placeholder={t('products.highlightPlaceholder', { num: i + 1 })}
                    label={t('products.highlightPlaceholder', { num: i + 1 })}
                  />
                  {highlights.length > 1 ? (
                    <IconButton
                      icon="remove-circle-outline"
                      size={22}
                      color={C.danger}
                      onPress={() => {
                        dirtyRef.current = true;
                        setHighlights((prev) => prev.filter((_, idx) => idx !== i));
                      }}
                      accessibilityLabel={t('products.removeHighlight', {
                        num: i + 1,
                        defaultValue: `Remove highlight ${i + 1}`,
                      })}
                    />
                  ) : null}
                </View>
              ))}
              <Button
                label={t('products.addHighlight')}
                icon="add-circle-outline"
                variant="ghost"
                size="sm"
                onPress={() => { dirtyRef.current = true; setHighlights((prev) => [...prev, '']); }}
                style={{ alignSelf: 'flex-start' }}
              />
            </Field>

            <Field label={t('product.specifications')} hint={t('products.specsHint')}>
              {specPairs.map((pair, i) => (
                <View key={`spec-${i}`} style={s.repeatRow}>
                  <TextField
                    style={{ flex: 1 }}
                    value={pair.key}
                    onChangeText={(v) => updateSpec(i, 'key', v)}
                    placeholder={t('products.specLabelPlaceholder')}
                    label={t('products.specLabelPlaceholder')}
                  />
                  <TextField
                    style={{ flex: 1.3 }}
                    value={pair.value}
                    onChangeText={(v) => updateSpec(i, 'value', v)}
                    placeholder={t('products.specValuePlaceholder')}
                    label={t('products.specValuePlaceholder')}
                  />
                  {specPairs.length > 1 ? (
                    <IconButton
                      icon="remove-circle-outline"
                      size={22}
                      color={C.danger}
                      onPress={() => {
                        dirtyRef.current = true;
                        setSpecPairs((prev) => prev.filter((_, idx) => idx !== i));
                      }}
                      accessibilityLabel={t('products.removeSpec', {
                        num: i + 1,
                        defaultValue: `Remove specification ${i + 1}`,
                      })}
                    />
                  ) : null}
                </View>
              ))}
              <Button
                label={t('products.addSpecification')}
                icon="add-circle-outline"
                variant="ghost"
                size="sm"
                onPress={() => {
                  dirtyRef.current = true;
                  setSpecPairs((prev) => [...prev, { key: '', value: '' }]);
                }}
                style={{ alignSelf: 'flex-start' }}
              />
            </Field>
          </FormSection>

          {/* ── Location & reach ── */}
          <FormSection
            icon="location-outline"
            title={t('products.whereSelling')}
            hint={t('products.sellingReachHint')}
            step={5}
            total={TOTAL_SECTIONS}
          >
            <Field
              label={t('products.district')}
              required
              hint={errors.district ? undefined : t('products.districtHint')}
              error={errors.district}
              onLayoutY={registerY('district')}
            >
              <SelectSheet
                title={t('products.selectDistrictTitle')}
                placeholder={t('products.selectDistrict')}
                items={DISTRICT_LIST}
                value={form.district}
                onChange={setField('district')}
                accessibilityLabel={t('products.district')}
              />
            </Field>

            <Field label={t('products.taluka')} hint={t('products.talukaHint')}>
              <SelectSheet
                title={t('products.selectTalukaTitle')}
                placeholder={form.district
                  ? t('products.talukaOptional')
                  : t('products.selectDistrictFirst')}
                items={talukaOptions}
                value={form.taluka}
                onChange={setField('taluka')}
                disabled={!form.district}
                clearLabel={t('products.noneGeneral')}
                accessibilityLabel={t('products.taluka')}
              />
            </Field>

            <Field label={t('products.villageTown')} hint={t('products.villageTownHint')}>
              <TextField
                value={form.village}
                onChangeText={setField('village')}
                placeholder={t('products.villagePlaceholder')}
                label={t('products.villageTown')}
              />
            </Field>

            <Field label={t('products.sellingReach')} required hint={t('products.sellingReachHint')}>
              <View style={{ gap: SP.sm }}>
                {SELLING_SCOPES.map((sc) => (
                  <OptionRow
                    key={sc.key}
                    selected={form.sellScope === sc.key}
                    onPress={() => setField('sellScope')(sc.key)}
                    icon={sc.icon}
                    title={t('scope.' + sc.tKey)}
                    description={t('scope.' + sc.descKey)}
                  />
                ))}
              </View>
            </Field>
          </FormSection>
        </ScrollView>
      </KeyboardAvoidingView>

      <ActionBar>
        {uploadProgress ? (
          <View style={s.uploadBar} accessibilityLiveRegion="polite">
            <Text style={s.uploadTxt}>
              {t('products.uploadingProgress', {
                done: uploadProgress.done,
                total: uploadProgress.total,
                defaultValue: 'Uploading photo {{done}} of {{total}}…',
              })}
            </Text>
            <ProgressBar
              value={uploadProgress.total ? (uploadProgress.done / uploadProgress.total) * 100 : 0}
              height={6}
              label={t('products.uploadingLabel', 'Uploading photos')}
            />
          </View>
        ) : null}
        <Button
          label={isEdit ? t('products.updateProduct') : t('products.listProduct')}
          icon={isEdit ? 'checkmark-circle-outline' : 'add-circle-outline'}
          size="lg"
          fullWidth
          loading={saving}
          disabled={saving}
          onPress={handleSave}
          accessibilityHint={
            isOffline ? t('common.offlineAction', 'You are offline. Reconnect to save this.') : undefined
          }
        />
      </ActionBar>
    </Screen>
  );
}

const s = StyleSheet.create({
  // ── Progress card ──
  progressCard: { marginBottom: SP.lg, ...E.raised },
  progressTop: { flexDirection: 'row', alignItems: 'flex-start', gap: SP.lg },
  progressTitle: { ...T.subhead, color: C.text },
  progressSub: { ...T.caption, color: C.textMuted, marginTop: SP.xs },
  progressFig: { ...T.figureMd, color: C.brandInk },
  progressFigDim: { color: C.textFaint },

  // ── Photos ──
  imgRow: { flexDirection: 'row', gap: SP.md, paddingVertical: SP.xs, paddingRight: SP.xs },
  imgWrap: { position: 'relative' },
  imgThumb: {
    width: 104, height: 104,
    borderRadius: R.lg,
    backgroundColor: C.surfaceSunken,
    borderWidth: 1,
    borderColor: C.border,
  },
  imgOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: R.lg,
    backgroundColor: alpha(C.text, 0.55),
    alignItems: 'center',
    justifyContent: 'center',
  },
  imgCover: {
    position: 'absolute',
    left: SP.sm, bottom: SP.sm,
    paddingHorizontal: SP.sm,
    paddingVertical: 3,
    borderRadius: R.pill,
    backgroundColor: alpha(C.text, 0.72),
  },
  imgCoverTxt: { ...T.micro, fontSize: 10, color: C.onBrand, textTransform: 'uppercase' },
  imgRemove: { position: 'absolute', top: -SP.sm, right: -SP.sm },
  imgRemoveBtn: { width: 30, height: 30, borderRadius: 15, ...E.card },

  imgAdd: {
    width: 104, height: 104,
    borderRadius: R.lg,
    backgroundColor: C.brandPale,
    borderWidth: 1.5, borderColor: alpha(C.brand, 0.4), borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center', gap: SP.xs,
  },
  imgAddTxt: { ...T.micro, color: C.brandInk, textTransform: 'uppercase' },
  imgFoot: { flexDirection: 'row', marginTop: SP.md },

  // ── Field layout ──
  pairRow: { flexDirection: 'row', gap: SP.md },
  pairCell: { flex: 1 },
  affixTxt: { ...T.bodyBold, color: C.textMuted },

  repeatRow: { flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm, marginBottom: SP.sm },

  // ── Action bar ──
  uploadBar: { gap: SP.sm, marginBottom: SP.md },
  uploadTxt: { ...T.caption, color: C.textMuted, textAlign: 'center' },
});
