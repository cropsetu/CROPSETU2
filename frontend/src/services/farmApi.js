/**
 * Farm Profile API — All onboarding, farm, crop cycle endpoints.
 */
import api from './api';

// ── Onboarding ───────────────────────────────────────────────────────────────

export async function completeOnboarding(data) {
  const { data: res } = await api.post('/onboarding/complete', data);
  return res.data;
}

export async function skipOnboarding() {
  const { data: res } = await api.post('/onboarding/skip');
  return res.data;
}

// ── Farms ────────────────────────────────────────────────────────────────────

export async function listFarms() {
  const { data: res } = await api.get('/farms');
  return res.data;
}

export async function createFarm(farmData) {
  const { data: res } = await api.post('/farms', farmData);
  return res.data;
}

export async function getFarm(farmId) {
  const { data: res } = await api.get(`/farms/${farmId}`);
  return res.data;
}

export async function updateFarm(farmId, fields) {
  const { data: res } = await api.patch(`/farms/${farmId}`, fields);
  return res.data;
}

export async function deleteFarm(farmId) {
  const { data: res } = await api.delete(`/farms/${farmId}`);
  return res.data;
}

export async function setActiveFarm(farmId) {
  const { data: res } = await api.post('/farms/active', { farmId });
  return res.data;
}

export async function getFarmInsights(farmId, params = {}) {
  const qs = new URLSearchParams();
  if (params.limit) qs.append('limit', params.limit);
  if (params.type) qs.append('type', params.type);
  const { data: res } = await api.get(`/farms/${farmId}/insights?${qs}`);
  return res.data;
}

export async function getFarmFinancialSummary(farmId, params = {}) {
  const qs = new URLSearchParams();
  if (params.season) qs.append('season', params.season);
  if (params.year) qs.append('year', params.year);
  const { data: res } = await api.get(`/farms/${farmId}/financial-summary?${qs}`);
  return res.data;
}

// ── Crop Cycles ──────────────────────────────────────────────────────────────

export async function listCropCycles(farmId, filters = {}) {
  const params = new URLSearchParams();
  if (filters.season) params.append('season', filters.season);
  if (filters.year) params.append('year', filters.year);
  if (filters.status) params.append('status', filters.status);
  const { data: res } = await api.get(`/farms/${farmId}/cycles?${params}`);
  return res.data;
}

export async function createCropCycle(farmId, data) {
  const { data: res } = await api.post(`/farms/${farmId}/cycles`, data);
  return res.data;
}

export async function getCropCycle(cycleId) {
  const { data: res } = await api.get(`/cycles/${cycleId}`);
  return res.data;
}

export async function deleteCropCycle(cycleId) {
  const { data: res } = await api.delete(`/cycles/${cycleId}`);
  return res.data;
}

export async function addFertilizer(cycleId, entry) {
  const { data: res } = await api.post(`/cycles/${cycleId}/fertilizer`, entry);
  return res.data;
}

export async function addPesticide(cycleId, entry) {
  const { data: res } = await api.post(`/cycles/${cycleId}/pesticide`, entry);
  return res.data;
}

export async function addIrrigationLog(cycleId, entry) {
  const { data: res } = await api.post(`/cycles/${cycleId}/irrigation`, entry);
  return res.data;
}

export async function recordHarvest(cycleId, data) {
  const { data: res } = await api.post(`/cycles/${cycleId}/harvest`, data);
  return res.data;
}

export async function recordSale(cycleId, data) {
  const { data: res } = await api.post(`/cycles/${cycleId}/sale`, data);
  return res.data;
}

export async function completeCycle(cycleId) {
  const { data: res } = await api.post(`/cycles/${cycleId}/complete`);
  return res.data;
}

export async function getCycleFinancials(cycleId) {
  const { data: res } = await api.get(`/cycles/${cycleId}/financials`);
  return res.data;
}
