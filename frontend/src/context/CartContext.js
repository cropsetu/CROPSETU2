/**
 * CartContext — single source of truth for cart line count.
 *
 * Exposes:
 *   count       — number of distinct cart lines (matches what CartScreen renders)
 *   refresh()   — re-fetch from /agristore/cart and update count
 *
 * Screens that mutate the cart (ProductDetail, CartScreen) call refresh() after
 * their write so the badge stays in sync from anywhere it's rendered.
 */
import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import api from '../services/api';
import { useAuth } from './AuthContext';

const CartContext = createContext(null);

export function CartProvider({ children }) {
  const { isLoggedIn } = useAuth();
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!isLoggedIn) { setCount(0); return; }
    try {
      const { data } = await api.get('/agristore/cart');
      // Endpoint returns { data: { items: [...], total: N } } — count distinct lines.
      const items = data?.data?.items;
      setCount(Array.isArray(items) ? items.length : 0);
    } catch {
      // Network/auth errors leave the previous count alone — don't flicker to 0.
    }
  }, [isLoggedIn]);

  // Fetch when auth flips to logged-in; clear on logout.
  useEffect(() => { refresh(); }, [refresh]);

  // Stable identity unless count/refresh actually change — avoids re-rendering
  // every cart consumer (e.g. the tab badge) on unrelated parent renders.
  const value = useMemo(() => ({ count, refresh }), [count, refresh]);

  return (
    <CartContext.Provider value={value}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within CartProvider');
  return ctx;
}

export default CartContext;
