/**
 * MultiFarmContext — Server-synced multi-farm state.
 * Manages farms[], activeFarm, crop cycles. Caches to AsyncStorage for offline.
 */
import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from './AuthContext';
import * as farmApi from '../services/farmApi';

const CACHE_FARMS = 'fe_farms_v1';
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

  const addFarm = useCallback(async (data) => {
    const farm = await farmApi.createFarm(data);
    setFarms(p => [...p, farm]);
    if (!activeFarmId) setActiveFarmId(farm.id);
    return farm;
  }, [activeFarmId]);

  const editFarm = useCallback(async (id, fields) => {
    const updated = await farmApi.updateFarm(id, fields);
    setFarms(p => p.map(f => f.id === id ? { ...f, ...updated } : f));
    return updated;
  }, []);

  const removeFarm = useCallback(async (id) => {
    await farmApi.deleteFarm(id);
    setFarms(p => p.filter(f => f.id !== id));
    if (activeFarmId === id) { const rem = farms.filter(f => f.id !== id); setActiveFarmId(rem[0]?.id || null); }
  }, [activeFarmId, farms]);

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
