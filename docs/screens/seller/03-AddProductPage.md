# Add / Edit Product

> **Tab:** Account/Profile · **Stack:** SellerStack · **Route name:** `AddProduct` · **File:** `frontend/src/screens/Seller/AddProductScreen.js`

## Purpose
A long form for creating a new AgriStore product listing or editing an existing one. Captures photos, category/subcategory, name, description, search tags, pricing & stock, brand/manufacturer/origin, highlights, key-value specifications, and selling location/reach. Used by sellers from the dashboard ("Add Product") and from My Products ("Edit").

## Where it sits / how you reach it
- **Reached from:**
  - Seller Dashboard "Add Product" quick action → `AddProduct` with `{ product: null }`
  - My Products FAB → `AddProduct` with `{ product: null }`
  - My Products per-card "Edit" → `AddProduct` with `{ product: item }`
- **Navigates to:** `navigation.goBack()` on successful save.
- **Route params in:** `route.params.product` — the product object to edit, or `null`/absent for a new listing. `isEdit` is derived from its presence. The stack header title is set dynamically (`products.updateProduct` vs `products.listProduct`).

## How it works
On mount it sets the header title and fetches categories (`fetchCategories`). All form fields are React state pre-filled from `editProduct` when editing (price/mrp/stock/moq stringified for inputs; specs rebuilt into key-value pairs; highlights into an editable array; location defaults to the seller's own district/taluka/village). Two `useEffect`s reset subcategory when category changes and reset taluka when district changes (only after the user has manually touched them). Images: `pickImages` uses `expo-image-picker` (multi-select, max 5 total); chosen images are kept as `localImgs` until save. On `handleSave` it validates category, name, price (>0), stock, and district; uploads each local image (compressed via `compressImage`, posted to `/upload/image`); builds the payload (tags split on commas, specs filtered to non-empty pairs, highlights trimmed); then `POST`s (create) or `PUT`s (edit) and goes back. The footer save button shows a spinner while `saving`; validation and save errors raise `Alert`s.

## UI elements

| Element | Type | Description / action |
|---|---|---|
| Photos section | SectionTitle | "Photos" divider |
| Image strip | Horizontal ScrollView | Thumbnails of selected/existing images (max 5) |
| Remove image | TouchableOpacity (✕) | Removes a local or existing image |
| Add photo tile | TouchableOpacity | Opens image library picker (`expo-image-picker`) |
| Category picker | Modal bottom sheet | Trigger button → list of categories; loading/error/retry states |
| Subcategory picker | Modal bottom sheet | Shown only if the category has subcategories; "None / General" option |
| Product Name input | TextInput (required) | Free text |
| Description input | TextInput (multiline) | Free text |
| Search Tags input | TextInput | Comma-separated tags |
| Pricing section | SectionTitle | "Pricing & Stock" divider |
| Selling Price input | TextInput (required, decimal-pad) | Must be > 0 |
| MRP input | TextInput (decimal-pad) | Optional strike-through price |
| Unit picker | Chip row | Single-select chips (kg, quintal, gram, litre, …) |
| Stock input | TextInput (required, number-pad) | Available quantity |
| Min Order Qty input | TextInput (number-pad) | Defaults to 1 |
| Harvest Date input | TextInput | Optional free text |
| Highlights & Specifications | SectionTitle | Divider |
| Brand input | TextInput | Optional |
| Manufacturer input | TextInput | Optional |
| Country of Origin input | TextInput | Defaults to "India" |
| Highlights list | Dynamic TextInput rows | Add/remove bullet-point highlight rows |
| "Add Highlight" button | TouchableOpacity | Appends an empty highlight row |
| Specifications list | Dynamic key/value TextInput rows | Add/remove spec label-value pairs |
| "Add Specification" button | TouchableOpacity | Appends an empty spec pair |
| Location section | SectionTitle | "Where are you selling?" divider |
| District picker | LocationPicker modal (required) | Searchable district list |
| Taluka picker | LocationPicker modal | Disabled until a district is chosen |
| Village/Town input | TextInput | Optional free text |
| Selling Reach picker | ScopePicker (radio-style list) | Single-select selling scope (district/taluka/etc.) |
| Save button (footer) | TouchableOpacity | Validates + uploads + POST/PUT; spinner while saving |

## Services, APIs & data
- **API endpoints (all via `services/api`):**
  - `GET /agristore/categories` (category list)
  - `POST /upload/image` (per local image, body `{ base64 }`, 60s timeout)
  - `POST /agristore/seller/products` (create)
  - `PUT /agristore/seller/products/:id` (edit)
- **Backend route/service:** `backend/src/routes/agristore.routes.js` (product create/update, categories); image upload route under the upload controller
- **State / context:** `useAuth` (`user`, for default location), `useLanguage` (`t`); extensive local `useState` for every field; `route.params` for the edit product
- **Local / static data:** `UNITS` array; `DISTRICT_LIST`, `getTalukas`, `SELLING_SCOPES` from `constants/locations`; `SUBCATEGORIES_MAP` from `constants/categories`; `LocationPicker` component; `compressImage` util; `expo-image-picker`

## Languages / i18n
i18n via `useLanguage().t` under the `products.*` namespace (e.g. `products.selectCategory`, `products.productName`, `products.sellingPrice`, `products.unit`, `products.whereSelling`, `products.listProduct`, `products.updateProduct`, `products.saveError`) and `scope.*` for selling-scope labels/descriptions, plus shared keys (`cancel`, `retry`, `required`, `error`). Note: the entire "Highlights & Specifications" section (section title, Brand/Manufacturer/Country labels, hints, "Add Highlight"/"Add Specification", placeholders) is hardcoded English, not translated.

## Notes, edge cases & gaps
- Max 5 images enforced both at pick time (Alert) and by hiding the add tile.
- Validation runs client-side in `handleSave`; each failure raises an Alert and aborts.
- Empty optional fields are sent as `undefined` so they are omitted from the payload; `state` is hardcoded to `'Maharashtra'`.
- Category-fetch failure shows an inline error + retry inside the category modal.
- Image upload is sequential (one POST per image) before the product is saved; a failed upload aborts the save with an Alert.
- Subcategory options come from a static `SUBCATEGORIES_MAP` keyed by category name, not from the API.
