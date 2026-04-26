import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput,
  TouchableOpacity, Image, Alert, ActivityIndicator,
  KeyboardAvoidingView, Platform, SafeAreaView, Modal,
  TouchableWithoutFeedback,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SHADOWS, RADIUS } from '../../constants/colors';
import api from '../../services/api';
import { compressImage } from '../../utils/mediaCompressor';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { DISTRICT_LIST, getTalukas, SELLING_SCOPES } from '../../constants/locations';
import { SUBCATEGORIES_MAP } from '../../constants/categories';
import LocationPicker from '../../components/LocationPicker';

const UNITS = ['kg', 'quintal', 'gram', 'litre', 'ml', 'piece', 'bag', 'packet', 'bundle', 'acre', 'dozen'];

// ── Reusable field wrapper ─────────────────────────────────────────────────────
function Field({ label, children, required, hint }) {
  return (
    <View style={f.fieldWrap}>
      <Text style={f.label}>{label}{required ? ' *' : ''}</Text>
      {children}
      {hint ? <Text style={f.hint}>{hint}</Text> : null}
    </View>
  );
}

function TextF({ value, onChangeText, placeholder, keyboardType = 'default', multiline = false, autoCapitalize = 'sentences', maxLength }) {
  return (
    <TextInput
      style={[f.input, multiline && { height: 90, textAlignVertical: 'top' }]}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={COLORS.textLight}
      keyboardType={keyboardType}
      multiline={multiline}
      numberOfLines={multiline ? 4 : 1}
      autoCapitalize={autoCapitalize}
      maxLength={maxLength}
    />
  );
}

// ── Category Picker (modal) ───────────────────────────────────────────────────
function CategoryPicker({ categories, catsLoading, catsError, onRetry, selected, onSelect }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const cat = categories.find((c) => c.id === selected);

  return (
    <>
      <TouchableOpacity style={f.pickerBtn} onPress={() => setOpen(true)} activeOpacity={0.75}>
        <Text style={[f.pickerTxt, !cat && { color: COLORS.textLight }]}>
          {cat ? cat.name : t('products.selectCategory')}
        </Text>
        <Ionicons name="chevron-down" size={18} color={COLORS.gray550} />
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <TouchableWithoutFeedback onPress={() => setOpen(false)}>
          <View style={f.modalBackdrop} />
        </TouchableWithoutFeedback>
        <View style={f.modalSheet}>
          <View style={f.modalHandle} />
          <Text style={f.modalTitle}>{t('products.selectCategoryTitle')}</Text>
          {catsLoading ? (
            <View style={{ padding: 32, alignItems: 'center' }}>
              <ActivityIndicator color={COLORS.sellerPrimary} size="large" />
              <Text style={{ marginTop: 12, color: COLORS.textMedium, fontSize: 14 }}>{t('products.modalLoading')}</Text>
            </View>
          ) : catsError ? (
            <View style={{ padding: 32, alignItems: 'center', gap: 12 }}>
              <Ionicons name="cloud-offline-outline" size={48} color={COLORS.gray175} />
              <Text style={{ color: COLORS.textMedium, fontSize: 14, textAlign: 'center' }}>{t('products.catsError')}</Text>
              <TouchableOpacity style={{ backgroundColor: COLORS.sellerPrimary, borderRadius: RADIUS.md, paddingHorizontal: 24, paddingVertical: 10 }} onPress={onRetry}>
                <Text style={{ color: COLORS.white, fontWeight: '700' }}>{t('retry')}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <ScrollView style={f.listScroll} showsVerticalScrollIndicator={false}>
              {categories.map((c) => (
                <React.Fragment key={c.id}>
                  <TouchableOpacity style={[f.dropItem, c.id === selected && f.dropItemActive]} onPress={() => { onSelect(c.id); setOpen(false); }} activeOpacity={0.7}>
                    <Text style={[f.dropTxt, c.id === selected && { color: COLORS.sellerPrimary, fontWeight: '700' }]}>{c.name}</Text>
                    {c.id === selected && <Ionicons name="checkmark-circle" size={20} color={COLORS.sellerPrimary} />}
                  </TouchableOpacity>
                  <View style={{ height: 1, backgroundColor: COLORS.grayBg }} />
                </React.Fragment>
              ))}
            </ScrollView>
          )}
          <TouchableOpacity style={f.modalCancel} onPress={() => setOpen(false)}>
            <Text style={f.modalCancelTxt}>{t('cancel')}</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </>
  );
}

// ── Subcategory Picker (modal) ─────────────────────────────────────────────────
function SubcategoryPicker({ subcategories, selected, onSelect }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);

  if (!subcategories || subcategories.length === 0) return null;

  return (
    <>
      <TouchableOpacity style={f.pickerBtn} onPress={() => setOpen(true)} activeOpacity={0.75}>
        <Text style={[f.pickerTxt, !selected && { color: COLORS.textLight }]}>
          {selected || t('products.talukaOptional')}
        </Text>
        <Ionicons name="chevron-down" size={18} color={COLORS.gray550} />
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <TouchableWithoutFeedback onPress={() => setOpen(false)}>
          <View style={f.modalBackdrop} />
        </TouchableWithoutFeedback>
        <View style={f.modalSheet}>
          <View style={f.modalHandle} />
          <Text style={f.modalTitle}>{t('products.selectSubcategoryTitle')}</Text>
          <ScrollView style={f.listScroll} showsVerticalScrollIndicator={false}>
            <TouchableOpacity
              style={[f.dropItem, !selected && f.dropItemActive]}
              onPress={() => { onSelect(''); setOpen(false); }}
              activeOpacity={0.7}
            >
              <Text style={[f.dropTxt, !selected && { color: COLORS.sellerPrimary, fontWeight: '700' }]}>
                {t('products.noneGeneral')}
              </Text>
              {!selected && <Ionicons name="checkmark-circle" size={20} color={COLORS.sellerPrimary} />}
            </TouchableOpacity>
            <View style={{ height: 1, backgroundColor: COLORS.grayBg }} />
            {subcategories.map((sub) => (
              <React.Fragment key={sub}>
                <TouchableOpacity
                  style={[f.dropItem, sub === selected && f.dropItemActive]}
                  onPress={() => { onSelect(sub); setOpen(false); }}
                  activeOpacity={0.7}
                >
                  <Text style={[f.dropTxt, sub === selected && { color: COLORS.sellerPrimary, fontWeight: '700' }]}>
                    {sub}
                  </Text>
                  {sub === selected && <Ionicons name="checkmark-circle" size={20} color={COLORS.sellerPrimary} />}
                </TouchableOpacity>
                <View style={{ height: 1, backgroundColor: COLORS.grayBg }} />
              </React.Fragment>
            ))}
          </ScrollView>
          <TouchableOpacity style={f.modalCancel} onPress={() => setOpen(false)}>
            <Text style={f.modalCancelTxt}>{t('cancel')}</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </>
  );
}

// ── Unit Picker ────────────────────────────────────────────────────────────────
function UnitPicker({ selected, onSelect }) {
  return (
    <View style={f.chipRow}>
      {UNITS.map((u) => (
        <TouchableOpacity key={u} style={[f.chip, selected === u && f.chipActive]} onPress={() => onSelect(u)}>
          <Text style={[f.chipTxt, selected === u && f.chipTxtActive]}>{u}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ── Selling Scope Picker ───────────────────────────────────────────────────────
function ScopePicker({ selected, onSelect }) {
  const { t } = useLanguage();
  return (
    <View style={{ gap: 8 }}>
      {SELLING_SCOPES.map((sc) => {
        const active = selected === sc.key;
        return (
          <TouchableOpacity
            key={sc.key}
            style={[sc_s.item, active && sc_s.itemActive]}
            onPress={() => onSelect(sc.key)}
            activeOpacity={0.8}
          >
            <View style={[sc_s.iconWrap, active && sc_s.iconWrapActive]}>
              <Ionicons name={sc.icon} size={18} color={active ? COLORS.sellerPrimary : COLORS.gray550} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[sc_s.label, active && sc_s.labelActive]}>{t('scope.' + sc.tKey)}</Text>
              <Text style={sc_s.desc}>{t('scope.' + sc.descKey)}</Text>
            </View>
            {active && <Ionicons name="checkmark-circle" size={20} color={COLORS.sellerPrimary} />}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ── Section divider ───────────────────────────────────────────────────────────
function SectionTitle({ icon, title }) {
  return (
    <View style={st.wrap}>
      <View style={st.line} />
      <View style={st.pill}>
        <Ionicons name={icon} size={13} color={COLORS.sellerPrimary} />
        <Text style={st.txt}>{title}</Text>
      </View>
      <View style={st.line} />
    </View>
  );
}

// ── Main Screen ────────────────────────────────────────────────────────────────
export default function AddProductScreen({ route, navigation }) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const editProduct = route.params?.product || null;
  const isEdit = !!editProduct;

  const [categories,    setCategories]    = useState([]);
  const [catsLoading,   setCatsLoading]   = useState(true);
  const [catsError,     setCatsError]     = useState(false);
  const [categoryId,    setCategoryId]    = useState(editProduct?.categoryId || '');
  const [subcategory,   setSubcategory]   = useState(editProduct?.subcategory || '');
  const [name,          setName]          = useState(editProduct?.name || '');
  const [desc,          setDesc]          = useState(editProduct?.description || '');
  const [price,         setPrice]         = useState(editProduct?.price?.toString() || '');
  const [mrp,           setMrp]           = useState(editProduct?.mrp?.toString() || '');
  const [unit,          setUnit]          = useState(editProduct?.unit || 'kg');
  const [stock,         setStock]         = useState(editProduct?.stock?.toString() || '');
  const [moq,           setMoq]           = useState(editProduct?.minOrderQty?.toString() || '1');
  const [tags,          setTags]          = useState(editProduct?.tags?.join(', ') || '');
  const [harvestDate,   setHarvestDate]   = useState(editProduct?.harvestDate || '');
  const [images,        setImages]        = useState(editProduct?.images || []);
  const [localImgs,     setLocalImgs]     = useState([]); // [{ uri }]
  const [saving,        setSaving]        = useState(false);

  // Product detail fields
  const [brand,           setBrand]           = useState(editProduct?.brand || '');
  const [manufacturer,    setManufacturer]    = useState(editProduct?.manufacturer || '');
  const [countryOfOrigin, setCountryOfOrigin] = useState(editProduct?.countryOfOrigin || 'India');
  const [highlights,      setHighlights]      = useState(
    editProduct?.highlights?.length ? editProduct.highlights : ['']
  );
  const [specPairs, setSpecPairs] = useState(() => {
    const specs = editProduct?.specifications;
    if (specs && typeof specs === 'object' && Object.keys(specs).length > 0) {
      return Object.entries(specs).map(([k, v]) => ({ key: k, value: String(v) }));
    }
    return [{ key: '', value: '' }];
  });

  // Location — default to seller's own location
  const [district,  setDistrict]  = useState(editProduct?.district  || user?.district  || '');
  const [taluka,    setTaluka]    = useState(editProduct?.taluka    || user?.taluka    || '');
  const [village,   setVillage]   = useState(editProduct?.village   || user?.village   || '');
  const [sellScope, setSellScope] = useState(editProduct?.sellScope || 'district');

  // Reset subcategory when category changes
  const [categoryTouched, setCategoryTouched] = useState(false);
  useEffect(() => {
    if (categoryTouched) setSubcategory('');
  }, [categoryId]);

  // Reset taluka when district changes (only if user manually changed it)
  const [districtTouched, setDistrictTouched] = useState(false);
  useEffect(() => {
    if (districtTouched) setTaluka('');
  }, [district]);

  const fetchCategories = () => {
    setCatsLoading(true);
    setCatsError(false);
    api.get('/agristore/categories')
      .then(({ data }) => {
        const list = data.data || data || [];
        setCategories(Array.isArray(list) ? list : []);
        setCatsLoading(false);
      })
      .catch(() => { setCatsLoading(false); setCatsError(true); });
  };

  useEffect(() => {
    navigation.setOptions({ title: isEdit ? t('products.updateProduct') : t('products.listProduct') });
    fetchCategories();
  }, []);

  // ── Image picker ────────────────────────────────────────────────────────────
  const pickImages = async () => {
    const total = images.length + localImgs.length;
    if (total >= 5) { Alert.alert(t('required'), t('products.limitMsg')); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      allowsMultipleSelection: true,
      quality: 0.8,
      selectionLimit: 5 - total,
    });
    if (!result.canceled) {
      setLocalImgs((prev) => [...prev, ...result.assets.map((a) => ({ uri: a.uri }))]);
    }
  };

  const removeImage = (index, isLocal) => {
    if (isLocal) {
      setLocalImgs((prev) => prev.filter((_, i) => i !== index));
    } else {
      setImages((prev) => prev.filter((_, i) => i !== index));
    }
  };

  const uploadImage = async (uri) => {
    const { base64 } = await compressImage(uri);
    const { data } = await api.post('/upload/image', { base64 }, { timeout: 60000 });
    return data.data.url;
  };

  // ── Save ────────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!categoryId) { Alert.alert(t('required'), t('products.selectCategoryMsg')); return; }
    if (!name.trim()) { Alert.alert(t('required'), t('products.productNameRequired')); return; }
    if (!price || isNaN(Number(price)) || Number(price) <= 0) { Alert.alert(t('required'), t('products.validPrice')); return; }
    if (!stock || isNaN(Number(stock))) { Alert.alert(t('required'), t('products.validStock')); return; }
    if (!district) { Alert.alert(t('required'), t('products.selectDistrictMsg')); return; }

    setSaving(true);
    try {
      const uploadedUrls = [];
      for (const img of localImgs) {
        const url = await uploadImage(img.uri);
        uploadedUrls.push(url);
      }

      const tagList = tags.trim()
        ? tags.split(',').map((t) => t.trim()).filter(Boolean)
        : undefined;

      // Build specifications object from key-value pairs (skip empty rows)
      const specsObj = {};
      specPairs.forEach(({ key, value }) => {
        if (key.trim() && value.trim()) specsObj[key.trim()] = value.trim();
      });

      // Filter empty highlight lines
      const highlightList = highlights.map(h => h.trim()).filter(Boolean);

      const payload = {
        categoryId,
        subcategory: subcategory || undefined,
        name:        name.trim(),
        description: desc.trim() || undefined,
        price:       Number(price),
        mrp:         mrp ? Number(mrp) : undefined,
        unit,
        stock:       Number(stock),
        minOrderQty: moq ? Number(moq) : 1,
        images:      [...images, ...uploadedUrls],
        // Location
        district:  district || undefined,
        taluka:    taluka   || undefined,
        village:   village.trim() || undefined,
        state:     'Maharashtra',
        sellScope,
        // Extra
        tags:        tagList,
        harvestDate: harvestDate.trim() || undefined,
        // Product detail
        brand:           brand.trim() || undefined,
        manufacturer:    manufacturer.trim() || undefined,
        countryOfOrigin: countryOfOrigin.trim() || undefined,
        highlights:      highlightList.length ? highlightList : undefined,
        specifications:  Object.keys(specsObj).length ? specsObj : undefined,
      };

      if (isEdit) {
        await api.put(`/agristore/seller/products/${editProduct.id}`, payload);
      } else {
        await api.post('/agristore/seller/products', payload);
      }

      navigation.goBack();
    } catch (e) {
      Alert.alert(t('error'), e.response?.data?.error?.message || t('products.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const allImages = [
    ...images.map((u) => ({ uri: u, local: false })),
    ...localImgs.map((img) => ({ uri: img.uri, local: true })),
  ];

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120 }} showsVerticalScrollIndicator={false}>

          {/* ── Images ── */}
          <SectionTitle icon="images-outline" title={t('products.photos')} />
          <Field label={t('products.photosField')} hint={t('products.photosHint')}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.imgRow}>
              {allImages.map((img, i) => (
                <View key={i} style={s.imgWrap}>
                  <Image source={{ uri: img.uri }} style={s.imgThumb} resizeMode="cover" />
                  <TouchableOpacity style={s.imgRemove} onPress={() => removeImage(i, img.local)}>
                    <Ionicons name="close-circle" size={22} color={COLORS.error} />
                  </TouchableOpacity>
                </View>
              ))}
              {allImages.length < 5 && (
                <TouchableOpacity style={s.imgAdd} onPress={pickImages}>
                  <Ionicons name="camera-outline" size={28} color={COLORS.sellerPrimary} />
                  <Text style={{ fontSize: 11, color: COLORS.sellerPrimary, marginTop: 4 }}>{t('products.addPhoto')}</Text>
                </TouchableOpacity>
              )}
            </ScrollView>
          </Field>

          {/* ── Product Details ── */}
          <SectionTitle icon="leaf-outline" title={t('products.productDetails')} />

          <Field label={t('products.category')} required>
            <CategoryPicker
              categories={categories}
              catsLoading={catsLoading}
              catsError={catsError}
              onRetry={fetchCategories}
              selected={categoryId}
              onSelect={(id) => { setCategoryId(id); setCategoryTouched(true); }}
            />
          </Field>

          {(() => {
            const selectedCat = categories.find((c) => c.id === categoryId);
            const subs = selectedCat ? (SUBCATEGORIES_MAP[selectedCat.name] || []) : [];
            return subs.length > 0 ? (
              <Field label={t('products.subcategory')} hint={t('products.subcategoryHint')}>
                <SubcategoryPicker
                  subcategories={subs}
                  selected={subcategory}
                  onSelect={setSubcategory}
                />
              </Field>
            ) : null;
          })()}

          <Field label={t('products.productName')} required hint={t('products.productNameHint')}>
            <TextF value={name} onChangeText={setName} placeholder={t('products.productNamePlaceholder')} />
          </Field>

          <Field label={t('products.description')} hint={t('products.descHint')}>
            <TextF value={desc} onChangeText={setDesc} placeholder={t('products.descPlaceholder')} multiline />
          </Field>

          <Field label={t('products.searchTags')} hint={t('products.searchTagsHint')}>
            <TextF value={tags} onChangeText={setTags} placeholder={t('products.searchTagsPlaceholder')} />
          </Field>

          {/* ── Pricing ── */}
          <SectionTitle icon="pricetag-outline" title={t('products.pricingStock')} />

          <View style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Field label={t('products.sellingPrice')} required>
                <TextF value={price} onChangeText={setPrice} placeholder="0" keyboardType="decimal-pad" />
              </Field>
            </View>
            <View style={{ flex: 1 }}>
              <Field label={t('products.mrp')} hint={t('products.mrpHint')}>
                <TextF value={mrp} onChangeText={setMrp} placeholder="0" keyboardType="decimal-pad" />
              </Field>
            </View>
          </View>

          <Field label={t('products.unit')} required hint={t('products.unitHint')}>
            <UnitPicker selected={unit} onSelect={setUnit} />
          </Field>

          <View style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Field label={t('products.stock')} required>
                <TextF value={stock} onChangeText={setStock} placeholder="Available qty" keyboardType="number-pad" />
              </Field>
            </View>
            <View style={{ flex: 1 }}>
              <Field label={t('products.minOrder')} hint={t('products.minOrderHint')}>
                <TextF value={moq} onChangeText={setMoq} placeholder="1" keyboardType="number-pad" />
              </Field>
            </View>
          </View>

          <Field label={t('products.harvestDate')} hint={t('products.harvestHint')}>
            <TextF
              value={harvestDate}
              onChangeText={setHarvestDate}
              placeholder={t('products.harvestPlaceholder')}
            />
          </Field>

          {/* ── Product Highlights & Specifications ── */}
          <SectionTitle icon="list-outline" title="Highlights & Specifications" />

          <Field label="Brand" hint="e.g. Mahindra, Syngenta, Bayer">
            <TextF value={brand} onChangeText={setBrand} placeholder="Brand name (optional)" />
          </Field>

          <Field label="Manufacturer" hint="Company that makes this product">
            <TextF value={manufacturer} onChangeText={setManufacturer} placeholder="Manufacturer name (optional)" />
          </Field>

          <Field label="Country of Origin">
            <TextF value={countryOfOrigin} onChangeText={setCountryOfOrigin} placeholder="e.g. India" />
          </Field>

          <Field
            label="Product Highlights"
            hint="Key selling points — one per line. Shown as bullet points on product page."
          >
            {highlights.map((h, i) => (
              <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <View style={{ flex: 1 }}>
                  <TextInput
                    style={[f.input, { marginBottom: 0 }]}
                    value={h}
                    onChangeText={(v) => {
                      const next = [...highlights];
                      next[i] = v;
                      setHighlights(next);
                    }}
                    placeholder={`Highlight ${i + 1} (e.g. "100% organic")`}
                    placeholderTextColor={COLORS.textLight}
                  />
                </View>
                {highlights.length > 1 && (
                  <TouchableOpacity
                    onPress={() => setHighlights(highlights.filter((_, idx) => idx !== i))}
                    style={{ padding: 4 }}
                  >
                    <Ionicons name="remove-circle" size={22} color={COLORS.error} />
                  </TouchableOpacity>
                )}
              </View>
            ))}
            <TouchableOpacity
              style={pd.addRowBtn}
              onPress={() => setHighlights([...highlights, ''])}
            >
              <Ionicons name="add-circle-outline" size={18} color={COLORS.sellerPrimary} />
              <Text style={pd.addRowTxt}>Add Highlight</Text>
            </TouchableOpacity>
          </Field>

          <Field
            label="Specifications"
            hint="Technical details shown in the spec table (e.g. Weight: 25kg, NPK: 10:26:26)"
          >
            {specPairs.map((pair, i) => (
              <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <TextInput
                  style={[f.input, { flex: 1, marginBottom: 0 }]}
                  value={pair.key}
                  onChangeText={(v) => {
                    const next = [...specPairs];
                    next[i] = { ...next[i], key: v };
                    setSpecPairs(next);
                  }}
                  placeholder="Label"
                  placeholderTextColor={COLORS.textLight}
                />
                <TextInput
                  style={[f.input, { flex: 1.4, marginBottom: 0 }]}
                  value={pair.value}
                  onChangeText={(v) => {
                    const next = [...specPairs];
                    next[i] = { ...next[i], value: v };
                    setSpecPairs(next);
                  }}
                  placeholder="Value"
                  placeholderTextColor={COLORS.textLight}
                />
                {specPairs.length > 1 && (
                  <TouchableOpacity
                    onPress={() => setSpecPairs(specPairs.filter((_, idx) => idx !== i))}
                    style={{ padding: 4 }}
                  >
                    <Ionicons name="remove-circle" size={22} color={COLORS.error} />
                  </TouchableOpacity>
                )}
              </View>
            ))}
            <TouchableOpacity
              style={pd.addRowBtn}
              onPress={() => setSpecPairs([...specPairs, { key: '', value: '' }])}
            >
              <Ionicons name="add-circle-outline" size={18} color={COLORS.sellerPrimary} />
              <Text style={pd.addRowTxt}>Add Specification</Text>
            </TouchableOpacity>
          </Field>

          {/* ── Location & Selling Scope ── */}
          <SectionTitle icon="location-outline" title={t('products.whereSelling')} />

          <Field
            label={t('products.district')}
            required
            hint={t('products.districtHint')}
          >
            <LocationPicker
              title={t('products.selectDistrictTitle')}
              items={DISTRICT_LIST}
              selected={district}
              onSelect={(v) => { setDistrict(v); setDistrictTouched(true); }}
              placeholder={t('products.selectDistrict')}
            />
          </Field>

          <Field label={t('products.taluka')} hint={t('products.talukaHint')}>
            <LocationPicker
              title={t('products.selectTalukaTitle')}
              items={getTalukas(district)}
              selected={taluka}
              onSelect={setTaluka}
              placeholder={district ? t('products.talukaOptional') : t('products.selectDistrictFirst')}
              disabled={!district}
            />
          </Field>

          <Field label={t('products.villageTown')} hint={t('products.villageTownHint')}>
            <TextF
              value={village}
              onChangeText={setVillage}
              placeholder={t('products.villagePlaceholder')}
            />
          </Field>

          <Field
            label={t('products.sellingReach')}
            required
            hint={t('products.sellingReachHint')}
          >
            <ScopePicker selected={sellScope} onSelect={setSellScope} />
          </Field>

        </ScrollView>
      </KeyboardAvoidingView>

      {/* ── Save Button ── */}
      <View style={s.footer}>
        <TouchableOpacity
          style={[s.saveBtn, saving && { opacity: 0.7 }]}
          onPress={handleSave}
          disabled={saving}
          activeOpacity={0.85}
        >
          {saving ? (
            <ActivityIndicator color={COLORS.white} />
          ) : (
            <>
              <Ionicons name={isEdit ? 'checkmark-circle-outline' : 'add-circle-outline'} size={20} color={COLORS.white} />
              <Text style={s.saveTxt}>{isEdit ? t('products.updateProduct') : t('products.listProduct')}</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.sellerBg },

  imgRow:  { flexDirection: 'row', gap: 10, paddingVertical: 4 },
  imgWrap: { position: 'relative' },
  imgThumb:  { width: 88, height: 88, borderRadius: RADIUS.md, backgroundColor: COLORS.grayBg },
  imgRemove: { position: 'absolute', top: -6, right: -6 },
  imgAdd: {
    width: 88, height: 88, borderRadius: RADIUS.md,
    backgroundColor: COLORS.sellerPrimary + '12',
    borderWidth: 1.5, borderColor: COLORS.sellerPrimary + '50', borderStyle: 'dashed',
    justifyContent: 'center', alignItems: 'center',
  },

  footer: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: COLORS.white, padding: 16,
    paddingBottom: Platform.OS === 'ios' ? 28 : 16,
    borderTopWidth: 1, borderTopColor: COLORS.grayBg,
    ...SHADOWS.medium,
  },
  saveBtn: {
    backgroundColor: COLORS.sellerPrimary, borderRadius: RADIUS.lg,
    paddingVertical: 15, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', gap: 10,
  },
  saveTxt: { fontSize: 16, fontWeight: '800', color: COLORS.white },
});

const f = StyleSheet.create({
  fieldWrap: { marginBottom: 18 },
  label: { fontSize: 13, fontWeight: '700', color: COLORS.gray700dark, marginBottom: 6 },
  hint:  { fontSize: 11, color: COLORS.textLight, marginTop: 4, lineHeight: 15 },
  input: {
    backgroundColor: COLORS.white, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: COLORS.sellerBorder,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, color: COLORS.textDark,
    ...SHADOWS.small,
  },
  pickerBtn: {
    backgroundColor: COLORS.white, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: COLORS.sellerBorder,
    paddingHorizontal: 14, paddingVertical: 12,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    ...SHADOWS.small,
  },
  pickerTxt: { fontSize: 15, color: COLORS.textDark },

  modalBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)' },
  modalSheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingBottom: Platform.OS === 'ios' ? 32 : 16,
    maxHeight: '80%',
    ...SHADOWS.large,
  },
  listScroll: { maxHeight: 360 },
  modalHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: COLORS.gray175, alignSelf: 'center', marginTop: 10, marginBottom: 4 },
  modalTitle: { fontSize: 17, fontWeight: '800', color: COLORS.textDark, textAlign: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: COLORS.grayBg },
  dropItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 15 },
  dropItemActive: { backgroundColor: COLORS.sellerPrimary + '08' },
  dropTxt: { fontSize: 15, color: COLORS.textDark },
  modalCancel: { marginHorizontal: 16, marginTop: 8, backgroundColor: COLORS.grayBg, borderRadius: RADIUS.md, paddingVertical: 14, alignItems: 'center' },
  modalCancelTxt: { fontSize: 15, fontWeight: '700', color: COLORS.textMedium },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: RADIUS.sm, borderWidth: 1.5, borderColor: COLORS.sellerBorder, backgroundColor: COLORS.white },
  chipActive: { borderColor: COLORS.sellerPrimary, backgroundColor: COLORS.sellerPrimary + '12' },
  chipTxt: { fontSize: 13, color: COLORS.textMedium, fontWeight: '600' },
  chipTxtActive: { color: COLORS.sellerPrimary },
});

// Selling scope item styles
const sc_s = StyleSheet.create({
  item: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 12, borderRadius: RADIUS.md,
    borderWidth: 1.5, borderColor: COLORS.sellerBorder,
    backgroundColor: COLORS.white,
    ...SHADOWS.small,
  },
  itemActive: { borderColor: COLORS.sellerPrimary, backgroundColor: COLORS.sellerPrimary + '06' },
  iconWrap: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: COLORS.grayBg,
    justifyContent: 'center', alignItems: 'center',
  },
  iconWrapActive: { backgroundColor: COLORS.sellerPrimary + '15' },
  label:      { fontSize: 14, fontWeight: '700', color: COLORS.textDark },
  labelActive:{ color: COLORS.sellerPrimary },
  desc:       { fontSize: 11, color: COLORS.textLight, marginTop: 2 },
});

// Product detail (highlights / specs) styles
const pd = StyleSheet.create({
  addRowBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 8, paddingHorizontal: 4, marginTop: 2,
  },
  addRowTxt: { fontSize: 13, fontWeight: '700', color: COLORS.sellerPrimary },
});

// Section title styles
const st = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 16 },
  line: { flex: 1, height: 1, backgroundColor: COLORS.grayBg },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 5,
    backgroundColor: COLORS.sellerPrimary + '12',
    borderRadius: RADIUS.full,
  },
  txt: { fontSize: 12, fontWeight: '800', color: COLORS.sellerPrimary },
});
