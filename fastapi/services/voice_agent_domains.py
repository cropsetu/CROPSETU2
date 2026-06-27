"""
Voice-Agent Domain Registry — "Hey Krushi" assistant.

The voice agent (voice_agent_service.py) is a GENERIC, domain-agnostic structured
extraction engine. Each *domain* here describes ONE thing the farmer can fill in
by voice — its fields, enum vocabularies, required fields, and the extraction
hints fed to the LLM. MyFarm's farm-record is the first domain; animal posting,
machinery/labour rental, crop cycles, activity logs etc. are added later by
appending a new dict to DOMAINS — no engine changes required.

A domain is a plain dict:
  key          : stable id used by Express/frontend (e.g. "farm")
  title        : short human label (English; the spoken side is localized by the LLM)
  intro        : one line telling the model WHAT it is capturing
  schema_block : the field list + enum dictionaries + extraction hints (prompt text)
  required     : dotted field paths that MUST be present before save
  enums        : { dotted_path: [ALLOWED, …] } — clamped server-side (drop→None on miss)
  numeric      : dotted paths coerced to float (parsed from words/Indic numerals by the LLM)
  string_list  : dotted paths coerced to a list[str]
  bool_fields  : dotted paths coerced to bool

`draft` for a domain is an opaque dict the engine merges/clamps by these paths; a
flat draft (farm) and a nested one both work via dotted-path get/set.
"""
from __future__ import annotations

# ── Enum vocabularies (MUST match backend/prisma/schema.prisma exactly) ───────
SOIL_TYPES        = ["BLACK_COTTON", "RED", "ALLUVIAL", "SANDY", "LATERITE", "CLAY_LOAM", "SANDY_LOAM", "UNKNOWN"]
IRRIGATION_SYSTEMS = ["DRIP", "SPRINKLER", "FLOOD", "FURROW", "RAINFED", "MIXED"]
LAND_OWNERSHIP    = ["OWNED", "LEASED", "SHARED_CROPPING", "FAMILY"]


# ── Domain: farm record (MyFarm → POST /farms) ────────────────────────────────
_FARM_SCHEMA_BLOCK = """\
You are capturing a FARM RECORD. Extract ONLY these fields into draft (omit/None what you didn't clearly hear):

  farmName        : the farm's name/nickname exactly as said (e.g. "Vambori CH farm"). Keep the spoken name.
  farmNameMr      : the same name written in Marathi/Devanagari script, if natural.
  farmNameHi      : the same name written in Hindi/Devanagari script, if natural.
  village         : village name
  taluka          : taluka / tehsil name
  district        : district name
  state           : state name (full English, e.g. "Maharashtra")
  pincode         : 6-digit postal code, digits only
  landSizeAcres   : number of ACRES (REQUIRED). Convert other units: 1 hectare = 2.47 acres, 1 acre = 40 gunta,
                    1 bigha ≈ 0.62 acre (varies by region — only convert if the farmer states bigha explicitly).
                    Parse words and Indic numerals: "do ekkad"/"दोन एकर" → 2, "saade saat"/"साडेसात" → 7.5, "सव्वा दोन" → 2.25.
  landOwnership   : one of OWNED | LEASED | SHARED_CROPPING | FAMILY. Hints: own/maalki/स्वतःची → OWNED;
                    rented/lease/भाड्याने → LEASED; batai/share/वाटा → SHARED_CROPPING; family/वडिलोपार्जित → FAMILY. Unsure → None.
  soilType        : one of BLACK_COTTON | RED | ALLUVIAL | SANDY | LATERITE | CLAY_LOAM | SANDY_LOAM | UNKNOWN.
                    Hints: black / kali / काळी / regur → BLACK_COTTON; red / laal / तांबडी → RED; alluvial / गाळाची → ALLUVIAL;
                    sandy / reti / वालुकामय → SANDY; laterite / जांभा → LATERITE; clay loam / चिकणमाती → CLAY_LOAM;
                    sandy loam → SANDY_LOAM; not sure / माहित नाही → UNKNOWN. If you did NOT hear soil, use None (do NOT guess).
  irrigationSystem: one of DRIP | SPRINKLER | FLOOD | FURROW | RAINFED | MIXED.
                    Hints: drip / tapak / ठिबक → DRIP; sprinkler / fuhara / तुषार → SPRINKLER; flood / paat / पाट → FLOOD;
                    furrow / सरी → FURROW; rainfed / barani / कोरडवाहू / जिरायती → RAINFED; mixed / both → MIXED. Unsure → None.
  waterSources    : array of strings the farmer mentions (e.g. ["Borewell","Canal","Well","River"]). [] if none said.

Do NOT invent values. If a field was not clearly stated, leave it out (None). Never put a value into an enum field
that is not in its allowed list — use None instead."""

FARM_DOMAIN = {
    "key":          "farm",
    "title":        "Farm setup",
    "intro":        "Help the farmer register or update one of their FARMS (land, soil, water, location) by voice.",
    "schema_block": _FARM_SCHEMA_BLOCK,
    "required":     ["landSizeAcres"],
    "enums": {
        "soilType":         SOIL_TYPES,
        "irrigationSystem": IRRIGATION_SYSTEMS,
        "landOwnership":    LAND_OWNERSHIP,
    },
    "numeric":     ["landSizeAcres", "latitude", "longitude"],
    "string_list": ["waterSources"],
    "bool_fields": [],
    "all_fields":  ["farmName", "farmNameMr", "farmNameHi", "village", "taluka", "district",
                    "state", "pincode", "landSizeAcres", "landOwnership", "soilType",
                    "irrigationSystem", "waterSources"],
}


# ── Domain: animal listing (Animal Trade → POST /animals) ─────────────────────
_ANIMAL_SCHEMA_BLOCK = """\
You are capturing an ANIMAL FOR SALE listing. Extract ONLY these fields:

  animal     : species in standard English — Cow, Buffalo, Goat, Bullock, Sheep, Pig, Horse, Camel, Poultry. REQUIRED.
  breed      : breed name as said (Gir, Murrah, Jersey, HF, Sahiwal, Deoni, Osmanabadi…). REQUIRED.
  age        : age as a short phrase exactly as the farmer says it ("3 years", "8 months", "दोन वर्ष"). REQUIRED.
  gender     : MALE | FEMALE. REQUIRED. Hints: cow/she/female/गाय/म्हैस → FEMALE; bull/ox/bullock/male/बैल → MALE.
  weight     : approximate weight as a short phrase ("350 kg", "4 quintal"). REQUIRED.
  price      : asking price in rupees as a NUMBER only. Parse words/Indic numerals ("fifty thousand"/"पन्नास हजार" → 50000,
               "सव्वा लाख" → 125000). REQUIRED.
  milkYield  : for milch animals, include the unit, e.g. "12 Litre/Day". Optional.
  vaccinated : true ONLY if the farmer clearly says vaccinated / लसीकरण / टीका लगा. Optional boolean.
  description: any extra detail. Optional.
  sellerLocation: village/taluka/district if stated. Optional.

Do NOT invent values. Leave out anything not clearly heard. gender MUST be MALE or FEMALE or null."""

ANIMAL_POST_DOMAIN = {
    "key":          "animal_post",
    "title":        "Sell an animal",
    "intro":        "Help the farmer post an ANIMAL FOR SALE in the marketplace by voice.",
    "schema_block": _ANIMAL_SCHEMA_BLOCK,
    "required":     ["animal", "breed", "age", "gender", "weight", "price"],
    "enums":        {"gender": ["MALE", "FEMALE"]},
    "numeric":      ["price"],
    "string_list":  [],
    "bool_fields":  ["vaccinated"],
    "all_fields":   ["animal", "breed", "age", "gender", "weight", "price",
                     "milkYield", "vaccinated", "description", "sellerLocation"],
}


# ── Domain: machinery rental (Rent → POST /rent/machinery) ────────────────────
_RENT_MACHINERY_SCHEMA_BLOCK = """\
You are capturing a MACHINERY/EQUIPMENT RENTAL listing. Extract ONLY these fields:

  name        : equipment name/model as said (e.g. "Mahindra 575 tractor"). REQUIRED.
  category    : one of tractor | harvester | sprayer | rotavator | thresher | transplanter | truck | tempo | other. REQUIRED.
                Hints: tractor/ट्रॅक्टर → tractor; combine/harvester/कापणी यंत्र → harvester; sprayer/फवारणी → sprayer;
                rotavator/रोटाव्हेटर → rotavator; thresher/मळणी → thresher; planter/transplanter → transplanter;
                truck/lorry → truck; tempo/pickup → tempo; anything else → other.
  pricePerDay : rent per DAY in rupees, NUMBER only. REQUIRED. (parse words/Indic numerals)
  location    : village/town. REQUIRED.
  district    : district name. REQUIRED.
  brand       : brand/make (Mahindra, John Deere, Swaraj…). Optional.
  horsePower  : HP as text ("50 HP"). Optional.
  fuelType    : diesel | petrol | electric. Optional.
  ageYears    : age of the machine in years, NUMBER. Optional.
  pricePerHour: rent per hour, NUMBER. Optional.
  pricePerAcre: rent per acre, NUMBER. Optional.
  features    : array of features mentioned (e.g. ["4WD","Power Steering","PTO"]). [] if none.
  description : any extra detail. Optional.

Do NOT invent values. category MUST be one of the allowed tokens or null."""

RENT_MACHINERY_DOMAIN = {
    "key":          "rent_machinery",
    "title":        "Rent out machinery",
    "intro":        "Help the farmer list a MACHINE/EQUIPMENT for rent by voice.",
    "schema_block": _RENT_MACHINERY_SCHEMA_BLOCK,
    "required":     ["name", "category", "pricePerDay", "location", "district"],
    "enums": {
        "category": ["tractor", "harvester", "sprayer", "rotavator", "thresher",
                     "transplanter", "truck", "tempo", "other"],
        "fuelType": ["diesel", "petrol", "electric"],
    },
    "numeric":      ["pricePerDay", "pricePerHour", "pricePerAcre", "ageYears", "mileageHours"],
    "string_list":  ["features"],
    "bool_fields":  [],
    "all_fields":   ["name", "category", "brand", "horsePower", "fuelType", "ageYears",
                     "mileageHours", "pricePerDay", "pricePerHour", "pricePerAcre",
                     "features", "description", "location", "district"],
}


# ── Domain: labour rental (Rent → POST /rent/labour) ──────────────────────────
_RENT_LABOUR_SCHEMA_BLOCK = """\
You are capturing a FARM LABOUR availability listing. Extract ONLY these fields:

  name        : worker's name, or the group leader's name. REQUIRED.
  skills      : array of work types the worker(s) can do, normalized to standard English nouns
                (weeding, harvesting, planting, irrigation, spraying, pruning, threshing, loading,
                transplanting, tractor operation, fruit picking, cotton picking, sugarcane cutting,
                land preparation). At least ONE. REQUIRED.
  pricePerDay : daily wage in rupees, NUMBER only. REQUIRED.
  location    : village/town. REQUIRED.
  district    : district name. REQUIRED.
  groupSize   : number of workers if a group, NUMBER. Optional (default 1).
  leader      : group leader name if a group. Optional.
  groupName   : group/team name if any. Optional.
  experience  : experience as text ("5 years"). Optional.
  languages   : array of languages the worker speaks (Marathi, Hindi, English, Kannada, Telugu, Gujarati). Optional.
  pricePerHour: hourly wage, NUMBER. Optional.
  phone       : contact number if stated, digits only. Optional.
  description : any extra detail. Optional.

Do NOT invent values. skills must be a non-empty array drawn from what the farmer actually said."""

RENT_LABOUR_DOMAIN = {
    "key":          "rent_labour",
    "title":        "List farm labour",
    "intro":        "Help the farmer/worker list FARM LABOUR availability for hire by voice.",
    "schema_block": _RENT_LABOUR_SCHEMA_BLOCK,
    "required":     ["name", "skills", "pricePerDay", "location", "district"],
    "enums":        {},
    "numeric":      ["pricePerDay", "pricePerHour", "groupSize"],
    "string_list":  ["skills", "languages"],
    "bool_fields":  [],
    "all_fields":   ["name", "leader", "groupName", "groupSize", "skills", "languages",
                     "experience", "pricePerDay", "pricePerHour", "phone", "description",
                     "location", "district"],
}


# ── Domain: profile edit (Profile → PUT /users/me) ────────────────────────────
_PROFILE_SCHEMA_BLOCK = """\
You are helping the farmer EDIT THEIR PROFILE. Capture ONLY the fields they ask to change (this is a partial update — most
turns set just one or two):

  name        : full display name.
  statusQuote : a short bio/status line.
  village     : village name.
  taluka      : taluka/tehsil name.
  district    : district name.
  city        : city/town name.
  state       : state name (full English).
  pincode     : 6-digit postal code, digits only.
  language    : app language — en | hi | mr (English→en, Hindi/हिंदी→hi, Marathi/मराठी→mr). Optional.
  gender      : MALE | FEMALE | OTHER. Optional.
  education   : NONE | PRIMARY | SECONDARY | GRADUATE | POST_GRADUATE. Optional.
  farmingExperienceYrs : years of farming experience, NUMBER. Optional.

Do NOT invent values. Only fill what the farmer explicitly asks to change. Enums must be an allowed token or null."""

PROFILE_DOMAIN = {
    "key":          "profile",
    "title":        "Edit profile",
    "intro":        "Help the farmer UPDATE THEIR PROFILE details by voice (a partial edit — change only what they say).",
    "schema_block": _PROFILE_SCHEMA_BLOCK,
    "required":     [],
    "require_any":  True,
    "enums": {
        "gender":       ["MALE", "FEMALE", "OTHER"],
        "language":     ["en", "hi", "mr"],
        "education":    ["NONE", "PRIMARY", "SECONDARY", "GRADUATE", "POST_GRADUATE"],
    },
    "numeric":      ["farmingExperienceYrs"],
    "string_list":  [],
    "bool_fields":  [],
    "all_fields":   ["name", "statusQuote", "village", "taluka", "district", "city", "state",
                     "pincode", "language", "gender", "education", "farmingExperienceYrs"],
}


# ── Domain: onboarding (Onboarding → POST /onboarding/complete) ────────────────
_ONBOARDING_SCHEMA_BLOCK = """\
You are doing first-time SETUP for a new farmer — collect their basic details AND their first farm in one short
conversation. Extract ONLY these fields:

  firstName     : the farmer's first name. REQUIRED.
  lastName      : the farmer's last/surname. Optional.
  state         : state (full English, e.g. "Maharashtra"). Optional.
  district      : district name. REQUIRED (their farm is created from this).
  taluka        : taluka/tehsil. Optional.
  village       : village. Optional.
  pincode       : 6-digit postal code, digits only. Optional.
  farmName      : a name for their farm if they give one. Optional.
  landSizeAcres : farm size in ACRES, NUMBER (convert 1 ha = 2.47 ac, 1 ac = 40 gunta; parse words/Indic numerals). Optional.
  soilType      : BLACK_COTTON | RED | ALLUVIAL | SANDY | LATERITE | CLAY_LOAM | SANDY_LOAM | UNKNOWN.
                  Hints same as farm setup (black/काळी → BLACK_COTTON, red/तांबडी → RED, …). Unsure → None.
  irrigationType: DRIP | SPRINKLER | FLOOD | FURROW | RAINFED | MIXED.
                  Hints: drip/ठिबक → DRIP; sprinkler/तुषार → SPRINKLER; flood/पाट → FLOOD; rainfed/कोरडवाहू → RAINFED. Unsure → None.
  cropTypes     : array of crops they grow, normalized to standard English (Soybean, Cotton, Wheat, Maize, Onion, Sugarcane…). [] if none.

Do NOT invent values. Enums must be an allowed token or null."""

ONBOARDING_DOMAIN = {
    "key":          "onboarding",
    "title":        "Get started",
    "intro":        "Welcome a NEW farmer and set up their account and first farm by voice.",
    "schema_block": _ONBOARDING_SCHEMA_BLOCK,
    "required":     ["firstName", "district"],
    "enums": {
        "soilType":       SOIL_TYPES,
        "irrigationType": IRRIGATION_SYSTEMS,
    },
    "numeric":      ["landSizeAcres", "latitude", "longitude"],
    "string_list":  ["cropTypes"],
    "bool_fields":  [],
    "all_fields":   ["firstName", "lastName", "state", "district", "taluka", "village",
                     "pincode", "farmName", "landSizeAcres", "soilType", "irrigationType", "cropTypes"],
}


# ── Registry ──────────────────────────────────────────────────────────────────
DOMAINS: dict[str, dict] = {
    FARM_DOMAIN["key"]:           FARM_DOMAIN,
    ANIMAL_POST_DOMAIN["key"]:    ANIMAL_POST_DOMAIN,
    RENT_MACHINERY_DOMAIN["key"]: RENT_MACHINERY_DOMAIN,
    RENT_LABOUR_DOMAIN["key"]:    RENT_LABOUR_DOMAIN,
    PROFILE_DOMAIN["key"]:        PROFILE_DOMAIN,
    ONBOARDING_DOMAIN["key"]:     ONBOARDING_DOMAIN,
    # Future (same engine, no code change beyond a dict):
    #   CROP_CYCLE_DOMAIN   → MyFarm crop cycle
    #   ACTIVITY_DOMAIN     → MyFarm activity log
}


def get_domain(key: str) -> dict | None:
    return DOMAINS.get((key or "").strip().lower())
