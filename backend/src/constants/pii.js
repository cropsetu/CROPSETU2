/**
 * Sensitive PII fields whose churn we rate-limit tightly.
 *
 * These are the high-value identifiers (financial / government / DOB) that a
 * legitimate user changes very rarely. Capping how often they can be rewritten
 * blocks abuse (enumeration, laundering identities, harvesting audit noise)
 * without throttling ordinary profile edits like name / avatar / location.
 */
export const SENSITIVE_PII_FIELDS = [
  'aadharNumber',
  'panNumber',
  'bankAccountNumber',
  'bankIfsc',
  'bankHolderName',
  'bankName',
  'gstNumber',
  'dateOfBirth',
];

/**
 * True if a request body carries an actual sensitive-PII change — a field that
 * is present AND non-empty. Empty strings (sent by the client for not-yet-filled
 * fields) are ignored so they don't consume the tight PII budget.
 */
export function isSensitivePiiUpdate(body) {
  if (!body || typeof body !== 'object') return false;
  return SENSITIVE_PII_FIELDS.some((f) => {
    const v = body[f];
    return v !== undefined && v !== null && v !== '';
  });
}
