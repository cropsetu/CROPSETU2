// ─────────────────────────────────────────────────────────────────────────────
// CropSetu · Profile-Setup copy + t() stub
// ─────────────────────────────────────────────────────────────────────────────
// Every user-facing string lives once, here, under `onb.*`. Components call
// `t('onb.x')` only — never a literal. `en` is the source of truth; `hi` is
// included to pressure-test layout against longer Devanagari strings (~1.6×).
// Inject the app's real translator with <OnbStringsProvider t={appT}>.
// ─────────────────────────────────────────────────────────────────────────────
import React, { createContext, useContext, useMemo } from 'react';

export const STRINGS = {
  en: {
    onb: {
      // ── Chrome ──
      stepOf: 'Step {{current}} of {{total}}',
      skip: 'Skip for now',
      back: 'Back',
      next: 'Next',
      continue: 'Continue',
      finish: 'Finish',
      retry: 'Try again',
      optional: 'Optional',

      // ── Step 1 · Identity ──
      identityTitle: "Let's set up your profile",
      identitySubtitle: 'Add a photo and your name so others recognise you.',
      photoLabel: 'Profile photo',
      addPhoto: 'Add photo',
      changePhoto: 'Change',
      removePhoto: 'Remove',
      takePhoto: 'Take a photo',
      chooseGallery: 'Choose from gallery',
      photoUploading: 'Uploading photo…',
      photoFailed: "Couldn't upload the photo. Tap to retry.",
      photoSheetTitle: 'Profile photo',
      nameLabel: 'Full name',
      namePlaceholder: 'e.g. Ramesh Kumar',
      nameRequired: 'Please enter your name to continue.',
      nameTooShort: 'Name looks too short — please check it.',

      // ── Step 2 · Language ──
      languageTitle: 'Choose your language',
      languageSubtitle: 'The whole app will use this. You can change it later.',

      // ── Step 3 · Location ──
      locationTitle: 'Where is your farm?',
      locationSubtitle: 'This helps us show local prices, weather and schemes.',
      detect: 'Use my current location',
      detecting: 'Finding your location…',
      permissionDenied: "Location access is off. You can still type your address below.",
      permissionHint: 'Turn on location in Settings to auto-fill, or enter it manually.',
      autoFilled: 'Auto-filled',
      villageLabel: 'Village',
      villagePlaceholder: 'Village or town name',
      districtLabel: 'District',
      districtPlaceholder: 'District name',
      stateLabel: 'State',
      statePlaceholder: 'Select your state',
      pincodeLabel: 'PIN code',
      pincodePlaceholder: '6-digit PIN code',
      invalidPincode: 'Enter a valid 6-digit PIN code.',
      selectStateTitle: 'Select state',
      locationFailed: "Couldn't fetch your location. Please enter it manually.",

      // ── Step 4 · Farm ──
      farmTitle: 'Tell us about your farm',
      farmSubtitle: 'A few details help tailor advice. Skip anything you like.',
      landLabel: 'Land size',
      acres: 'acres',
      cropLabel: 'What do you grow?',
      cropHint: 'Pick all that apply',
      selectedCount: '{{count}} selected',
      soilLabel: 'Soil type',
      irrigationLabel: 'Water source',

      // ── Completion ──
      successTitle: "You're all set!",
      successSubtitle: 'Your profile is ready. Welcome to CropSetu.',
      successCta: 'Start exploring',

      // ── Saving / errors ──
      saving: 'Saving…',
      errNetwork: 'No internet. Check your connection and try again.',
      errSave: "We couldn't save your profile. Please try again.",

      // ── Option labels: crops ──
      crop: {
        wheat: 'Wheat', rice: 'Rice', maize: 'Maize', cotton: 'Cotton',
        sugarcane: 'Sugarcane', soybean: 'Soybean', groundnut: 'Groundnut',
        mustard: 'Mustard', bajra: 'Bajra', jowar: 'Jowar', gram: 'Gram',
        turmeric: 'Turmeric',
      },
      // ── Option labels: soil ──
      soil: {
        black: 'Black', red: 'Red', alluvial: 'Alluvial', sandy: 'Sandy',
        clay: 'Clay loam', laterite: 'Laterite', notsure: 'Not sure',
      },
      // ── Option labels: irrigation ──
      irrig: {
        canal: 'Canal', borewell: 'Borewell', drip: 'Drip',
        sprinkler: 'Sprinkler', rainfed: 'Rainfed', flood: 'Flood',
      },

      // ── Accessibility ──
      a11y: {
        progress: 'Step {{current}} of {{total}}',
        avatarEmpty: 'Add a profile photo, optional',
        avatarSet: 'Profile photo added. Double tap to change or remove.',
        avatarUploading: 'Uploading profile photo, {{percent}} percent',
        removePhoto: 'Remove profile photo',
        detect: 'Use my current location to fill the address',
        selectedOf: '{{label}}, selected',
        notSelectedOf: '{{label}}, not selected',
        decrease: 'Decrease land size',
        increase: 'Increase land size',
      },
    },
  },

  hi: {
    onb: {
      stepOf: 'चरण {{current}} / {{total}}',
      skip: 'अभी छोड़ें',
      back: 'पीछे',
      next: 'आगे',
      continue: 'जारी रखें',
      finish: 'पूरा करें',
      retry: 'फिर कोशिश करें',
      optional: 'वैकल्पिक',

      identityTitle: 'आइए आपकी प्रोफ़ाइल बनाएँ',
      identitySubtitle: 'एक फ़ोटो और अपना नाम जोड़ें ताकि लोग आपको पहचान सकें।',
      photoLabel: 'प्रोफ़ाइल फ़ोटो',
      addPhoto: 'फ़ोटो जोड़ें',
      changePhoto: 'बदलें',
      removePhoto: 'हटाएँ',
      takePhoto: 'फ़ोटो लें',
      chooseGallery: 'गैलरी से चुनें',
      photoUploading: 'फ़ोटो अपलोड हो रही है…',
      photoFailed: 'फ़ोटो अपलोड नहीं हुई। पुनः प्रयास के लिए टैप करें।',
      photoSheetTitle: 'प्रोफ़ाइल फ़ोटो',
      nameLabel: 'पूरा नाम',
      namePlaceholder: 'जैसे रमेश कुमार',
      nameRequired: 'जारी रखने के लिए कृपया अपना नाम दर्ज करें।',
      nameTooShort: 'नाम बहुत छोटा लगता है — कृपया जाँचें।',

      languageTitle: 'अपनी भाषा चुनें',
      languageSubtitle: 'पूरा ऐप इसी भाषा में होगा। आप इसे बाद में बदल सकते हैं।',

      locationTitle: 'आपका खेत कहाँ है?',
      locationSubtitle: 'इससे हम स्थानीय भाव, मौसम और योजनाएँ दिखा पाते हैं।',
      detect: 'मेरी वर्तमान लोकेशन उपयोग करें',
      detecting: 'आपकी लोकेशन खोजी जा रही है…',
      permissionDenied: 'लोकेशन बंद है। आप नीचे अपना पता टाइप कर सकते हैं।',
      permissionHint: 'ऑटो-भरने के लिए सेटिंग्स में लोकेशन चालू करें, या मैन्युअल भरें।',
      autoFilled: 'स्वतः भरा',
      villageLabel: 'गाँव',
      villagePlaceholder: 'गाँव या कस्बे का नाम',
      districtLabel: 'ज़िला',
      districtPlaceholder: 'ज़िले का नाम',
      stateLabel: 'राज्य',
      statePlaceholder: 'अपना राज्य चुनें',
      pincodeLabel: 'पिन कोड',
      pincodePlaceholder: '6 अंकों का पिन कोड',
      invalidPincode: 'मान्य 6 अंकों का पिन कोड दर्ज करें।',
      selectStateTitle: 'राज्य चुनें',
      locationFailed: 'लोकेशन नहीं मिली। कृपया मैन्युअल भरें।',

      farmTitle: 'अपने खेत के बारे में बताएँ',
      farmSubtitle: 'कुछ जानकारी सलाह को बेहतर बनाती है। जो चाहें छोड़ सकते हैं।',
      landLabel: 'ज़मीन का आकार',
      acres: 'एकड़',
      cropLabel: 'आप क्या उगाते हैं?',
      cropHint: 'सभी लागू विकल्प चुनें',
      selectedCount: '{{count}} चुने गए',
      soilLabel: 'मिट्टी का प्रकार',
      irrigationLabel: 'पानी का स्रोत',

      successTitle: 'सब तैयार है!',
      successSubtitle: 'आपकी प्रोफ़ाइल तैयार है। CropSetu में आपका स्वागत है।',
      successCta: 'शुरू करें',

      saving: 'सहेजा जा रहा है…',
      errNetwork: 'इंटरनेट नहीं है। कनेक्शन जाँचें और पुनः प्रयास करें।',
      errSave: 'हम आपकी प्रोफ़ाइल नहीं सहेज सके। कृपया पुनः प्रयास करें।',

      crop: {
        wheat: 'गेहूँ', rice: 'चावल', maize: 'मक्का', cotton: 'कपास',
        sugarcane: 'गन्ना', soybean: 'सोयाबीन', groundnut: 'मूँगफली',
        mustard: 'सरसों', bajra: 'बाजरा', jowar: 'ज्वार', gram: 'चना',
        turmeric: 'हल्दी',
      },
      soil: {
        black: 'काली', red: 'लाल', alluvial: 'जलोढ़', sandy: 'रेतीली',
        clay: 'चिकनी दोमट', laterite: 'लैटेराइट', notsure: 'पता नहीं',
      },
      irrig: {
        canal: 'नहर', borewell: 'बोरवेल', drip: 'ड्रिप',
        sprinkler: 'स्प्रिंकलर', rainfed: 'वर्षा आधारित', flood: 'पाट',
      },

      a11y: {
        progress: 'चरण {{current}} / {{total}}',
        avatarEmpty: 'प्रोफ़ाइल फ़ोटो जोड़ें, वैकल्पिक',
        avatarSet: 'प्रोफ़ाइल फ़ोटो जोड़ी गई। बदलने या हटाने के लिए डबल टैप करें।',
        avatarUploading: 'प्रोफ़ाइल फ़ोटो अपलोड हो रही है, {{percent}} प्रतिशत',
        removePhoto: 'प्रोफ़ाइल फ़ोटो हटाएँ',
        detect: 'पता भरने के लिए मेरी वर्तमान लोकेशन उपयोग करें',
        selectedOf: '{{label}}, चुना गया',
        notSelectedOf: '{{label}}, नहीं चुना गया',
        decrease: 'ज़मीन का आकार घटाएँ',
        increase: 'ज़मीन का आकार बढ़ाएँ',
      },
    },
  },
};

/**
 * createT — `t(key, vars)` stub bound to a language: dot-notation keys +
 * `{{var}}` interpolation, falling back to English then the key itself.
 * @param {'en'|'hi'|string} lang
 */
export function createT(lang = 'en') {
  const lookup = (dict, key) =>
    key.split('.').reduce((acc, k) => (acc == null ? acc : acc[k]), dict);
  return (key, vars) => {
    const raw = lookup(STRINGS[lang], key) ?? lookup(STRINGS.en, key);
    const value = typeof raw === 'string' ? raw : key;
    if (!vars) return value;
    return value.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) =>
      vars[k] != null ? String(vars[k]) : `{{${k}}}`,
    );
  };
}

const OnbStringsContext = createContext(createT('en'));

/**
 * OnbStringsProvider — supplies the `t` for the flow. Pass `t` to inject the
 * app's translator, or `lang` to use the bundled stub in that language.
 */
export function OnbStringsProvider({ t, lang = 'en', children }) {
  const value = useMemo(() => t || createT(lang), [t, lang]);
  return <OnbStringsContext.Provider value={value}>{children}</OnbStringsContext.Provider>;
}

export function useT() {
  return useContext(OnbStringsContext);
}
