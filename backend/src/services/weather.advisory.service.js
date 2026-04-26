/**
 * Weather Advisory Service
 * Generates actionable farming advisories from weather + soil data.
 * All advisories are multilingual (EN, HI, MR, TA, KN, ML, TE, BN, GU, PA).
 *
 * Advisory categories:
 *  - irrigation  : based on soil moisture + upcoming rain
 *  - spraying    : based on wind speed + rain probability
 *  - frost/heat  : temperature extremes
 *  - uv          : UV index fieldwork warning
 *  - storm       : thunderstorm/hail warning
 *  - harvest     : rain risk during harvest window
 */

// ── Advisory templates ─────────────────────────────────────────────────────────
const ADVISORIES = {
  irrigateToday: {
    id:       'irrigation',
    icon:     'water',
    color:    'orange',   // caution
    en: { title: 'Irrigate Today',          desc: 'Soil is dry and no rain expected. Water your crops now.' },
    hi: { title: 'आज सिंचाई करें',          desc: 'मिट्टी सूखी है और बारिश की उम्मीद नहीं। अभी सिंचाई करें।' },
    mr: { title: 'आज सिंचन करा',           desc: 'माती कोरडी आहे आणि पावसाची शक्यता नाही. आत्ताच सिंचन करा.' },
    ta: { title: 'இன்று நீர்ப்பாசனம் செய்யுங்கள்', desc: 'மண் வறண்டுள்ளது, மழை எதிர்பார்க்கப்படவில்லை.' },
    kn: { title: 'ಇಂದು ನೀರಾವರಿ ಮಾಡಿ',     desc: 'ಮಣ್ಣು ಒಣಗಿದೆ, ಮಳೆ ನಿರೀಕ್ಷೆಯಿಲ್ಲ.' },
    ml: { title: 'ഇന്ന് ജലസേചനം ചെയ്യുക',  desc: 'മണ്ണ് വരണ്ടതാണ്, മഴ പ്രതീക്ഷിക്കുന്നില്ല.' },
    te: { title: 'ఈరోజు నీరు పెట్టండి',     desc: 'నేల ఎండిపోయింది, వర్షం రాదు.' },
    bn: { title: 'আজ সেচ দিন',             desc: 'মাটি শুকনো, বৃষ্টির সম্ভাবনা নেই।' },
    gu: { title: 'આજે સિંચાઈ કરો',         desc: 'માટી સૂકી છે, વરસાદની શક્યતા નથી.' },
    pa: { title: 'ਅੱਜ ਸਿੰਚਾਈ ਕਰੋ',         desc: 'ਮਿੱਟੀ ਸੁੱਕੀ ਹੈ, ਮੀਂਹ ਦੀ ਉਮੀਦ ਨਹੀਂ।' },
  },
  skipIrrigation: {
    id:       'irrigation',
    icon:     'water-outline',
    color:    'green',    // safe
    en: { title: 'Skip Irrigation',         desc: 'Rain expected within 24h. Save water, skip watering.' },
    hi: { title: 'सिंचाई छोड़ें',            desc: '24 घंटे में बारिश संभव। पानी बचाएं, सिंचाई न करें।' },
    mr: { title: 'सिंचन टाळा',              desc: '24 तासांत पाऊस शक्य. पाणी वाचवा, सिंचन करू नका.' },
    ta: { title: 'நீர்ப்பாசனம் தவிர்க்கவும்', desc: '24 மணி நேரத்தில் மழை வரலாம். நீரைச் சேமியுங்கள்.' },
    kn: { title: 'ನೀರಾವರಿ ಬಿಡಿ',           desc: '24 ಗಂಟೆಯಲ್ಲಿ ಮಳೆ ಸಾಧ್ಯ. ನೀರು ಉಳಿಸಿ.' },
    ml: { title: 'ജലസേചനം ഒഴിവാക്കുക',     desc: '24 മണിക്കൂറിൽ മഴ പ്രതീക്ഷിക്കുന്നു. വെള്ളം ലാഭിക്കുക.' },
    te: { title: 'నీరు పెట్టవద్దు',          desc: '24 గంటల్లో వర్షం రావచ్చు. నీరు ఆదా చేయండి.' },
    bn: { title: 'সেচ দেবেন না',            desc: '24 ঘণ্টায় বৃষ্টি হতে পারে। জল সাশ্রয় করুন।' },
    gu: { title: 'સિંચાઈ ટાળો',             desc: '24 કલાકમાં વરસાદ શક્ય. પાણી બચાવો.' },
    pa: { title: 'ਸਿੰਚਾਈ ਛੱਡੋ',             desc: '24 ਘੰਟਿਆਂ ਵਿੱਚ ਮੀਂਹ ਹੋ ਸਕਦਾ ਹੈ। ਪਾਣੀ ਬਚਾਓ।' },
  },
  avoidSpraying: {
    id:       'spraying',
    icon:     'cloud-upload',
    color:    'red',      // warning
    en: { title: 'Avoid Spraying',          desc: 'High wind or rain expected. Pesticide/fertilizer spraying not effective.' },
    hi: { title: 'छिड़काव न करें',          desc: 'तेज हवा या बारिश। कीटनाशक/उर्वरक छिड़काव प्रभावी नहीं होगा।' },
    mr: { title: 'फवारणी टाळा',             desc: 'जोरदार वारा किंवा पाऊस. कीटकनाशक/खत फवारणी प्रभावी नाही.' },
    ta: { title: 'தெளிப்பு தவிர்க்கவும்',   desc: 'காற்று அல்லது மழை. பூச்சிக்கொல்லி தெளிப்பு பலனளிக்காது.' },
    kn: { title: 'ಸಿಂಪಡಿಸಬೇಡಿ',            desc: 'ಗಾಳಿ ಅಥವಾ ಮಳೆ. ಕೀಟನಾಶಕ ಸಿಂಪಡಣೆ ಪರಿಣಾಮಕಾರಿಯಲ್ಲ.' },
    ml: { title: 'തളിക്കരുത്',             desc: 'ശക്തമായ കാറ്റ് അല്ലെങ്കിൽ മഴ. കീടനാശിനി ഫലപ്രദമാകില്ല.' },
    te: { title: 'పిచికారీ చేయవద్దు',        desc: 'గాలి లేదా వర్షం. పురుగుమందు పిచికారీ పనిచేయదు.' },
    bn: { title: 'স্প্রে করবেন না',          desc: 'তীব্র বাতাস বা বৃষ্টি। কীটনাশক স্প্রে কার্যকর হবে না।' },
    gu: { title: 'છંટકાવ ટાળો',             desc: 'તેજ પવન અથવા વરસાદ. જંતુનાશક છંટકાવ અસરકારક નહીં.' },
    pa: { title: 'ਛਿੜਕਾਅ ਨਾ ਕਰੋ',           desc: 'ਤੇਜ਼ ਹਵਾ ਜਾਂ ਮੀਂਹ। ਕੀਟਨਾਸ਼ਕ ਛਿੜਕਾਅ ਅਸਰਦਾਰ ਨਹੀਂ।' },
  },
  goodForSpraying: {
    id:       'spraying',
    icon:     'leaf',
    color:    'green',
    en: { title: 'Good for Spraying',       desc: 'Calm wind and clear sky. Ideal time for pesticide or fertilizer application.' },
    hi: { title: 'छिड़काव के लिए अच्छा',    desc: 'कम हवा और साफ आसमान। कीटनाशक/उर्वरक छिड़काव का उचित समय।' },
    mr: { title: 'फवारणीसाठी योग्य',        desc: 'शांत वारा आणि स्वच्छ आकाश. कीटकनाशक/खत फवारणीसाठी उत्तम वेळ.' },
    ta: { title: 'தெளிப்புக்கு ஏற்ற நேரம்', desc: 'காற்று குறைவு, தெளிவான வானம். பூச்சிக்கொல்லி தெளிக்க சரியான நேரம்.' },
    kn: { title: 'ಸಿಂಪಡಣೆಗೆ ಒಳ್ಳೆಯ ಸಮಯ',  desc: 'ಶಾಂತ ಗಾಳಿ, ಸ್ವಚ್ಛ ಆಕಾಶ. ಕೀಟನಾಶಕ ಸಿಂಪಡಣೆಗೆ ಸೂಕ್ತ.' },
    ml: { title: 'തളിക്കാൻ നല്ല സമയം',     desc: 'ശാന്തമായ കാറ്റ്, തെളിഞ്ഞ ആകാശം. കീടനാശിനി തളിക്കാൻ അനുയോജ്യം.' },
    te: { title: 'పిచికారీకి మంచి సమయం',    desc: 'గాలి తక్కువ, ఆకాశం స్వచ్ఛం. పురుగుమందు పిచికారీకి అనుకూలం.' },
    bn: { title: 'স্প্রে করার উপযুক্ত সময়', desc: 'শান্ত বাতাস ও পরিষ্কার আকাশ। কীটনাশক স্প্রের আদর্শ সময়।' },
    gu: { title: 'છંટકાવ માટે સારો સમય',    desc: 'શાંત પવન અને ચોખ્ખું આકાશ. જંતુનાશક છંટકાવ માટે યોગ્ય.' },
    pa: { title: 'ਛਿੜਕਾਅ ਲਈ ਵਧੀਆ ਸਮਾਂ',    desc: 'ਹਲਕੀ ਹਵਾ ਤੇ ਸਾਫ਼ ਅਸਮਾਨ। ਕੀਟਨਾਸ਼ਕ ਛਿੜਕਾਅ ਦਾ ਸਹੀ ਸਮਾਂ।' },
  },
  frostRisk: {
    id:       'frost',
    icon:     'snow',
    color:    'red',
    en: { title: 'Frost Risk Tonight',      desc: 'Temperature may drop below 5°C. Cover sensitive crops and seedlings.' },
    hi: { title: 'आज रात पाला पड़ सकता है', desc: 'तापमान 5°C से नीचे जा सकता है। नाजुक फसलें ढकें।' },
    mr: { title: 'आज रात्री दंव पडू शकतो', desc: 'तापमान 5°C खाली जाऊ शकते. नाजूक पिके झाकून ठेवा.' },
    ta: { title: 'இன்றிரவு உறைபனி அபாயம்', desc: 'வெப்பநிலை 5°C கீழே குறையலாம். மென்மையான பயிர்களை மூடுங்கள்.' },
    kn: { title: 'ಇಂದು ರಾತ್ರಿ ಹಿಮ ಅಪಾಯ',  desc: 'ತಾಪಮಾನ 5°C ಕೆಳಗೆ ಇಳಿಯಬಹುದು. ಸೂಕ್ಷ್ಮ ಬೆಳೆ ಮುಚ್ಚಿರಿ.' },
    ml: { title: 'ഇന്ന് രാത്രി മഞ്ഞ് അപകടം', desc: 'താപനില 5°C-ൽ താഴെ പോകാം. ദുർബല വിളകൾ മൂടുക.' },
    te: { title: 'ఈ రాత్రి మంచు ప్రమాదం',   desc: 'ఉష్ణోగ్రత 5°C కంటే తగ్గవచ్చు. సున్నితమైన పంటలను కప్పండి.' },
    bn: { title: 'আজ রাতে তুষারপাতের ঝুঁকি', desc: 'তাপমাত্রা 5°C-র নিচে যেতে পারে। সংবেদনশীল ফসল ঢেকে দিন।' },
    gu: { title: 'આજે રાત્રે હિમ જોખમ',     desc: 'તાપમાન 5°C થી નીચે જઈ શકે. નાજુક પાક ઢાંકો.' },
    pa: { title: 'ਅੱਜ ਰਾਤ ਕੋਰੇ ਦਾ ਖ਼ਤਰਾ',   desc: 'ਤਾਪਮਾਨ 5°C ਤੋਂ ਹੇਠਾਂ ਜਾ ਸਕਦਾ ਹੈ। ਨਾਜ਼ੁਕ ਫ਼ਸਲਾਂ ਢੱਕੋ।' },
  },
  extremeHeat: {
    id:       'heat',
    icon:     'sunny',
    color:    'red',
    en: { title: 'Extreme Heat Warning',    desc: 'Max temp above 42°C. Protect crops, irrigate in evening, avoid fieldwork 11am–3pm.' },
    hi: { title: 'अत्यधिक गर्मी चेतावनी',  desc: 'तापमान 42°C से ऊपर। शाम को सिंचाई करें, 11–3 बजे खेत में न जाएं।' },
    mr: { title: 'अत्यंत उष्णतेचा इशारा',  desc: 'तापमान 42°C वर. संध्याकाळी सिंचन करा, 11–3 शेतात जाऊ नका.' },
    ta: { title: 'கடும் வெப்ப எச்சரிக்கை',  desc: 'வெப்பநிலை 42°C மேல். மாலையில் நீர்ப்பாசனம், 11–3 வயலுக்கு செல்ல வேண்டாம்.' },
    kn: { title: 'ತೀವ್ರ ಶಾಖ ಎಚ್ಚರಿಕೆ',     desc: 'ತಾಪಮಾನ 42°C ಮೇಲೆ. ಸಂಜೆ ನೀರಾವರಿ, 11–3 ಕೆಲಸ ಬೇಡ.' },
    ml: { title: 'കടുത്ത ചൂട് മുന്നറിയിപ്പ്', desc: 'താപനില 42°C-ന് മുകളിൽ. വൈകുന്നേരം ജലസേചനം, 11–3 പണി വേണ്ട.' },
    te: { title: 'తీవ్ర వేడి హెచ్చరిక',      desc: 'ఉష్ణోగ్రత 42°C పైన. సాయంత్రం నీరు పెట్టండి, 11–3 పొలం వద్దు.' },
    bn: { title: 'তীব্র গরমের সতর্কতা',     desc: 'তাপমাত্রা 42°C-র উপরে। সন্ধ্যায় সেচ দিন, 11–3টা মাঠে যাবেন না।' },
    gu: { title: 'ભારે ગરમીની ચેતવણી',      desc: 'તાપમાન 42°C ઉપર. સાંજે સિંચાઈ કરો, 11–3 ખેતરે ન જાવ.' },
    pa: { title: 'ਬਹੁਤ ਗਰਮੀ ਦੀ ਚੇਤਾਵਨੀ',    desc: 'ਤਾਪਮਾਨ 42°C ਤੋਂ ਉੱਪਰ। ਸ਼ਾਮ ਨੂੰ ਸਿੰਚਾਈ ਕਰੋ, 11–3 ਖੇਤ ਨਾ ਜਾਓ।' },
  },
  highUV: {
    id:       'uv',
    icon:     'sunny-outline',
    color:    'orange',
    en: { title: 'High UV — Limit Fieldwork', desc: 'UV index above 8. Avoid fieldwork 11am–3pm. Wear protective clothing.' },
    hi: { title: 'तेज धूप — सावधानी बरतें', desc: 'UV इंडेक्स 8 से ऊपर। 11–3 बजे खेत में काम न करें।' },
    mr: { title: 'तीव्र UV — काळजी घ्या',   desc: 'UV निर्देशांक 8 वर. 11–3 शेतात काम टाळा.' },
    ta: { title: 'அதிக UV — கவனம்',         desc: 'UV குறியீடு 8 மேல். 11–3 வயல் வேலை தவிர்க்கவும்.' },
    kn: { title: 'ಹೆಚ್ಚಿನ UV — ಎಚ್ಚರಿಕೆ',  desc: 'UV ಸೂಚ್ಯಂಕ 8 ಮೇಲೆ. 11–3 ಕೆಲಸ ಬೇಡ.' },
    ml: { title: 'ഉയർന്ന UV — ജാഗ്രത',      desc: 'UV സൂചിക 8-ന് മുകളിൽ. 11–3 പണി ഒഴിവാക്കുക.' },
    te: { title: 'ఎక్కువ UV — జాగ్రత్త',    desc: 'UV సూచీ 8 పైన. 11–3 పొలం పని చేయవద్దు.' },
    bn: { title: 'উচ্চ UV — সতর্কতা',       desc: 'UV সূচক 8-র উপরে। 11–3টা মাঠে কাজ করবেন না।' },
    gu: { title: 'ઊંચો UV — સાવધાની',       desc: 'UV ઈન્ડેક્સ 8 ઉપર. 11–3 ખેતરે કામ ટાળો.' },
    pa: { title: 'ਤੇਜ਼ ਧੁੱਪ — ਸਾਵਧਾਨੀ',     desc: 'UV ਸੂਚਕ 8 ਤੋਂ ਉੱਪਰ। 11–3 ਖੇਤ ਵਿੱਚ ਕੰਮ ਨਾ ਕਰੋ।' },
  },
  stormWarning: {
    id:       'storm',
    icon:     'thunderstorm',
    color:    'red',
    en: { title: 'Thunderstorm Warning',    desc: 'Thunderstorm expected. Secure equipment, stay indoors, delay harvesting.' },
    hi: { title: 'आंधी-तूफान की चेतावनी',  desc: 'तूफान आ सकता है। उपकरण सुरक्षित करें, घर के अंदर रहें।' },
    mr: { title: 'वादळाचा इशारा',           desc: 'वादळ येऊ शकते. साधने सुरक्षित करा, घरात रहा.' },
    ta: { title: 'புயல் எச்சரிக்கை',        desc: 'இடியுடன் மழை வரலாம். உபகரணங்களைப் பாதுகாக்கவும்.' },
    kn: { title: 'ಬಿರುಗಾಳಿ ಎಚ್ಚರಿಕೆ',      desc: 'ಗುಡುಗು ಮಳೆ ಸಾಧ್ಯ. ಉಪಕರಣ ಸುರಕ್ಷಿತವಾಗಿಡಿ, ಒಳಗಿರಿ.' },
    ml: { title: 'കൊടുങ്കാറ്റ് മുന്നറിയിപ്പ്', desc: 'ഇടിമിന്നലോടെ മഴ വരാം. ഉപകരണങ്ങൾ സുരക്ഷിതമാക്കുക.' },
    te: { title: 'తుఫాను హెచ్చరిక',         desc: 'ఉరుములతో వర్షం రావచ్చు. పరికరాలు భద్రపరచండి, లోపల ఉండండి.' },
    bn: { title: 'ঝড়ের সতর্কতা',            desc: 'বজ্রঝড় আসতে পারে। যন্ত্রপাতি সুরক্ষিত করুন, ঘরে থাকুন।' },
    gu: { title: 'વાવાઝોડાની ચેતવણી',       desc: 'વાવાઝોડું આવી શકે. સાધનો સુરક્ષિત કરો, ઘરમાં રહો.' },
    pa: { title: 'ਤੂਫ਼ਾਨ ਦੀ ਚੇਤਾਵਨੀ',       desc: 'ਗਰਜ ਨਾਲ ਮੀਂਹ ਆ ਸਕਦਾ ਹੈ। ਸਾਮਾਨ ਸੁਰੱਖਿਅਤ ਕਰੋ, ਅੰਦਰ ਰਹੋ।' },
  },
  harvestRisk: {
    id:       'harvest',
    icon:     'cut',
    color:    'orange',
    en: { title: 'Harvest Risk — Rain Coming', desc: 'Rain expected in 2 days. Harvest mature crops before rains if possible.' },
    hi: { title: 'कटाई का ख़तरा — बारिश आने वाली', desc: '2 दिन में बारिश। पकी फसल जल्दी काटें।' },
    mr: { title: 'कापणीचा धोका — पाऊस येतोय', desc: '2 दिवसांत पाऊस. पिकलेले पीक लवकर कापा.' },
    ta: { title: 'அறுவடை அபாயம் — மழை வரும்', desc: '2 நாளில் மழை. முதிர்ந்த பயிரை விரைவில் அறுவடை செய்யுங்கள்.' },
    kn: { title: 'ಕೊಯ್ಲು ಅಪಾಯ — ಮಳೆ ಬರುತ್ತದೆ', desc: '2 ದಿನದಲ್ಲಿ ಮಳೆ. ಹಣ್ಣಾದ ಬೆಳೆ ಬೇಗ ಕೊಯ್ಯಿರಿ.' },
    ml: { title: 'വിളവെടുപ്പ് അപകടം — മഴ വരുന്നു', desc: '2 ദിവസത്തിൽ മഴ. പാകമായ വിള വേഗം കൊയ്യുക.' },
    te: { title: 'కోత ప్రమాదం — వర్షం రాబోతోంది', desc: '2 రోజుల్లో వర్షం. పక్వమైన పంట త్వరగా కోయండి.' },
    bn: { title: 'ফসল কাটার ঝুঁকি — বৃষ্টি আসছে', desc: '2 দিনে বৃষ্টি। পাকা ফসল দ্রুত কাটুন।' },
    gu: { title: 'લણણીનું જોખમ — વરસાદ આવશે', desc: '2 દિવસમાં વરસાદ. પાકેલો પાક જલદી કાપો.' },
    pa: { title: 'ਵਾਢੀ ਦਾ ਖ਼ਤਰਾ — ਮੀਂਹ ਆ ਰਿਹਾ', desc: '2 ਦਿਨਾਂ ਵਿੱਚ ਮੀਂਹ। ਪੱਕੀ ਫ਼ਸਲ ਜਲਦੀ ਵੱਢੋ।' },
  },
  goodWeather: {
    id:       'general',
    icon:     'checkmark-circle',
    color:    'green',
    en: { title: 'Good Farming Weather',    desc: 'Pleasant conditions. Good time to inspect crops for pest and disease signs.' },
    hi: { title: 'खेती के लिए अच्छा मौसम', desc: 'मौसम अनुकूल है। कीट और बीमारी की जांच करने का अच्छा समय।' },
    mr: { title: 'शेतीसाठी चांगले हवामान',  desc: 'हवामान अनुकूल आहे. कीड आणि रोग तपासण्याची चांगली वेळ.' },
    ta: { title: 'விவசாயத்திற்கு நல்ல வானிலை', desc: 'சூழ்நிலை சாதகமானது. பூச்சி/நோய் சோதனைக்கு நல்ல நேரம்.' },
    kn: { title: 'ಕೃಷಿಗೆ ಒಳ್ಳೆಯ ಹವಾಮಾನ',  desc: 'ಹವಾಮಾನ ಅನುಕೂಲ. ಕೀಟ ಮತ್ತು ರೋಗ ತಪಾಸಣೆಗೆ ಒಳ್ಳೆಯ ಸಮಯ.' },
    ml: { title: 'കൃഷിക്ക് നല്ല കാലാവസ്ഥ', desc: 'കാലാവസ്ഥ അനുകൂലം. കീട-രോഗ പരിശോധനയ്ക്ക് നല്ല സമയം.' },
    te: { title: 'వ్యవసాయానికి మంచి వాతావరణం', desc: 'వాతావరణం అనుకూలం. చీడపీడల తనిఖీకి మంచి సమయం.' },
    bn: { title: 'চাষের জন্য ভালো আবহাওয়া', desc: 'আবহাওয়া অনুকূল। পোকা ও রোগ পরীক্ষার ভালো সময়।' },
    gu: { title: 'ખેતી માટે સારું વાતાવરણ',  desc: 'વાતાવરણ અનુકૂળ. જીવાત અને રોગ તપાસ માટે સારો સમય.' },
    pa: { title: 'ਖੇਤੀ ਲਈ ਵਧੀਆ ਮੌਸਮ',      desc: 'ਮੌਸਮ ਅਨੁਕੂਲ ਹੈ। ਕੀੜੇ ਤੇ ਬਿਮਾਰੀ ਦੀ ਜਾਂਚ ਦਾ ਵਧੀਆ ਸਮਾਂ।' },
  },
  fungalRisk: {
    id:       'disease',
    icon:     'bug',
    color:    'red',
    en: { title: 'High Fungal Disease Risk', desc: 'Leaf wetness high + humid conditions. Apply fungicide. Check for blight, mildew.' },
    hi: { title: 'फंगल रोग का ख़तरा',       desc: 'पत्तियाँ गीली हैं। फफूंदनाशक का छिड़काव करें। झुलसा और फफूंदी जांचें।' },
    mr: { title: 'बुरशीजन्य रोगाचा धोका',  desc: 'पाने ओली आहेत. बुरशीनाशक फवारा. करपा आणि बुरशी तपासा.' },
    ta: { title: 'பூஞ்சை நோய் அபாயம்',     desc: 'இலைகள் ஈரமாக உள்ளன. பூஞ்சைக்கொல்லி தெளியுங்கள்.' },
    kn: { title: 'ಶಿಲೀಂಧ್ರ ರೋಗ ಅಪಾಯ',     desc: 'ಎಲೆಗಳು ತೇವವಾಗಿವೆ. ಶಿಲೀಂಧ್ರನಾಶಕ ಸಿಂಪಡಿಸಿ.' },
    ml: { title: 'കുമിൾ രോഗ അപകടം',        desc: 'ഇലകൾ നനഞ്ഞിരിക്കുന്നു. കുമിൾനാശിനി തളിക്കുക.' },
    te: { title: 'శిలీంధ్ర వ్యాధి ప్రమాదం', desc: 'ఆకులు తడిగా ఉన్నాయి. శిలీంధ్రనాశని పిచికారీ చేయండి.' },
    bn: { title: 'ছত্রাক রোগের ঝুঁকি',      desc: 'পাতা ভেজা। ছত্রাকনাশক স্প্রে করুন। ব্লাইট পরীক্ষা করুন।' },
    gu: { title: 'ફૂગ રોગનું જોખમ',         desc: 'પાંદડા ભીના છે. ફૂગનાશક છંટકાવ કરો. ઝાળ તપાસો.' },
    pa: { title: 'ਫੰਗਲ ਰੋਗ ਦਾ ਖ਼ਤਰਾ',       desc: 'ਪੱਤੇ ਗਿੱਲੇ ਹਨ। ਉੱਲੀਨਾਸ਼ਕ ਛਿੜਕੋ। ਝੁਲਸ ਦੀ ਜਾਂਚ ਕਰੋ।' },
  },
  lowVisibility: {
    id:       'visibility',
    icon:     'eye-off',
    color:    'orange',
    en: { title: 'Low Visibility — Fog/Haze', desc: 'Visibility below 2km. Delay spray operations and machinery movement.' },
    hi: { title: 'कम दृश्यता — कोहरा/धुंध',  desc: 'दृश्यता 2km से कम। छिड़काव और यंत्र संचालन रोकें।' },
    mr: { title: 'कमी दृश्यता — धुके/धूसर', desc: 'दृश्यता 2km पेक्षा कमी. फवारणी आणि यंत्र चालवणे थांबवा.' },
    ta: { title: 'குறைந்த பார்வை — மூடுபனி', desc: 'பார்வைத் தூரம் 2km-க்கு குறைவு. தெளிப்பு, இயந்திர இயக்கம் நிறுத்துங்கள்.' },
    kn: { title: 'ಕಡಿಮೆ ಗೋಚರತೆ — ಮಂಜು',    desc: 'ಗೋಚರತೆ 2km ಕಡಿಮೆ. ಸಿಂಪಡಣೆ ಮತ್ತು ಯಂತ್ರ ಬಳಕೆ ನಿಲ್ಲಿಸಿ.' },
    ml: { title: 'കുറഞ്ഞ ദൃശ്യത — മൂടൽമഞ്ഞ്', desc: 'ദൃശ്യത 2km-ൽ താഴെ. തളിക്കലും യന്ത്ര ഉപയോഗവും നിർത്തുക.' },
    te: { title: 'తక్కువ దృశ్యత — పొగమంచు', desc: 'దృశ్యత 2km కంటే తక్కువ. పిచికారీ, యంత్ర నడకను ఆపండి.' },
    bn: { title: 'কম দৃশ্যমানতা — কুয়াশা',  desc: 'দৃশ্যমানতা 2km-র কম। স্প্রে ও যন্ত্র চালানো বন্ধ করুন।' },
    gu: { title: 'ઓછી દૃશ્યતા — ધુમ્મસ',    desc: 'દૃશ્યતા 2km થી ઓછી. છંટકાવ અને યંત્ર સંચાલન અટકાવો.' },
    pa: { title: 'ਘੱਟ ਦਿੱਖ — ਧੁੰਦ',         desc: 'ਦਿੱਖ 2km ਤੋਂ ਘੱਟ। ਛਿੜਕਾਅ ਤੇ ਮਸ਼ੀਨ ਚਲਾਉਣਾ ਬੰਦ ਕਰੋ।' },
  },
  highVPD: {
    id:       'vpd',
    icon:     'water-outline',
    color:    'orange',
    en: { title: 'High Crop Water Stress',   desc: 'Vapour pressure deficit is high. Crops are losing water fast. Irrigate soon.' },
    hi: { title: 'फसल पर जल तनाव अधिक',    desc: 'हवा बहुत शुष्क है, फसल तेज़ी से पानी खो रही है। जल्दी सिंचाई करें।' },
    mr: { title: 'पिकावर जल ताण जास्त',     desc: 'हवा खूप कोरडी आहे, पीक वेगाने पाणी गमावत आहे. लवकर सिंचन करा.' },
    ta: { title: 'பயிர் நீர் அழுத்தம் அதிகம்', desc: 'காற்று மிகவும் வறண்டது, பயிர் வேகமாக நீரை இழக்கிறது. விரைவில் நீர்ப்பாசனம்.' },
    kn: { title: 'ಬೆಳೆ ನೀರಿನ ಒತ್ತಡ ಹೆಚ್ಚು', desc: 'ಗಾಳಿ ತುಂಬಾ ಶುಷ್ಕ, ಬೆಳೆ ವೇಗವಾಗಿ ನೀರು ಕಳೆಯುತ್ತಿದೆ. ಬೇಗ ನೀರಾವರಿ.' },
    ml: { title: 'വിളയിൽ ജല സമ്മർദ്ദം കൂടുതൽ', desc: 'വായു വളരെ വരണ്ടത്, വിള വേഗം വെള്ളം നഷ്ടപ്പെടുത്തുന്നു. വേഗം ജലസേചനം.' },
    te: { title: 'పంటపై నీటి ఒత్తిడి ఎక్కువ', desc: 'గాలి చాలా పొడిగా ఉంది, పంట వేగంగా నీరు కోల్పోతోంది. త్వరగా నీరు పెట్టండి.' },
    bn: { title: 'ফসলে জলের চাপ বেশি',       desc: 'বাতাস খুব শুষ্ক, ফসল দ্রুত জল হারাচ্ছে। তাড়াতাড়ি সেচ দিন।' },
    gu: { title: 'પાક પર જળ તાણ વધુ',       desc: 'હવા ખૂબ સૂકી, પાક ઝડપથી પાણી ગુમાવે છે. જલદી સિંચાઈ કરો.' },
    pa: { title: 'ਫ਼ਸਲ ਤੇ ਪਾਣੀ ਦਾ ਤਣਾਅ',    desc: 'ਹਵਾ ਬਹੁਤ ਖੁਸ਼ਕ, ਫ਼ਸਲ ਤੇਜ਼ੀ ਨਾਲ ਪਾਣੀ ਗੁਆ ਰਹੀ। ਜਲਦੀ ਸਿੰਚਾਈ ਕਰੋ।' },
  },
  strongStorm: {
    id:       'cape',
    icon:     'flash',
    color:    'red',
    en: { title: 'Severe Storm Risk (CAPE High)', desc: 'Atmospheric instability very high. Strong thunderstorms, hail possible. Stay indoors.' },
    hi: { title: 'भारी तूफ़ान का ख़तरा',          desc: 'वायुमंडल बहुत अस्थिर है। तेज़ तूफ़ान और ओले पड़ सकते हैं। घर के अंदर रहें।' },
    mr: { title: 'तीव्र वादळाचा धोका',          desc: 'वातावरण अत्यंत अस्थिर. जोरदार वादळ आणि गारा पडू शकतात. घरात रहा.' },
    ta: { title: 'கடும் புயல் அபாயம்',          desc: 'வளிமண்டலம் மிகவும் நிலையற்றது. கடும் புயல், ஆலங்கட்டி வரலாம்.' },
    kn: { title: 'ತೀವ್ರ ಬಿರುಗಾಳಿ ಅಪಾಯ',       desc: 'ವಾತಾವರಣ ತುಂಬಾ ಅಸ್ಥಿರ. ಭಾರಿ ಬಿರುಗಾಳಿ, ಆಲಿಕಲ್ಲು ಸಾಧ್ಯ. ಒಳಗಿರಿ.' },
    ml: { title: 'കടുത്ത കൊടുങ്കാറ്റ് അപകടം', desc: 'അന്തരീക്ഷം വളരെ അസ്ഥിരം. ശക്തമായ കൊടുങ്കാറ്റ്, ആലിപ്പഴം സാധ്യം.' },
    te: { title: 'తీవ్ర తుఫాను ప్రమాదం',       desc: 'వాతావరణం చాలా అస్థిరం. భారీ తుఫాను, వడగళ్ళు రావచ్చు. లోపల ఉండండి.' },
    bn: { title: 'তীব্র ঝড়ের ঝুঁকি',           desc: 'বায়ুমণ্ডল অত্যন্ত অস্থির। তীব্র ঝড় ও শিলাবৃষ্টি হতে পারে। ঘরে থাকুন।' },
    gu: { title: 'ભારે વાવાઝોડાનું જોખમ',      desc: 'વાતાવરણ ખૂબ અસ્થિર. ભારે તોફાન અને કરા પડી શકે. ઘરમાં રહો.' },
    pa: { title: 'ਭਾਰੀ ਤੂਫ਼ਾਨ ਦਾ ਖ਼ਤਰਾ',       desc: 'ਵਾਯੂਮੰਡਲ ਬਹੁਤ ਅਸਥਿਰ। ਤੇਜ਼ ਤੂਫ਼ਾਨ ਤੇ ਗੜੇ ਪੈ ਸਕਦੇ ਹਨ। ਅੰਦਰ ਰਹੋ।' },
  },
  goodSolar: {
    id:       'solar',
    icon:     'sunny',
    color:    'green',
    en: { title: 'Excellent Solar Day',      desc: 'High sunshine hours today. Good for solar drying of crops and solar pump use.' },
    hi: { title: 'बेहतरीन धूप का दिन',      desc: 'आज अच्छी धूप है। फसल सुखाने और सोलर पंप के लिए उत्तम समय।' },
    mr: { title: 'उत्कृष्ट ऊन्हाचा दिवस',  desc: 'आज चांगली ऊन्ह आहे. पीक वाळवणे आणि सोलर पंपासाठी उत्तम.' },
    ta: { title: 'சிறந்த சூரிய ஒளி நாள்',   desc: 'இன்று நல்ல வெயில். பயிர் உலர்த்த, சோலார் பம்ப் பயன்படுத்த நல்லது.' },
    kn: { title: 'ಅತ್ಯುತ್ತಮ ಬಿಸಿಲು ದಿನ',   desc: 'ಇಂದು ಒಳ್ಳೆಯ ಬಿಸಿಲು. ಬೆಳೆ ಒಣಗಿಸಲು ಮತ್ತು ಸೋಲಾರ್ ಪಂಪ್‌ಗೆ ಉತ್ತಮ.' },
    ml: { title: 'മികച്ച സൂര്യപ്രകാശ ദിനം', desc: 'ഇന്ന് നല്ല വെയിൽ. വിള ഉണക്കാനും സോളാർ പമ്പിനും നല്ലത്.' },
    te: { title: 'అద్భుతమైన ఎండ రోజు',      desc: 'ఈరోజు మంచి ఎండ. పంట ఎండబెట్టడానికి, సోలార్ పంపుకు అనుకూలం.' },
    bn: { title: 'দুর্দান্ত রোদের দিন',      desc: 'আজ ভালো রোদ। ফসল শুকানো ও সোলার পাম্পের জন্য উত্তম।' },
    gu: { title: 'ઉત્તમ તડકાનો દિવસ',       desc: 'આજે સારો તડકો. પાક સૂકવવા અને સોલર પંપ માટે ઉત્તમ.' },
    pa: { title: 'ਵਧੀਆ ਧੁੱਪ ਵਾਲਾ ਦਿਨ',      desc: 'ਅੱਜ ਚੰਗੀ ਧੁੱਪ ਹੈ। ਫ਼ਸਲ ਸੁਕਾਉਣ ਤੇ ਸੋਲਰ ਪੰਪ ਲਈ ਵਧੀਆ।' },
  },
  dewPointRisk: {
    id:       'dew',
    icon:     'thermometer',
    color:    'orange',
    en: { title: 'Dew Point Alert',          desc: 'Temperature near dew point. Condensation on crops increases disease risk at night.' },
    hi: { title: 'ओस बिंदु चेतावनी',         desc: 'तापमान ओस बिंदु के पास है। रात में फसल पर नमी से बीमारी का खतरा।' },
    mr: { title: 'दवबिंदू इशारा',            desc: 'तापमान दवबिंदूजवळ आहे. रात्री पिकावर दव पडून रोग वाढू शकतो.' },
    ta: { title: 'பனிப்புள்ளி எச்சரிக்கை',   desc: 'வெப்பநிலை பனிப்புள்ளிக்கு அருகில். இரவில் பயிரில் ஈரம் நோயை அதிகரிக்கும்.' },
    kn: { title: 'ಇಬ್ಬನಿ ಬಿಂದು ಎಚ್ಚರಿಕೆ',   desc: 'ತಾಪಮಾನ ಇಬ್ಬನಿ ಬಿಂದುವಿನ ಹತ್ತಿರ. ರಾತ್ರಿ ಬೆಳೆ ಮೇಲೆ ತೇವ ರೋಗ ಹೆಚ್ಚಿಸಬಹುದು.' },
    ml: { title: 'മഞ്ഞുബിന്ദു മുന്നറിയിപ്പ്', desc: 'താപനില മഞ്ഞുബിന്ദുവിനടുത്ത്. രാത്രി വിളയിൽ ഈർപ്പം രോഗം വർധിപ്പിക്കും.' },
    te: { title: 'మంచు బిందువు హెచ్చరిక',    desc: 'ఉష్ణోగ్రత మంచు బిందువు దగ్గర. రాత్రి పంటపై తేమ వ్యాధి పెంచవచ్చు.' },
    bn: { title: 'শিশিরাঙ্ক সতর্কতা',        desc: 'তাপমাত্রা শিশিরাঙ্কের কাছে। রাতে ফসলে আর্দ্রতায় রোগের ঝুঁকি।' },
    gu: { title: 'ઝાકળ બિંદુ ચેતવણી',       desc: 'તાપમાન ઝાકળ બિંદુ નજીક. રાત્રે પાક પર ભેજથી રોગ વધી શકે.' },
    pa: { title: 'ਤ੍ਰੇਲ ਬਿੰਦੂ ਚੇਤਾਵਨੀ',     desc: 'ਤਾਪਮਾਨ ਤ੍ਰੇਲ ਬਿੰਦੂ ਦੇ ਨੇੜੇ। ਰਾਤ ਨੂੰ ਫ਼ਸਲ ਤੇ ਨਮੀ ਨਾਲ ਬਿਮਾਰੀ ਦਾ ਖ਼ਤਰਾ।' },
  },
};

function makeAdvisory(key, lang) {
  const a = ADVISORIES[key];
  return {
    id:    a.id,
    icon:  a.icon,
    color: a.color,
    ...(a[lang] || a.hi || a.en),
  };
}

/**
 * Generate farming advisories from weather + soil + agriculture data.
 *
 * @param {object} current        - current weather (from openMeteo)
 * @param {object} daily          - array of daily forecasts
 * @param {object} agriculture    - soil temperature + moisture + ET
 * @param {'en'|'hi'} lang
 * @returns {Array} advisories[]
 */
export function generateAdvisories(current, daily, agriculture, lang = 'en') {
  const advisories = [];
  const tomorrow   = daily?.[1] || daily?.[0];
  const today      = daily?.[0];

  // ── Severe storm via CAPE (highest priority) ──────────────────────────────
  if (current.cape != null && current.cape > 1000) {
    advisories.push(makeAdvisory('strongStorm', lang));
  } else if (current.isStorm || current.weatherCode >= 95) {
    advisories.push(makeAdvisory('stormWarning', lang));
  }

  // ── Frost risk (min temp tonight) ─────────────────────────────────────────
  if (daily?.[0]?.minTemp != null && daily[0].minTemp < 5) {
    advisories.push(makeAdvisory('frostRisk', lang));
  }

  // ── Extreme heat ──────────────────────────────────────────────────────────
  if (daily?.[0]?.maxTemp != null && daily[0].maxTemp > 42) {
    advisories.push(makeAdvisory('extremeHeat', lang));
  }

  // ── UV advisory ───────────────────────────────────────────────────────────
  if (daily?.[0]?.uvIndexMax != null && daily[0].uvIndexMax > 8) {
    advisories.push(makeAdvisory('highUV', lang));
  }

  // ── Irrigation advisory ───────────────────────────────────────────────────
  const rainProb24h = tomorrow?.precipitationProbability ?? 0;
  const surfaceMoisture = agriculture?.soilMoisture?.surface ?? null;

  if (rainProb24h > 60) {
    // Rain expected — skip irrigation
    advisories.push(makeAdvisory('skipIrrigation', lang));
  } else if (
    (surfaceMoisture != null && surfaceMoisture < 20) &&
    rainProb24h < 30
  ) {
    // Dry soil, no rain coming — irrigate
    advisories.push(makeAdvisory('irrigateToday', lang));
  }

  // ── Spraying advisory ─────────────────────────────────────────────────────
  const shouldAvoidSpraying =
    current.windSpeed > 15 ||           // wind > 15 km/h
    current.isRain ||                   // currently raining
    (tomorrow?.precipitationProbability ?? 0) > 40;  // rain likely tomorrow

  if (shouldAvoidSpraying) {
    advisories.push(makeAdvisory('avoidSpraying', lang));
  } else if (
    current.cloudCover < 40 &&
    current.windSpeed < 10 &&
    !current.isRain
  ) {
    advisories.push(makeAdvisory('goodForSpraying', lang));
  }

  // ── Harvest risk (rain in next 2 days) ────────────────────────────────────
  const twoDayRainProb = Math.max(
    daily?.[1]?.precipitationProbability ?? 0,
    daily?.[2]?.precipitationProbability ?? 0
  );
  if (twoDayRainProb > 50 && !advisories.some(a => a.id === 'storm')) {
    advisories.push(makeAdvisory('harvestRisk', lang));
  }

  // ── Fungal disease risk (leaf wetness high) ────────────────────────────────
  if (current.leafWetness != null && current.leafWetness > 60) {
    advisories.push(makeAdvisory('fungalRisk', lang));
  } else if (
    current.dewPoint != null &&
    current.temperature != null &&
    (current.temperature - current.dewPoint) < 3
  ) {
    advisories.push(makeAdvisory('dewPointRisk', lang));
  }

  // ── Low visibility ─────────────────────────────────────────────────────────
  if (current.visibility != null && current.visibility < 2) {
    advisories.push(makeAdvisory('lowVisibility', lang));
  }

  // ── High vapour pressure deficit → crop water stress ──────────────────────
  if (current.vapourPressureDeficit != null && current.vapourPressureDeficit > 2.0) {
    advisories.push(makeAdvisory('highVPD', lang));
  }

  // ── Good solar day ────────────────────────────────────────────────────────
  if (today?.sunshineDuration != null && today.sunshineDuration >= 8) {
    advisories.push(makeAdvisory('goodSolar', lang));
  }

  // ── Fallback: good weather ─────────────────────────────────────────────────
  if (advisories.length === 0) {
    advisories.push(makeAdvisory('goodWeather', lang));
  }

  return advisories;
}
