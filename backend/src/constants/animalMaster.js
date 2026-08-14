/**
 * Controlled master data for the Animal Trade module: which animal types exist,
 * which breeds belong to each, and which fields the post-ad form should ask for.
 *
 * This lives on the SERVER, not in the app bundle, because the mobile app ships
 * through the Play Store: adding a breed used to mean a release. `GET /animals/meta`
 * serves this shape, and an admin can override it at runtime via the
 * `animals.masterData` app setting (settings.service.js) with no redeploy and no
 * app update. The constant below is the fallback used when no override is set.
 *
 * `fields` drives the DYNAMIC form: milk yield and lactation are only asked for
 * animals that produce milk, so a farmer selling a bullock is never shown a
 * "litres per day" box. Keep this in sync with what the write validators accept —
 * the server still validates independently; this only shapes the UI.
 */

/** Field keys the post-ad form may render per animal type. */
export const ANIMAL_FIELD_KEYS = [
  'age', 'weight', 'gender', 'price', 'milkYield', 'pregnant', 'lactating',
  'vaccinated', 'healthCertificate',
];

const COMMON = ['age', 'weight', 'gender', 'price', 'vaccinated', 'healthCertificate'];
const MILCH = [...COMMON, 'milkYield', 'pregnant', 'lactating'];

export const ANIMAL_MASTER_DATA = {
  version: 1,
  types: [
    { key: 'Cow', mr: 'गाय', milch: true, fields: MILCH, breeds: ['Gir', 'Sahiwal', 'Red Sindhi', 'Tharparkar', 'Rathi', 'Deoni', 'Khillari', 'Holstein Friesian', 'Jersey', 'HF Cross', 'Jersey Cross', 'Other'] },
    { key: 'Buffalo', mr: 'म्हैस', milch: true, fields: MILCH, breeds: ['Murrah', 'Jaffarabadi', 'Mehsana', 'Surti', 'Nagpuri', 'Pandharpuri', 'Bhadawari', 'Nili Ravi', 'Other'] },
    { key: 'Goat', mr: 'शेळी', milch: true, fields: MILCH, breeds: ['Osmanabadi', 'Sangamneri', 'Sirohi', 'Jamunapari', 'Beetal', 'Boer', 'Konkan Kanyal', 'Black Bengal', 'Other'] },
    { key: 'Bullock', mr: 'बैल', milch: false, fields: COMMON, breeds: ['Khillari', 'Deoni', 'Dangi', 'Red Kandhari', 'Gir', 'Amritmahal', 'Other'] },
    { key: 'Sheep', mr: 'मेंढी', milch: false, fields: COMMON, breeds: ['Deccani', 'Madgyal', 'Nellore', 'Bannur', 'Marwari', 'Other'] },
    { key: 'Poultry', mr: 'कोंबडी', milch: false, fields: COMMON, breeds: ['Giriraja', 'Kadaknath', 'Vanaraja', 'Broiler', 'Layer', 'Gavran', 'Other'] },
    { key: 'Horse', mr: 'घोडा', milch: false, fields: COMMON, breeds: ['Marwari', 'Kathiawari', 'Thoroughbred', 'Other'] },
    { key: 'Camel', mr: 'उंट', milch: true, fields: MILCH, breeds: ['Bikaneri', 'Jaisalmeri', 'Kachchhi', 'Other'] },
    { key: 'Pig', mr: 'डुक्कर', milch: false, fields: COMMON, breeds: ['Large White Yorkshire', 'Landrace', 'Ghungroo', 'Desi', 'Other'] },
    { key: 'Duck', mr: 'बदक', milch: false, fields: COMMON, breeds: ['Khaki Campbell', 'Indian Runner', 'Desi', 'Other'] },
    { key: 'Rabbit', mr: 'ससा', milch: false, fields: COMMON, breeds: ['New Zealand White', 'Soviet Chinchilla', 'Grey Giant', 'Other'] },
    { key: 'Donkey', mr: 'गाढव', milch: false, fields: COMMON, breeds: ['Halari', 'Desi', 'Other'] },
    { key: 'Dog', mr: 'कुत्रा', milch: false, fields: COMMON, breeds: ['Mudhol Hound', 'Rajapalayam', 'Indian Pariah', 'Other'] },
    { key: 'Fish', mr: 'मासा', milch: false, fields: ['price', 'weight', 'healthCertificate'], breeds: ['Rohu', 'Catla', 'Mrigal', 'Tilapia', 'Pangasius', 'Other'] },
    { key: 'Honeybee', mr: 'मधमाशी', milch: false, fields: ['price', 'healthCertificate'], breeds: ['Apis cerana indica', 'Apis mellifera', 'Other'] },
  ],
  /** Radius options offered by the distance filter, in km. null = "All". */
  radiusOptions: [null, 10, 25, 50, 100],
  /** Sort keys the list endpoint accepts, in the order the UI should show them. */
  sortOptions: ['relevance', 'latest', 'nearest', 'price_asc', 'price_desc'],
};
