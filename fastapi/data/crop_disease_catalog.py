"""
data/crop_disease_catalog.py — the per-crop disease/pest CATALOG.

This is the DATA half of the per-crop whitelist (the logic — merge, dedup,
canonical-snap, accessors — lives in data/crop_disease_whitelist.py, which
imports CATALOG from here as its seed).

Scope
  Covers every crop in services.input_normalizer.VALID_CROPS (the app's
  authoritative crop list, ~70 crops incl. minor millets/oilseeds/pulses/
  spices/plantation/fruit). Each value is the list of the crop's major,
  *leaf/field-diagnosable* diseases + key pests, as canonical COMMON names
  (Title Case). "Healthy" is NOT listed — the whitelist appends it to every
  crop automatically.

Sources
  Curated from standard Indian-agriculture references — ICAR package-of-
  practices / AICRP disease lists, CABI Crop Protection Compendium, EPPO
  Global Database, and the PlantVillage class set. Lists are intentionally
  bounded to what a vision model can plausibly distinguish from a photo;
  seed-borne / strictly-root conditions a leaf photo can't show are omitted.

Treatment note
  A diagnosis whose (crop, disease) pair is NOT in rag.knowledge_base._LABEL_CLAIMS
  degrades gracefully to cultural/biological advice (see knowledge_base.retrieve
  + _GENERIC_IPM). So adding diseases here is safe; it does NOT auto-grant
  chemical recommendations (that requires a verified CIB&RC registry entry).

How to extend
  Add the crop (canonical VALID_CROPS spelling) with its common disease names.
  Keep names canonical so canonicalize()/same_disease() can map model output.
"""
from __future__ import annotations


CATALOG: dict[str, list[str]] = {
    # ── Cereals & millets ──────────────────────────────────────────────────
    "Wheat": [
        "Yellow Rust", "Brown Rust", "Black Rust", "Powdery Mildew",
        "Karnal Bunt", "Loose Smut",
    ],
    "Rice": [
        "Blast", "Sheath Blight", "Bacterial Leaf Blight", "Brown Spot",
        "False Smut", "Tungro",
    ],
    "Maize": [
        "Common Rust", "Southern Rust", "Northern Leaf Blight", "Gray Leaf Spot",
        "Common Smut", "Downy Mildew", "Banded Leaf and Sheath Blight",
    ],
    "Jowar": [
        "Anthracnose", "Grain Mold", "Leaf Blight", "Rust", "Downy Mildew",
        "Charcoal Rot", "Shoot Fly",
    ],
    "Bajra": [
        "Downy Mildew", "Ergot", "Smut", "Rust", "Blast",
    ],
    "Ragi": [
        "Blast", "Brown Spot", "Leaf Blight", "Mottle Streak Virus",
    ],
    "Barley": [
        "Stripe Rust", "Leaf Rust", "Powdery Mildew", "Net Blotch",
        "Loose Smut", "Covered Smut",
    ],

    # ── Pulses ─────────────────────────────────────────────────────────────
    "Gram": [
        "Wilt", "Ascochyta Blight", "Botrytis Gray Mold", "Rust",
        "Root Rot", "Pod Borer",
    ],
    "Tur": [
        "Wilt", "Sterility Mosaic", "Phytophthora Blight", "Pod Borer", "Pod Fly",
    ],
    "Lentil": [
        "Wilt", "Rust", "Ascochyta Blight", "Powdery Mildew", "Root Rot",
    ],
    "Moong": [
        "Yellow Mosaic Virus", "Cercospora Leaf Spot", "Powdery Mildew",
        "Anthracnose", "Bacterial Leaf Spot",
    ],
    "Urad": [
        "Yellow Mosaic Virus", "Cercospora Leaf Spot", "Powdery Mildew",
        "Leaf Crinkle Virus",
    ],
    "Peas": [
        "Powdery Mildew", "Rust", "Ascochyta Blight", "Downy Mildew",
        "Wilt", "Pod Borer",
    ],
    "Beans": [
        "Anthracnose", "Angular Leaf Spot", "Bacterial Blight", "Rust",
        "Bean Common Mosaic Virus",
    ],

    # ── Oilseeds ───────────────────────────────────────────────────────────
    "Soybean": [
        "Rust", "Bacterial Blight", "Frogeye Leaf Spot", "Yellow Mosaic Virus",
    ],
    "Groundnut": [
        "Tikka Leaf Spot", "Rust", "Collar Rot", "Bud Necrosis",
    ],
    "Mustard": [
        "Alternaria Blight", "White Rust", "Downy Mildew", "Powdery Mildew",
    ],
    "Sunflower": [
        "Alternaria Leaf Spot", "Downy Mildew", "Rust", "Powdery Mildew",
        "Head Rot", "Necrosis Virus",
    ],
    "Sesame": [
        "Phyllody", "Alternaria Leaf Spot", "Powdery Mildew",
        "Bacterial Leaf Spot", "Stem Rot",
    ],
    "Castor": [
        "Gray Mold", "Wilt", "Leaf Blight", "Rust", "Semilooper",
    ],

    # ── Cash & plantation crops ────────────────────────────────────────────
    "Cotton": [
        "Bacterial Blight", "Fusarium Wilt", "Verticillium Wilt",
        "Cotton Leaf Curl Virus", "Alternaria Leaf Spot", "Grey Mildew",
        "Thrips", "Aphids", "Whitefly", "Bollworm",
    ],
    "Sugarcane": [
        "Red Rot", "Smut", "Wilt", "Rust", "Grassy Shoot", "Leaf Scald",
        "Pokkah Boeng",
    ],
    "Jute": [
        "Stem Rot", "Anthracnose", "Black Band", "Leaf Mosaic",
    ],
    "Tea": [
        "Blister Blight", "Gray Blight", "Red Rust", "Brown Blight", "Root Rot",
    ],
    "Coffee": [
        "Leaf Rust", "Brown Eye Spot", "Black Rot", "Berry Disease",
        "White Stem Borer",
    ],
    "Coconut": [
        "Bud Rot", "Root Wilt", "Leaf Rot", "Stem Bleeding",
        "Rhinoceros Beetle", "Red Palm Weevil",
    ],
    "Arecanut": [
        "Koleroga", "Bud Rot", "Yellow Leaf Disease", "Stem Bleeding",
    ],

    # ── Spices ─────────────────────────────────────────────────────────────
    "Turmeric": [
        "Leaf Blotch", "Leaf Spot", "Rhizome Rot", "Rhizome Scale",
    ],
    "Ginger": [
        "Soft Rot", "Bacterial Wilt", "Leaf Spot", "Dry Rot",
    ],
    "Cardamom": [
        "Katte Mosaic Virus", "Capsule Rot", "Rhizome Rot", "Leaf Blight", "Thrips",
    ],
    "Black Pepper": [
        "Quick Wilt", "Slow Wilt", "Anthracnose", "Pollu Disease",
    ],
    "Cumin": [
        "Wilt", "Alternaria Blight", "Powdery Mildew", "Aphids",
    ],
    "Coriander": [
        "Stem Gall", "Powdery Mildew", "Wilt", "Aphids",
    ],
    "Fennel": [
        "Powdery Mildew", "Blight", "Wilt", "Aphids",
    ],
    "Fenugreek": [
        "Powdery Mildew", "Downy Mildew", "Cercospora Leaf Spot", "Root Rot",
    ],
    "Ajwain": [
        "Powdery Mildew", "Blight", "Wilt",
    ],
    "Chilli": [
        "Anthracnose", "Bacterial Leaf Spot", "Powdery Mildew",
        "Leaf Curl Virus", "Damping Off", "Cercospora Leaf Spot", "Fusarium Wilt",
    ],
    "Capsicum": [
        "Anthracnose", "Bacterial Leaf Spot", "Powdery Mildew",
        "Mosaic Virus", "Damping Off", "Fruit Rot",
    ],

    # ── Vegetables ─────────────────────────────────────────────────────────
    "Tomato": [
        "Early Blight", "Late Blight", "Septoria Leaf Spot", "Bacterial Spot",
        "Leaf Mold", "Target Spot", "Tomato Yellow Leaf Curl Virus",
        "Tomato Mosaic Virus", "Spider Mites",
    ],
    "Potato": [
        "Early Blight", "Late Blight", "Common Scab", "Black Scurf", "Bacterial Wilt",
    ],
    "Onion": [
        "Purple Blotch", "Downy Mildew", "Stemphylium Blight", "Basal Rot",
    ],
    "Garlic": [
        "Purple Blotch", "Downy Mildew", "Stemphylium Blight", "Rust",
    ],
    "Brinjal": [
        "Bacterial Wilt", "Phomopsis Blight", "Little Leaf", "Fruit and Shoot Borer",
        "Alternaria Leaf Spot", "Cercospora Leaf Spot",
    ],
    "Okra": [
        "Yellow Vein Mosaic Virus", "Powdery Mildew", "Fusarium Wilt",
    ],
    "Cauliflower": [
        "Black Rot", "Downy Mildew", "Alternaria Leaf Spot", "Clubroot",
        "Diamondback Moth",
    ],
    "Cabbage": [
        "Black Rot", "Downy Mildew", "Alternaria Leaf Spot", "Clubroot",
        "Diamondback Moth",
    ],
    "Spinach": [
        "Downy Mildew", "Cercospora Leaf Spot", "White Rust", "Anthracnose",
    ],
    "Cucumber": [
        "Downy Mildew", "Powdery Mildew", "Anthracnose", "Angular Leaf Spot",
        "Mosaic Virus", "Scab", "Fusarium Wilt",
    ],
    "Pumpkin": [
        "Powdery Mildew", "Downy Mildew", "Mosaic Virus", "Fruit Rot",
    ],
    "Bitter Gourd": [
        "Downy Mildew", "Powdery Mildew", "Mosaic Virus", "Fruit Fly",
    ],
    "Bottle Gourd": [
        "Downy Mildew", "Powdery Mildew", "Anthracnose", "Mosaic Virus",
    ],
    "Watermelon": [
        "Anthracnose", "Downy Mildew", "Powdery Mildew", "Fusarium Wilt",
        "Mosaic Virus",
    ],
    "Muskmelon": [
        "Powdery Mildew", "Downy Mildew", "Fusarium Wilt", "Mosaic Virus",
    ],
    "Carrot": [
        "Alternaria Leaf Blight", "Cercospora Leaf Spot", "Powdery Mildew",
        "Root Knot Nematode",
    ],
    "Radish": [
        "Alternaria Blight", "White Rust", "Downy Mildew", "Black Rot",
    ],
    "Beetroot": [
        "Cercospora Leaf Spot", "Downy Mildew", "Powdery Mildew", "Root Rot",
    ],
    "Sweet Potato": [
        "Black Rot", "Scurf", "Leaf Spot", "Sweet Potato Weevil",
    ],
    "Tapioca": [
        "Mosaic Disease", "Brown Leaf Spot", "Bacterial Blight", "Anthracnose",
    ],

    # ── Fruits ─────────────────────────────────────────────────────────────
    "Mango": [
        "Anthracnose", "Powdery Mildew", "Bacterial Canker", "Malformation",
        "Grey Blight", "Red Rust", "Sooty Mould", "Stem End Rot",
    ],
    "Banana": [
        "Panama Wilt", "Sigatoka Leaf Spot", "Bunchy Top Virus", "Anthracnose",
        "Moko Disease", "Freckle", "Heart Rot", "Infectious Chlorosis",
    ],
    "Grapes": [
        "Powdery Mildew", "Downy Mildew", "Anthracnose", "Black Rot", "Esca",
        "Leaf Blight", "Bacterial Leaf Spot",
    ],
    "Pomegranate": [
        "Bacterial Blight", "Anthracnose", "Wilt", "Fruit Rot",
        "Cercospora Fruit Spot", "Alternaria Fruit Spot", "Leaf Spot",
    ],
    "Papaya": [
        "Papaya Ring Spot Virus", "Powdery Mildew", "Anthracnose",
        "Damping Off", "Leaf Curl",
    ],
    "Orange": [
        "Citrus Canker", "Citrus Greening", "Gummosis", "Anthracnose",
        "Powdery Mildew", "Scab", "Tristeza", "Exocortis",
    ],
    "Lemon": [
        "Citrus Canker", "Citrus Greening", "Gummosis", "Anthracnose", "Tristeza",
    ],
    "Guava": [
        "Wilt", "Anthracnose", "Fruit Canker", "Leaf Spot",
    ],
    "Sapota": [
        "Leaf Spot", "Sooty Mold", "Anthracnose", "Fruit Rot",
    ],
    "Litchi": [
        "Anthracnose", "Leaf Blight", "Fruit Rot", "Powdery Mildew",
    ],
    "Pineapple": [
        "Heart Rot", "Fruit Collapse", "Leaf Spot", "Black Rot",
    ],
    "Apple": [
        "Apple Scab", "Cedar Apple Rust", "Black Rot", "Powdery Mildew",
        "Fire Blight", "Marssonina Blotch", "Sooty Mould", "Sooty Blotch",
    ],
}
