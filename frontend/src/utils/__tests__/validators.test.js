import {
  isValidPhone, isValidPincode, isValidOtp,
  isValidGst, isValidIfsc, isValidAadhaar, isValidPan,
  normalizePhone, PHONE_RE, PINCODE_RE,
} from '../validators';

describe('normalizePhone', () => {
  test('passes through a bare 10-digit number', () => {
    expect(normalizePhone('9876543210')).toBe('9876543210');
  });
  test('strips a +91 country code', () => {
    expect(normalizePhone('+91 98765 43210')).toBe('9876543210');
    expect(normalizePhone('919876543210')).toBe('9876543210');
  });
  test('strips a leading 0 trunk prefix', () => {
    expect(normalizePhone('09876543210')).toBe('9876543210');
  });
  test('does NOT strip 91 from a genuine 10-digit number starting with 91', () => {
    expect(normalizePhone('9112345678')).toBe('9112345678');
  });
  test('strips formatting characters', () => {
    expect(normalizePhone('(987) 654-3210')).toBe('9876543210');
  });
});

describe('isValidPhone', () => {
  test.each(['9876543210', '6000000000', '+91 9876543210', '09876543210', '9112345678'])(
    'accepts %s', (v) => expect(isValidPhone(v)).toBe(true),
  );
  test.each([
    '1234567890',   // starts with 1
    '5876543210',   // starts with 5
    '98765',        // too short
    '98765432101',  // too long (11, no trunk prefix)
    'abcdefghij',
    '',
    null,
    undefined,
  ])('rejects %s', (v) => expect(isValidPhone(v)).toBe(false));
});

describe('isValidPincode', () => {
  test.each(['411001', '110001', '000000'])('accepts %s', (v) => expect(isValidPincode(v)).toBe(true));
  test('trims surrounding whitespace', () => expect(isValidPincode('  411001 ')).toBe(true));
  test.each(['41100', '4110011', '4110a1', '', null])('rejects %s', (v) => expect(isValidPincode(v)).toBe(false));
});

describe('isValidOtp', () => {
  test('accepts 6 digits', () => expect(isValidOtp('123456')).toBe(true));
  test.each(['12345', '1234567', '12a456', ''])('rejects %s', (v) => expect(isValidOtp(v)).toBe(false));
});

describe('KYC validators', () => {
  test('GST', () => {
    expect(isValidGst('27ABCDE1234F1Z5')).toBe(true);
    expect(isValidGst('27abcde1234f1z5')).toBe(true); // case-insensitive
    expect(isValidGst('27ABCDE1234F1Z')).toBe(false); // too short
    expect(isValidGst('ABCDE1234F1Z55')).toBe(false);
  });
  test('IFSC', () => {
    expect(isValidIfsc('SBIN0012345')).toBe(true);
    expect(isValidIfsc('sbin0012345')).toBe(true);
    expect(isValidIfsc('SBIN1012345')).toBe(false); // 5th char must be 0
    expect(isValidIfsc('SBI0012345')).toBe(false);
  });
  test('Aadhaar', () => {
    expect(isValidAadhaar('123456789012')).toBe(true);
    expect(isValidAadhaar('12345678901')).toBe(false);
    expect(isValidAadhaar('1234 5678 9012')).toBe(false); // spaces not allowed
  });
  test('PAN', () => {
    expect(isValidPan('ABCDE1234F')).toBe(true);
    expect(isValidPan('abcde1234f')).toBe(true);
    expect(isValidPan('ABCD1234F')).toBe(false);
    expect(isValidPan('ABCDE12345')).toBe(false);
  });
});

describe('exported regexes match the predicates', () => {
  test('PHONE_RE / PINCODE_RE are the canonical patterns', () => {
    expect(PHONE_RE.test('9876543210')).toBe(true);
    expect(PINCODE_RE.test('411001')).toBe(true);
  });
});
