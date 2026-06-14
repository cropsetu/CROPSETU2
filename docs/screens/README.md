# CropSetu / KhetAI — Screen-by-Screen Documentation

This folder documents **every screen of the CropSetu mobile app** (React Native + Expo), one Markdown file per screen. Files are grouped by **feature** (one sub-folder each) and numbered in **user-flow order** (`01-`, `02-`, …) so each folder reads top-to-bottom like the real journey.

Each screen doc follows the same template:

> **Purpose** · **Where it sits / how you reach it** · **How it works** · **UI elements** (an element-by-element table — search bars, buttons, chat boxes, cards, inputs, modals, FABs, …) · **Services, APIs & data** · **Languages / i18n** · **Notes, edge cases & gaps**

**Already documented elsewhere (not repeated here):**
- 🌾 **My Farm** tab → [`./my-farm/`](./my-farm/00-README.md)
- 🤖 **Core AI services** (AI Text Chat, AI Voice Chat, Crop Disease Scan/Diagnosis) → [`../AI_CHAT_ARCHITECTURE.md`](../AI_CHAT_ARCHITECTURE.md) and [`../AI_SERVICES_INHOUSE_LLM_BRIEF.md`](../AI_SERVICES_INHOUSE_LLM_BRIEF.md)

This index covers the **other 60 screens** across 13 feature areas.

---

## 1. What the app is

**CropSetu** (branded **KhetAI** in the UI) is an India-focused, multilingual super-app for farmers. A single React Native app bundles several marketplaces and advisory tools:

- **AgriStore** — buy farm inputs (seeds, fertilizers, tools)
- **Animal Trade** — livestock marketplace with buyer↔seller chat
- **Rent** — hire farm machinery and labour
- **Seller Portal** — list & sell products, receive crop reports
- **AI Assistant** — disease scan, chat, voice, market prices, schemes, soil, calculators, weather
- **My Farm** — farm/crop-cycle management (documented separately)

The three tiers behind it: **React Native app → Express backend (broker + credit ledger) → FastAPI AI service**. See the AI brief for the backend/AI topology.

---

## 2. App-open flow & gating

Defined in `frontend/App.js` (`RootNavigator`) and `frontend/src/context/AuthContext.js`:

```
App launch
   │
   ▼
[loading spinner]  ── AuthContext restoring session
   │
   ├── not logged in ──────────────►  LoginScreen  (Welcome → Phone → OTP)
   │                                      │ verifyOtp success
   │                                      ▼
   ├── logged in & onboarding incomplete ─►  OnboardingNavigator
   │        (user.onboardingStep === 'BASIC' && !user.totalFarms)   (Language → Profile)
   │                                      │ complete
   │                                      ▼
   └── logged in & onboarded ───────────►  AppNavigator  (6 bottom tabs)
```

---

## 3. Navigation map (6 bottom tabs)

`frontend/src/navigation/AppNavigator.js` defines a bottom-tab navigator with a custom immersive tab bar; each tab is its own stack:

| Bottom tab | Stack | Home screen | This index covers |
|---|---|---|---|
| 🛒 **Shop** | `AgriStack` | AgriStore Home | ✅ AgriStore (6) |
| 🤖 **AI** | `AIStack` | AI Assistant Home | ✅ AI hub, market, schemes, calculators, soil, weather (22) · ❌ chat/voice/scan → AI docs |
| 🐄 **Animals** | `AnimalStack` | Animal Trade Home | ✅ Animal Trade (5) |
| 🚜 **Rent** | `RentStack` | Rent Home | ✅ Rent (7) |
| 🌾 **My Farm** | `MyFarmStack` | My Farm Home | ✅ My Farm (10) → my-farm/ |
| 👤 **Account** | `ProfileStack` | Account Home | ✅ Account (4) + Seller Portal (8) |

> Note: the `AIStack` also re-registers the **Weather** screens and (for deep-linking) some **My Farm** screens. Weather is documented here; My Farm is in its own folder ([`./my-farm/`](./my-farm/00-README.md)).

---

## 4. Frontend service / API layer

Screens talk to the backend through `frontend/src/services/`:

| Module | Responsibility |
|---|---|
| `api.js` | Core Axios client (auth headers, base URL, most REST calls) |
| `aiApi.js` | AI endpoints (chat, scan, credits, soil OCR, etc.) |
| `farmApi.js` | My Farm + onboarding writes |
| `mandiApi.js` | Mandi / MSP / market prices |
| `weatherApi.js` | Weather & advisories |
| `socket.js` | Real-time chat (Socket.IO) for Animal Trade |
| `writeQueue.js` | Offline write queue / retry |
| `crashReporter.js` | Crash/error reporting |

Cross-cutting React contexts: `AuthContext`, `LanguageContext` (i18n), `LocationContext`, `CartContext`.

---

## 5. Complete screen catalog (feature-wise, flow-ordered)

### 🔐 Authentication — `auth/`
The **live** login is [`01-LoginPage`](auth/01-LoginPage.md) (`LoginScreen.js`). The `PhoneLogin/` folder is an alternate/modular implementation (internal `LoginFlow` steps with injected stubs) — documented for completeness.

| # | Doc | Screen |
|---|---|---|
| 01 | [LoginPage](auth/01-LoginPage.md) | Login (KhetAI — Welcome · Phone · OTP) — **production auth** |
| 02 | [LandingPage](auth/02-LandingPage.md) | Landing (Welcome) — LoginFlow step |
| 03 | [PhoneEntryPage](auth/03-PhoneEntryPage.md) | Phone Entry — LoginFlow step |
| 04 | [OtpVerificationPage](auth/04-OtpVerificationPage.md) | OTP Verification — LoginFlow step |
| 05 | [LoginFlowOrchestrator](auth/05-LoginFlowOrchestrator.md) | Login Flow (Auth orchestrator) |

### 🚀 Onboarding — `onboarding/`
| # | Doc | Screen |
|---|---|---|
| 01 | [LanguagePage](onboarding/01-LanguagePage.md) | Choose Your Language |
| 02 | [FarmProfileSetupPage](onboarding/02-FarmProfileSetupPage.md) | Farm Profile Setup (live onboarding) |
| 03 | [ProfileSetupWizard](onboarding/03-ProfileSetupWizard.md) | Profile Setup Wizard (4-step) — *unwired component* |

### 🛒 AgriStore (Shop tab) — `agristore/`
| # | Doc | Screen |
|---|---|---|
| 01 | [HomePage](agristore/01-HomePage.md) | AgriStore Home (Shop) |
| 02 | [ProductPage](agristore/02-ProductPage.md) | Product Detail |
| 03 | [CartPage](agristore/03-CartPage.md) | Cart |
| 04 | [CheckoutPage](agristore/04-CheckoutPage.md) | Checkout (incl. address) |
| 05 | [OrderConfirmedPage](agristore/05-OrderConfirmedPage.md) | Order Confirmed |
| 06 | [AiCropAdvisorPage](agristore/06-AiCropAdvisorPage.md) | AI Crop Advisor — *calls missing backend endpoints* |

### 🐄 Animal Trade (Animals tab) — `animaltrade/`
| # | Doc | Screen |
|---|---|---|
| 01 | [HomePage](animaltrade/01-HomePage.md) | Animal Trade Home (Livestock Marketplace) |
| 02 | [AnimalDetailPage](animaltrade/02-AnimalDetailPage.md) | Animal Detail |
| 03 | [AddListingPage](animaltrade/03-AddListingPage.md) | Add / Edit Animal Listing |
| 04 | [MyChatsPage](animaltrade/04-MyChatsPage.md) | My Animal Chats (Inbox) |
| 05 | [ChatPage](animaltrade/05-ChatPage.md) | Chat (Buyer ↔ Seller, real-time Socket.IO) |

### 🚜 Rent (Machinery & Labour) — `rent/`
| # | Doc | Screen |
|---|---|---|
| 01 | [HomePage](rent/01-HomePage.md) | Rent Home (Machinery & Labour Marketplace) |
| 02 | [MachineryDetailPage](rent/02-MachineryDetailPage.md) | Machinery Detail |
| 03 | [LabourDetailPage](rent/03-LabourDetailPage.md) | Labour Detail (Worker / Group Profile) |
| 04 | [AddMachineryPage](rent/04-AddMachineryPage.md) | Add / Edit Machinery Listing |
| 05 | [AddWorkerPage](rent/05-AddWorkerPage.md) | Register as Worker (Add Labour Listing) |
| 06 | [MyListingsPage](rent/06-MyListingsPage.md) | My Rent Listings |
| 07 | [BookingsPage](rent/07-BookingsPage.md) | Rent Bookings (Requests) |

### 🏪 Seller Portal (via Account tab) — `seller/`
| # | Doc | Screen |
|---|---|---|
| 01 | [DashboardPage](seller/01-DashboardPage.md) | Seller Dashboard |
| 02 | [MyProductsPage](seller/02-MyProductsPage.md) | My Products |
| 03 | [AddProductPage](seller/03-AddProductPage.md) | Add / Edit Product |
| 04 | [OrdersPage](seller/04-OrdersPage.md) | Seller Orders |
| 05 | [SellerProfilePage](seller/05-SellerProfilePage.md) | Seller Profile |
| 06 | [BusinessProfileKycPage](seller/06-BusinessProfileKycPage.md) | Business Profile & KYC |
| 07 | [ReceivedReportsPage](seller/07-ReceivedReportsPage.md) | Received Crop Reports (Inbox) |
| 08 | [ReceivedReportDetailPage](seller/08-ReceivedReportDetailPage.md) | Received Report Detail & Reply |

### 👤 Account / Profile tab — `account/`
| # | Doc | Screen |
|---|---|---|
| 01 | [AccountHomePage](account/01-AccountHomePage.md) | Account Home (Profile hub) |
| 02 | [MyOrdersPage](account/02-MyOrdersPage.md) | My Orders |
| 03 | [SavedPostsPage](account/03-SavedPostsPage.md) | Saved Posts |
| 04 | [MyAnimalListingsPage](account/04-MyAnimalListingsPage.md) | My Animal Listings |

### 🌦️ Weather & Crop Calendar (in AI stack) — `weather/`
| # | Doc | Screen |
|---|---|---|
| 01 | [HomePage](weather/01-HomePage.md) | Weather Home (Field Monitor) |
| 02 | [AiWeatherHubPage](weather/02-AiWeatherHubPage.md) | AI / Weather Hub |
| 03 | [CropCalendarPage](weather/03-CropCalendarPage.md) | Crop Calendar |
| 04 | [CropDetailPage](weather/04-CropDetailPage.md) | Crop Detail |
| 05 | [StateCropsPage](weather/05-StateCropsPage.md) | State Crops |

### 🤖 AI Assistant hub & credits — `ai-hub/`
| # | Doc | Screen |
|---|---|---|
| 01 | [AiAssistantHomePage](ai-hub/01-AiAssistantHomePage.md) | AI Assistant Home (the AI-tab launcher) |
| 02 | [AiCreditsPage](ai-hub/02-AiCreditsPage.md) | AI Credits (usage dashboard) |

### 💹 Market, Mandi & MSP prices — `market-prices/`
| # | Doc | Screen |
|---|---|---|
| 01 | [MarketPricesPage](market-prices/01-MarketPricesPage.md) | Market Prices |
| 02 | [MandiBhavPage](market-prices/02-MandiBhavPage.md) | Mandi Bhav (Commodity Price List) |
| 03 | [MspTrackerPage](market-prices/03-MspTrackerPage.md) | MSP Tracker |

### 📜 Govt Schemes, Planner & Calendar — `schemes-planning/`
| # | Doc | Screen |
|---|---|---|
| 01 | [GovtSchemesPage](schemes-planning/01-GovtSchemesPage.md) | Govt Schemes |
| 02 | [DailyPlannerPage](schemes-planning/02-DailyPlannerPage.md) | Daily Planner |
| 03 | [FarmCalendarPage](schemes-planning/03-FarmCalendarPage.md) | Farm Calendar |

### 🧮 Calculators & Irrigation — `calculators-irrigation/`
| # | Doc | Screen |
|---|---|---|
| 01 | [InputCalculatorPage](calculators-irrigation/01-InputCalculatorPage.md) | Input Calculator |
| 02 | [LoanCalculatorPage](calculators-irrigation/02-LoanCalculatorPage.md) | Loan Calculator |
| 03 | [IrrigationPage](calculators-irrigation/03-IrrigationPage.md) | Irrigation (Smart Watering) |

### 🧪 Soil Health suite — `soil/`
| # | Doc | Screen |
|---|---|---|
| 01 | [SoilHubPage](soil/01-SoilHubPage.md) | Soil Health Hub |
| 02 | [SoilGuidePage](soil/02-SoilGuidePage.md) | Get Your Soil Tested (Soil Guide) |
| 03 | [SoilScanPage](soil/03-SoilScanPage.md) | Scan Card (Soil Health Card OCR) |
| 04 | [SoilFormPage](soil/04-SoilFormPage.md) | Enter Soil Test (manual form) |
| 05 | [SoilReportPage](soil/05-SoilReportPage.md) | Soil Report |
| 06 | [SoilHealthLegacyPage](soil/06-SoilHealthLegacyPage.md) | Soil Health (legacy manual-entry screen) |

---

## 6. Cross-cutting observations & gaps (surfaced during documentation)

These were flagged from the actual code and are worth a look:

- **Two login implementations coexist.** `LoginScreen.js` is the live, wired auth (real `sendOtp`/`verifyOtp`). The modular `Auth/PhoneLogin/` flow (Landing/PhoneEntry/Otp via `LoginFlow`) uses **injected stub callbacks** and is not the production path.
- **`AIRecommendation` (AI Crop Advisor)** calls `GET /agristore/crops`, `GET /agristore/soils`, `POST /agristore/analyze` — **no matching backend routes** were found; it also fetches `open-meteo.com` directly. It is not registered in the navigator.
- **`ProfileSetup` 4-step wizard** is a fully-built but **unwired** component (no route); the live onboarding is `OnboardingProfileScreen`.
- **Market vs Mandi Bhav** overlap — `MarketScreen` and `MandiBhavScreen` both present commodity prices; confirm which is canonical.
- **Soil suite** has a newer hub/scan/form/report flow plus a **legacy** `SoilHealthScreen` still in the tree.
- Multilingual support is pervasive via `LanguageContext` / i18n; several screens hardcode a small `LANGS` list for display.

---

*Generated by tracing `frontend/src/screens/**` against `AppNavigator.js`, `OnboardingNavigator.js`, and `frontend/src/services/`. 60 screen docs across 13 areas, numbered in user-flow order.*
