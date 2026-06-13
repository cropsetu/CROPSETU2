# Scan Card (Soil Health Card OCR)

> **Tab:** AI Assistant · **Stack:** `AINavigator` (AIStack) · **Route name:** `SoilScan` · **File:** `frontend/src/screens/AI/SoilScanScreen.js`

## Purpose
Photograph a government Soil Health Card and let AI vision extract the 12 parameter values. Extraction is advisory only: on success the values are handed to `SoilForm` as editable pre-fills (never auto-saved) so the farmer verifies before storing. Reuses the chat screen's camera/gallery + `compressImage` pattern.

## Where it sits / how you reach it
- **Reached from:**
  - `SoilHubScreen` "Scan card" tile → `navigation.navigate('SoilScan')`.
  - `SoilGuideScreen` "I have a card →" button → `navigation.navigate('SoilScan')`.
- **Navigates to:**
  - `SoilForm` on successful OCR via `navigation.replace('SoilForm', { prefill: fields, inputMethod: 'ocr', notes })`.
  - `SoilForm` (empty) via "Or enter values manually" → `navigation.replace('SoilForm')`.
  - Header back → `goBack()`.
- **Route params in:** none.

## How it works
The user picks a photo from camera (`pickFromCamera`) or gallery (`pickFromGallery`); each first requests the relevant permission and Alerts if denied. The chosen asset goes to `handleAsset`, which compresses it via `compressImage(uri, { needBase64: true })`, sets a local `preview` ({ uri, base64 }), and immediately calls `runOcr(base64)`. `runOcr` sets `reading`, calls `scanSoilCard(base64, 'image/jpeg')`, and inspects the result: `fieldsFound` (or a count of non-null `fields`) of zero sets a "could not read any values" error; otherwise it `replace`s to `SoilForm` with the extracted `fields` as `prefill`, `inputMethod: 'ocr'`, and the OCR `notes`. Errors are mapped via `soilHumanError`. While reading, a translucent overlay with a spinner and "Reading your card…" sits over the preview, and the action buttons hide. If a read fails on an existing preview, a "Try reading again" row re-runs OCR on the same base64.

## UI elements

| Element | Type | Description / action |
|---|---|---|
| Cosmic header | Header (`CosmicHeader`) | Back arrow, ScanLine icon, title "Scan card", subtitle "AI reads your Soil Health Card" |
| Preview / dropzone | Framed image area (dashed) | Shows the chosen photo, or a placeholder ScanLine + "Take a photo of your Soil Health Card" |
| Reading overlay | Overlay + spinner | Shown while `reading`; "Reading your card…" |
| Error text | Text | Centered red message (e.g. "Could not read any values…") |
| "Take photo" / "Retake" | Primary button (Camera) | `pickFromCamera`; label flips to "Retake" when a preview exists |
| "Gallery" | Secondary (ghost) button (ImageIcon) | `pickFromGallery` |
| "Try reading again" | Inline retry row (RotateCcw) | Only when `preview && error && !reading`; re-runs `runOcr(preview.base64)` |
| "Or enter values manually" | Underlined link | `navigation.replace('SoilForm')` |
| Tips card | Card | "For best results" + three tips: good light (Sun), card flat & fill frame (CheckCircle2), always check values (Sparkles) |

## Services, APIs & data
- **API endpoints:** `POST /ai/soil-card-ocr` via `scanSoilCard(base64, mimeType)` (`services/aiApi.js`) with body `{ image: { data, mime_type } }`, 60s timeout. Returns `{ fields, units, confidence, notes, fieldsFound, token_info }`.
- **Backend route/service:** `backend/src/routes/ai.routes.js` → `POST /api/v1/ai/soil-card-ocr`. Validates image presence/type/size (≤12M chars → 413), runs `checkCredits('ai_soil_ocr')` (402 if out), forwards to FastAPI `callFastAPI('/ai/soil-card-ocr', …)` (Gemini vision), records `aIUsage`, then `deductCredits('ai_soil_ocr')`. Timeout → 504, other failures → 500 with "enter values manually" guidance.
- **State / context:** `useLanguage()` (`t`); local `useState` for `preview`, `reading`, `error`; `useSafeAreaInsets`. Uses `expo-image-picker` for camera/gallery and permission requests.
- **Local / static data:** `compressImage` from `utils/mediaCompressor`; theme tokens, `CosmicHeader`, `soilHumanError` from `./components/soilShared`. Local `Tip` sub-component.

## Languages / i18n
Uses the `soilHub.scan.*` namespace (e.g. `soilHub.scan.title`, `soilHub.scan.prompt`, `soilHub.scan.reading`, `soilHub.scan.takePhoto`, `soilHub.scan.gallery`, `soilHub.scan.retake`, `soilHub.scan.retry`, `soilHub.scan.manual`, `soilHub.scan.tip1`–`tip3`, plus permission/Alert strings). Error copy via `soilHumanError` (`soilHub.err.*`). All `t()` calls carry English fallbacks.

## Notes, edge cases & gaps
- **Permissions:** camera and media-library permissions are requested on demand; denial shows an Alert pointing the user to Settings, no crash.
- **Never auto-saves:** OCR output is only a pre-fill; the farmer must review and tap "Analyze my soil" in `SoilForm`. The verify banner there reinforces this.
- Zero-confidence reads (no values found) keep the photo and offer "Try reading again" plus the manual fallback.
- `navigation.replace` is used for both forward paths so the scan step is removed from the back stack once the form opens.
- Image compression failures Alert "Could not read/process that image" and abort without calling the API.
