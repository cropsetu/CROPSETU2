/**
 * MultiFarmContext — Server-synced multi-farm state.
 * Manages farms[], activeFarm, crop cycles. Caches to encrypted secure storage
 * (Keychain/Keystore) for offline — farm names/locations never hit disk as plaintext.
 */
import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { getSecureJSON, setSecureJSON } from '../utils/secureCache';
import { useAuth } from './AuthContext';
import * as farmApi from '../services/farmApi';
import { withWrite } from '../services/writeQueue';

const CACHE_FARMS = 'fe_farms_v1';
const tempId = () => 'temp-' + Date.now().toString(36);
const MultiFarmContext = createContext(null);

export function MultiFarmProvider({ children }) {
  const { user, isLoggedIn } = useAuth();
  const [farms, setFarms] = useState([]);
  const [activeFarmId, setActiveFarmId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    if (!isLoggedIn) { setFarms([]); setActiveFarmId(null); setLoading(false); return; }
    (async () => {
      try {
        const f = await getSecureJSON(CACHE_FARMS);
        if (f) { setFarms(f); setActiveFarmId(user?.activeFarmId || f[0]?.id || null); }
      } catch {}
      setLoading(false);
      refresh();
    })();
  }, [isLoggedIn]);

  const refresh = useCallback(async () => {
    if (!isLoggedIn) return;
    setSyncing(true);
    try {
      const data = await farmApi.listFarms();
      if (data) {
        setFarms(data);
        await setSecureJSON(CACHE_FARMS, data);
        // Make sure an active farm is selected once farms exist (e.g. the farm the
        // user just created during onboarding) so screens keyed on activeFarmId work.
        setActiveFarmId((prev) => prev || user?.activeFarmId || data[0]?.id || null);
      }
    } catch (e) { console.warn('[MultiFarm] refresh:', e.message); }
    finally { setSyncing(false); }
  }, [isLoggedIn, user?.activeFarmId]);

  // Re-fetch farms when onboarding finishes — the server creates the first farm at
  // that moment, but our initial load ran right after login (before any farm existed),
  // so without this My Farm would sit on the empty state until a manual refresh.
  useEffect(() => {
    if (isLoggedIn && user?.onboardingStep === 'COMPLETE') refresh();
  }, [isLoggedIn, user?.onboardingStep, user?.totalFarms, refresh]);

  const activeFarm = farms.find(f => f.id === activeFarmId) || farms[0] || null;

  const switchActiveFarm = useCallback(async (id) => {
    setActiveFarmId(id);
    try { await farmApi.setActiveFarm(id); } catch {}
  }, []);

  // Optimistic create: show the farm immediately, reconcile with the server
  // row on success, roll it back on failure. The write retries via writeQueue.
  const addFarm = useCallback(async (data) => {
    const tid = tempId();
    const optimistic = { id: tid, ...data, _pending: true };
    setFarms(p => [...p, optimistic]);
    setActiveFarmId(prev => prev || tid);
    try {
      const farm = await withWrite(() => farmApi.createFarm(data), { label: 'createFarm' });
      setFarms(p => p.map(f => (f.id === tid ? farm : f)));
      setActiveFarmId(prev => (prev === tid || !prev ? farm.id : prev));
      return farm;
    } catch (e) {
      setFarms(p => p.filter(f => f.id !== tid));   // rollback
      setActiveFarmId(prev => (prev === tid ? null : prev));
      throw e;
    }
  }, []);

  const editFarm = useCallback(async (id, fields) => {
    let prevSnapshot;
    setFarms(p => { prevSnapshot = p; return p.map(f => (f.id === id ? { ...f, ...fields } : f)); });
    try {
      const updated = await withWrite(() => farmApi.updateFarm(id, fields), { label: 'updateFarm' });
      setFarms(p => p.map(f => (f.id === id ? { ...f, ...updated } : f)));
      return updated;
    } catch (e) {
      if (prevSnapshot) setFarms(prevSnapshot);     // rollback
      throw e;
    }
  }, []);

  const removeFarm = useCallback(async (id) => {
    let prevSnapshot, prevActive;
    setActiveFarmId(a => { prevActive = a; return a; });
    setFarms(p => {
      prevSnapshot = p;
      const rem = p.filter(f => f.id !== id);
      if (prevActive === id) setActiveFarmId(rem[0]?.id || null);
      return rem;
    });
    try {
      await withWrite(() => farmApi.deleteFarm(id), { label: 'deleteFarm' });
    } catch (e) {
      if (prevSnapshot) setFarms(prevSnapshot);      // rollback
      setActiveFarmId(prevActive);
      throw e;
    }
  }, []);

  return (
    <MultiFarmContext.Provider value={{
      farms, activeFarm, activeFarmId, loading, syncing,
      refresh, switchActiveFarm, addFarm, editFarm, removeFarm,
      hasFarms: farms.length > 0,
    }}>
      {children}
    </MultiFarmContext.Provider>
  );
}

export function useMultiFarm() {
  const ctx = useContext(MultiFarmContext);
  if (!ctx) throw new Error('useMultiFarm must be inside <MultiFarmProvider>');
  return ctx;
}
