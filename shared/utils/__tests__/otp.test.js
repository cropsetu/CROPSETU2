import { applyOtpInput, isOtpComplete, shouldAutoSubmitOtp, OTP_LENGTH } from '../otp';

const empty = () => Array(OTP_LENGTH).fill('');

describe('applyOtpInput — typing', () => {
  test('writes one digit and advances focus', () => {
    expect(applyOtpInput(empty(), 0, '4')).toEqual({
      digits: ['4', '', '', '', '', ''], focus: 1,
    });
  });
  test('does not advance past the last box', () => {
    const prev = ['1', '2', '3', '4', '5', ''];
    expect(applyOtpInput(prev, 5, '6')).toEqual({
      digits: ['1', '2', '3', '4', '5', '6'], focus: null,
    });
  });
  test('backspace clears the box and leaves focus alone', () => {
    expect(applyOtpInput(['1', '2', '', '', '', ''], 1, '')).toEqual({
      digits: ['1', '', '', '', '', ''], focus: null,
    });
  });
  test('ignores non-digits', () => {
    expect(applyOtpInput(empty(), 0, 'a').digits).toEqual(empty());
  });
  test('ignores an out-of-range index instead of growing the array', () => {
    expect(applyOtpInput(empty(), 9, '1')).toEqual({ digits: empty(), focus: null });
  });
});

describe('applyOtpInput — paste / SMS autofill', () => {
  test('a full code landing in box 0 spreads across all six boxes', () => {
    expect(applyOtpInput(empty(), 0, '482913')).toEqual({
      digits: ['4', '8', '2', '9', '1', '3'], focus: OTP_LENGTH - 1,
    });
  });
  test('strips formatting an SMS app may include', () => {
    expect(applyOtpInput(empty(), 0, '482 913').digits).toEqual(['4', '8', '2', '9', '1', '3']);
  });
  test('a partial paste fills from the current box and focuses the next empty one', () => {
    expect(applyOtpInput(['4', '', '', '', '', ''], 1, '891')).toEqual({
      digits: ['4', '8', '9', '1', '', ''], focus: 4,
    });
  });
  test('drops overflow rather than writing past the last box', () => {
    expect(applyOtpInput(empty(), 3, '482913').digits).toEqual(['', '', '', '4', '8', '2']);
  });
});

describe('isOtpComplete', () => {
  test('true only when all six boxes hold a digit', () => {
    expect(isOtpComplete(['4', '8', '2', '9', '1', '3'])).toBe(true);
    expect(isOtpComplete(['4', '8', '2', '9', '1', ''])).toBe(false);
    expect(isOtpComplete(['4', '8', '2', '9', '1'])).toBe(false);
    expect(isOtpComplete(null)).toBe(false);
  });
});

describe('shouldAutoSubmitOtp', () => {
  const full = ['4', '8', '2', '9', '1', '3'];

  test('fires once the code is complete', () => {
    expect(shouldAutoSubmitOtp({ digits: full, verifying: false, lastSubmitted: null })).toBe(true);
  });
  test('does not fire on a partial code', () => {
    expect(shouldAutoSubmitOtp({ digits: ['4', '8', '', '', '', ''], verifying: false, lastSubmitted: null })).toBe(false);
  });
  test('does not fire while a verify is already in flight', () => {
    expect(shouldAutoSubmitOtp({ digits: full, verifying: true, lastSubmitted: null })).toBe(false);
  });
  test('does not re-fire for a code it already submitted', () => {
    expect(shouldAutoSubmitOtp({ digits: full, verifying: false, lastSubmitted: '482913' })).toBe(false);
  });
  test('fires again for the same digits once the guard is cleared after a failure', () => {
    expect(shouldAutoSubmitOtp({ digits: full, verifying: false, lastSubmitted: null })).toBe(true);
  });
  test('fires for a different code even if one was submitted before', () => {
    expect(shouldAutoSubmitOtp({ digits: full, verifying: false, lastSubmitted: '111111' })).toBe(true);
  });
});
