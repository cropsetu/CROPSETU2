/**
 * useUnsavedChanges — intercept a back navigation that would discard edits.
 *
 * Both seller forms (AddProduct, BusinessProfile) let a half-filled listing or
 * a typed-in bank account vanish on a stray back-swipe with no warning. This
 * hooks React Navigation's `beforeRemove` and, on web, the browser unload, and
 * asks first.
 */
import { useCallback, useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { useNavigation } from '@react-navigation/native';

export default function useUnsavedChanges(isDirty, confirmDiscard) {
  const navigation = useNavigation();
  const dirtyRef = useRef(isDirty);
  dirtyRef.current = isDirty;

  // Set while we are intentionally letting a navigation through (either the
  // user confirmed the discard, or the form just saved successfully).
  const bypass = useRef(false);

  const allowNext = useCallback(() => { bypass.current = true; }, []);

  useEffect(() => {
    const sub = navigation.addListener('beforeRemove', (e) => {
      if (!dirtyRef.current || bypass.current) {
        bypass.current = false;
        return;
      }
      e.preventDefault();
      Promise.resolve(confirmDiscard())
        .then((ok) => {
          if (!ok) return;
          bypass.current = true;
          navigation.dispatch(e.data.action);
        })
        .catch(() => {});
    });
    return sub;
  }, [navigation, confirmDiscard]);

  // Web: the in-app guard can't catch a tab close or a browser Back press.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return undefined;
    const onBeforeUnload = (e) => {
      if (!dirtyRef.current || bypass.current) return undefined;
      e.preventDefault();
      e.returnValue = '';   // required for Chrome to show its native prompt
      return '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  return { allowNext };
}
