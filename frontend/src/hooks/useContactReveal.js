/**
 * useContactReveal — fetch a listing owner's phone number, then dial it.
 *
 * Phone numbers are no longer part of any listing payload. They come from a
 * per-listing endpoint that requires a signed-in caller, is capped at 30 an
 * hour, and records every release. That means "Call" is now two steps instead
 * of reading a field, and every screen that offers a call needs the same
 * fetch-then-dial dance — hence one hook rather than three copies.
 *
 * The number is cached for the life of the screen, so tapping Call twice does
 * not spend a second reveal against the hourly cap.
 *
 * Usage:
 *   const { call, revealing, phone, error } = useContactReveal(`/rent/machinery/${id}/contact`);
 *   <Button onPress={call} disabled={revealing} />
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import { Alert } from 'react-native';
import api from '@krushisarva/shared/services/api';
import { safeOpenURL, sanitizePhone } from '../utils/sanitize';
import { classifyError, ERROR_CODES } from '../utils/apiError';

/**
 * @param {string|null} path      e.g. `/rent/machinery/<id>/contact`
 * @param {object}      opts
 * @param {Function}    opts.t    translator
 * @param {boolean}     opts.signedIn
 */
export default function useContactReveal(path, { t = (k, f) => f || k, signedIn = true } = {}) {
  const [phone, setPhone] = useState(null);
  const [revealing, setRevealing] = useState(false);
  const [error, setError] = useState(null);

  const aliveRef = useRef(true);
  // Guards a double tap: setState lags a fast second press by a render, so the
  // state flag alone would let two reveals through and burn two of the hourly 30.
  const inFlightRef = useRef(false);
  useEffect(() => () => { aliveRef.current = false; }, []);

  /** Fetch the number (or return the cached one). Resolves to a string or null. */
  const reveal = useCallback(async () => {
    if (phone) return phone;
    if (!path || inFlightRef.current) return null;

    if (!signedIn) {
      Alert.alert(
        t('rent.signInTitle', 'Sign in to call'),
        t('rent.signInToCall', 'Please sign in so the owner knows who is calling.'),
      );
      return null;
    }

    inFlightRef.current = true;
    setRevealing(true);
    setError(null);
    try {
      const { data } = await api.get(path);
      const got = data?.data?.phone || null;
      if (aliveRef.current) setPhone(got);
      return got;
    } catch (e) {
      const classified = classifyError(e, t('rent.contactFailed', 'Could not get the contact number.'));
      if (classified.code === ERROR_CODES.CANCELED) return null;
      if (aliveRef.current) setError(classified);
      Alert.alert(t('product.error', 'Error'), classified.message);
      return null;
    } finally {
      inFlightRef.current = false;
      if (aliveRef.current) setRevealing(false);
    }
  }, [path, phone, signedIn, t]);

  /** Reveal then dial. The whole point of the reveal, in one handler. */
  const call = useCallback(async () => {
    const number = await reveal();
    if (!number) return;
    const ok = await safeOpenURL(`tel:${sanitizePhone(number)}`);
    if (!ok) Alert.alert(t('product.error', 'Error'), t('rent.phoneError', 'Could not open the dialler.'));
  }, [reveal, t]);

  return { phone, revealing, error, reveal, call };
}
