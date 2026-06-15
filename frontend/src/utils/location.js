// Seller locations are stored as a single string. Two formats exist in the
// wild: properly separated ("Nashik, Maharashtra") and a legacy run-on form
// where profile fields were joined with no separator at all
// ("PalshiSillodAurangabadMaharashtra" — village+taluka+district+state).
//
// formatLocation normalises both into "Palshi, Sillod, Aurangabad, Maharashtra"
// so old and new listings render consistently.
export function formatLocation(loc) {
  if (!loc) return '';
  const s = String(loc).trim();
  if (!s) return '';

  // Already separated — just tidy spacing around the commas.
  if (s.includes(',')) {
    return s.split(',').map((p) => p.trim()).filter(Boolean).join(', ');
  }

  // Run-on form: split on TitleCase word boundaries (lowercase/digit → Uppercase).
  return s.replace(/([a-z0-9])([A-Z])/g, '$1, $2').trim();
}

// First location segment for compact card labels. The location string is built
// as "village, taluka, district, city, state", so the first segment is the
// village (falling back to whatever the most specific available place is).
export function locationVillage(loc) {
  const formatted = formatLocation(loc);
  return formatted ? formatted.split(',')[0].trim() : '';
}

// Village + taluka — the two most specific segments — for compact card labels,
// e.g. "Palshi, Sillod". Falls back to whatever segments are available.
export function locationVillageTaluka(loc) {
  const formatted = formatLocation(loc);
  if (!formatted) return '';
  return formatted.split(',').map((p) => p.trim()).filter(Boolean).slice(0, 2).join(', ');
}
