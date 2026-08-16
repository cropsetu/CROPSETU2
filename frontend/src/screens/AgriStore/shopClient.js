/**
 * Shop endpoints.
 *
 * The thin network layer. Every rule about HOW to call — sequencing, cancellation,
 * error classification, caching, retry — lives in shopUtils.js, which has no
 * axios dependency and is therefore unit-testable on its own. This file is just
 * the URLs and their response shapes, and it re-exports the utilities so screens
 * import from one place.
 */
import api from '@cropsetu/shared/services/api';

export * from './shopUtils';

// ── Endpoints ──────────────────────────────────────────────────────────
/** Card-shaped product page. Returns `{ items, meta }`. */
export async function fetchProducts(params, signal) {
  const { data } = await api.get('/agristore/products', { params, signal });
  return { items: Array.isArray(data?.data) ? data.data : [], meta: data?.meta || {} };
}

export async function fetchCategories(signal) {
  const { data } = await api.get('/agristore/categories', { signal });
  return Array.isArray(data?.data) ? data.data : [];
}

export async function fetchFacets(category, signal) {
  const { data } = await api.get('/agristore/products/facets', {
    params: category ? { category } : {},
    signal,
  });
  return data?.data || null;
}

/** The authoritative cart quote. Every number the buyer is shown comes from here. */
export async function fetchCartQuote({ paymentMethod, pincode } = {}, signal) {
  const { data } = await api.get('/agristore/cart/quote', {
    params: { ...(paymentMethod ? { paymentMethod } : {}), ...(pincode ? { pincode } : {}) },
    signal,
  });
  return data?.data || null;
}

export async function checkServiceability(productId, pincode, signal) {
  const { data } = await api.get(`/agristore/products/${productId}/serviceability`, {
    params: { pincode },
    signal,
  });
  return data?.data || null;
}

export async function fetchReviews(productId, { cursor, limit = 10 } = {}, signal) {
  const { data } = await api.get(`/agristore/products/${productId}/reviews`, {
    params: { ...(cursor ? { cursor } : {}), limit },
    signal,
  });
  return { ...(data?.data || { reviews: [], summary: null }), meta: data?.meta || {} };
}

/**
 * Ask whether an interrupted payment actually went through.
 *
 * The single most important call in the module: without it a farmer whose
 * connection dropped after paying sees a failure and pays again.
 */
export async function fetchPaymentStatus(providerOrderId, signal) {
  const { data } = await api.get(`/agristore/orders/payment-status/${providerOrderId}`, { signal });
  return data?.data || null;
}

/**
 * What the server can actually collect with.
 *
 * The checkout screen used to render UPI and Card unconditionally and then post
 * the choice to an endpoint that creates an order WITHOUT taking money. Asking
 * first is what stops the app offering a payment method it cannot honour.
 *
 * Fails CLOSED: any error resolves to cash-on-delivery only. Better to under-
 * offer than to open a checkout sheet that cannot complete.
 */
export async function fetchPaymentConfig(signal) {
  try {
    const { data } = await api.get('/agristore/payment-config', { signal });
    return data?.data || { onlineEnabled: false, methods: ['cod'], keyId: null };
  } catch {
    return { onlineEnabled: false, methods: ['cod'], keyId: null };
  }
}

/** Raise a gateway order for the current cart. Returns the id + amount to charge. */
export async function initiatePayment({ paymentMethod, deliveryAddressId, pincode, expectedTotal, expectedPayable }) {
  const { data } = await api.post('/agristore/orders/initiate', {
    paymentMethod, deliveryAddressId, pincode, expectedTotal, expectedPayable,
  });
  return data?.data || null;
}

/**
 * Turn a verified payment into an order.
 *
 * The signature is re-verified server-side against the secret key, so nothing
 * this call sends is trusted — it is a claim the server checks, not a result.
 */
export async function confirmPayment({ razorpayOrderId, razorpayPaymentId, razorpaySignature, deliveryAddressId, expectedTotal, expectedPayable }) {
  const { data } = await api.post('/agristore/orders/confirm', {
    razorpayOrderId, razorpayPaymentId, razorpaySignature,
    deliveryAddressId, expectedTotal, expectedPayable,
  });
  return data?.data || null;
}

