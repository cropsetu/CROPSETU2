/**
 * MultiFarmContext — Server-synced multi-farm state.
 * Manages farms[], activeFarm, crop cycles. Caches to AsyncStorage for offline.
 */
import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
        const cached = await AsyncStorage.getItem(CACHE_FARMS);
        if (cached) { const f = JSON.parse(cached); setFarms(f); setActiveFarmId(user?.activeFarmId || f[0]?.id || null); }
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
      if (data) { setFarms(data); await AsyncStorage.setItem(CACHE_FARMS, JSON.stringify(data)); }
    } catch (e) { console.warn('[MultiFarm] refresh:', e.message); }
    finally { setSyncing(false); }
  }, [isLoggedIn]);

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
