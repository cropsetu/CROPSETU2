/**
 * mandiApi.js — thin client for the existing mandi-price endpoints
 * (live Agmarknet / data.gov.in data, cached server-side).
 */
import api from './api';

/** Latest modal prices for a commodity in a state/district. → { rows, meta } */
export async function getMandiPrices({ commodity, state, district } = {}) {
  const qs = new URLSearchParams();
  if (commodity) qs.append('commodity', commodity);
  if (state) qs.append('state', state);
  if (district) qs.append('district', district);
  const { data: res } = await api.get(`/mandi/prices?${qs.toString()}`);
  return { rows: res.data || [], meta: res.meta || {} };
}

/** Daily modal-price series for one market. → { trend:[], stats:{} } */
export async function getMandiTrend(commodity, market, days = 30) {
  const qs = new URLSearchParams({ market: market || '', days: String(days) });
  const { data: res } = await api.get(`/mandi/prices/${encodeURIComponent(commodity)}/trend?${qs.toString()}`);
  return res.data || { trend: [], stats: {} };
}
