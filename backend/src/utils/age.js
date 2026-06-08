/**
 * Age helpers — DPDP Act §9 (children's data).
 *
 * Under the DPDP Act a "child" is an individual under 18 years of age. These
 * helpers derive age / minor status from a date of birth so we can require
 * verifiable parental consent and gate restricted flows for minors.
 */

export const AGE_OF_MAJORITY = 18;

/**
 * Whole-years age for a date of birth, or null if the dob is missing/invalid.
 */
export function computeAge(dob, now = new Date()) {
  if (!dob) return null;
  const birth = dob instanceof Date ? dob : new Date(dob);
  if (Number.isNaN(birth.getTime())) return null;
  let age = now.getFullYear() - birth.getFullYear();
  const monthDiff = now.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) age -= 1;
  return age;
}

/**
 * True if the dob indicates a person under 18. An unknown/invalid dob returns
 * false (we cannot assert minor status without a date of birth) — callers that
 * must be certain should require a dob first.
 */
export function isMinorDob(dob, now = new Date()) {
  const age = computeAge(dob, now);
  return age == null ? false : age < AGE_OF_MAJORITY;
}
