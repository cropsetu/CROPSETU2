/**
 * Shop pricing — the ONE place an order's payable amount is decided.
 *
 * ── What was wrong ───────────────────────────────────────────────────────────
 * The delivery fee lived in the mobile app:
 *
 *     const FREE_THRESHOLD = 999;
 *     const delivery   = total >= FREE_THRESHOLD ? 0 : 49;
 *     const grandTotal = total + delivery;          // CartScreen.js
 *
 * …and was then never sent anywhere. The farmer approved "₹1,048" on the cart
 * screen, the app posted the goods subtotal as `expectedTotal`, and the order
 * was created for ₹999. For online payments the Razorpay order was raised for
 * the subtotal too, so the delivery fee was displayed and never collected. Both
 * numbers were wrong, in opposite directions, and neither was auditable.
 *
 * Tax did not exist at all, while the product page rendered "inclusive of all
 * taxes" under every price.
 *
 * ── The rule now ─────────────────────────────────────────────────────────────
 * The client sends a cart. The server returns a QUOTE. The quote is the only
 * thing that may become an order, and its `total` is the only amount that may be
 * charged. Everything the buyer is shown — every line, the ETA, the tax split —
 * comes from that quote, so the screen and the charge cannot disagree.
 *
 * Every rate is an admin setting (`shop.*`), never a constant here: a delivery
 * fee is a commercial decision an operator changes without a release.
 *
 * ── Shape ────────────────────────────────────────────────────────────────────
 * A cart spans sellers, so the quote is per SHIPMENT (one per seller), because
 * that is what actually gets dispatched and what delivery is charged on.
 *
 *   quote.shipments[]   one per seller: goods, delivery, ETA, serviceability
 *   quote.subtotal      Σ goods
 *   quote.deliveryFee   Σ shipment delivery (+ COD fee)
 *   quote.taxAmount     Σ per-line tax
 *   quote.total         THE PAYABLE
 *   quote.issues[]      blocking — checkout must refuse while any exist
 *   quote.warnings[]    non-blocking — shown, not enforced
 *
 * All arithmetic is Prisma.Decimal (see utils/money.js). Never floats.
 */
import crypto from 'crypto';
import { D, round2, toMinorUnits, sumD } from '../utils/money.js';
import { getSetting } from './settings.service.js';
import { resolveServiceability } from './serviceability.service.js';

/** Blocking issue codes. The app maps these to a specific recovery action. */
export const QUOTE_ISSUES = {
  EMPTY_CART: 'EMPTY_CART',
  OFFER_UNAVAILABLE: 'OFFER_UNAVAILABLE',
  INSUFFICIENT_STOCK: 'INSUFFICIENT_STOCK',
  BELOW_MIN_ORDER: 'BELOW_MIN_ORDER',
  PRICE_CHANGED: 'PRICE_CHANGED',
  FREIGHT_QUOTE_REQUIRED: 'FREIGHT_QUOTE_REQUIRED',
  PINCODE_UNSERVICEABLE: 'PINCODE_UNSERVICEABLE',
  COMPLIANCE_BLOCKED: 'COMPLIANCE_BLOCKED',
};

/** Shipping classes a product can declare. Anything else is treated as PARCEL. */
export const SHIPPING_CLASSES = ['PARCEL', 'HEAVY', 'FREIGHT', 'PICKUP_ONLY'];

async function pricingConfig() {
  const [
    feePerShipment, freeAbove, heavyFee, freightQuoteRequired, codFee,
    taxEnabled, pricesIncludeTax, defaultRatePct,
    returnWindowDays, nonReturnableCategoryIds,
  ] = await Promise.all([
    getSetting('shop.delivery.feePerShipment'),
    getSetting('shop.delivery.freeAboveSubtotal'),
    getSetting('shop.delivery.heavyFee'),
    getSetting('shop.delivery.freightQuoteRequired'),
    getSetting('shop.delivery.codFee'),
    getSetting('shop.tax.enabled'),
    getSetting('shop.tax.pricesIncludeTax'),
    getSetting('shop.tax.defaultRatePct'),
    getSetting('shop.returns.defaultWindowDays'),
    getSetting('shop.returns.nonReturnableCategoryIds'),
  ]);

  return {
    feePerShipment: D(feePerShipment),
    freeAbove: D(freeAbove),
    heavyFee: D(heavyFee),
    freightQuoteRequired: freightQuoteRequired !== false,
    codFee: D(codFee),
    taxEnabled: taxEnabled === true,
    pricesIncludeTax: pricesIncludeTax !== false,
    defaultRatePct: D(defaultRatePct),
    returnWindowDays: Number(returnWindowDays) || 0,
    nonReturnableCategoryIds: new Set(Array.isArray(nonReturnableCategoryIds) ? nonReturnableCategoryIds : []),
  };
}

/**
 * Tax on one line.
 *
 * Two conventions, and getting them backwards is a real money bug:
 *   pricesIncludeTax  the listed price IS the final price; the tax shown is the
 *                     portion already inside it   →  line × r/(100+r)
 *   !pricesIncludeTax the tax is added on top     →  line × r/100
 *
 * Only the second one moves the payable. The first is a display split, which is
 * why `addedToTotal` is reported separately from `amount`.
 */
function lineTax(lineTotal, ratePct, cfg) {
  if (!cfg.taxEnabled) return { amount: D(0), addedToTotal: D(0), ratePct: D(0) };
  const r = D(ratePct ?? cfg.defaultRatePct);
  if (r.lte(0)) return { amount: D(0), addedToTotal: D(0), ratePct: D(0) };

  if (cfg.pricesIncludeTax) {
    const amount = round2(D(lineTotal).times(r).dividedBy(r.plus(100)));
    return { amount, addedToTotal: D(0), ratePct: r };
  }
  const amount = round2(D(lineTotal).times(r).dividedBy(100));
  return { amount, addedToTotal: amount, ratePct: r };
}

/**
 * A stable fingerprint of what was quoted.
 *
 * `/orders/initiate` freezes it on the PaymentIntent; `/orders/confirm` recomputes
 * it. If the buyer edited the cart in another session while the payment sheet was
 * open, the hash differs and confirm refuses rather than charging a payment raised
 * for a different basket. Deliberately covers quantities and unit prices, not
 * display fields.
 */
export function quoteFingerprint(quote) {
  const basis = (quote.shipments || [])
    .flatMap((s) => s.items)
    .map((i) => `${i.listingId || i.productId}:${i.quantity}:${D(i.unitPrice).toFixed(2)}`)
    .sort()
    .join('|');
  return crypto
    .createHash('sha256')
    .update(`${basis}#${D(quote.total).toFixed(2)}`)
    .digest('hex')
    .slice(0, 32);
}

/**
 * Normalise a cart row (with `listing` + `product` included) into a priced line.
 *
 * DUAL-READ: a row written before the catalog split has no listing, so it is
 * priced off the legacy product columns exactly as the rest of the codebase does.
 */
function toLine(item, cfg) {
  const listing = item.listing || null;
  const product = listing?.variant?.product || item.product || {};
  const unitPrice = D(listing?.sellingPrice ?? item.product?.price ?? 0);
  const quantity = Number(item.quantity) || 0;
  const lineTotal = round2(unitPrice.times(quantity));
  const tax = lineTax(lineTotal, product.taxRatePct, cfg);
  const shippingClass = SHIPPING_CLASSES.includes(product.shippingClass) ? product.shippingClass : 'PARCEL';

  return {
    cartItemId: item.id,
    listingId: item.listingId || null,
    productId: item.productId || product.id || null,
    variantId: listing?.variantId || null,
    sellerId: listing?.sellerId || item.product?.sellerId || null,
    sellerName: listing?.seller?.name || null,
    name: product.name || null,
    nameMr: product.nameMr || null,
    image: listing?.images?.[0] || product.images?.[0] || null,
    brand: product.brand || null,
    unit: listing?.variant?.unit || item.product?.unit || null,
    packSize: listing?.variant?.attributes?.packSize || null,
    categoryId: product.categoryId || null,
    shippingClass,
    quantity,
    unitPrice,
    mrp: listing?.mrp != null ? D(listing.mrp) : (item.product?.mrp != null ? D(item.product.mrp) : null),
    lineTotal,
    taxRatePct: tax.ratePct,
    taxAmount: tax.amount,
    taxAddedToTotal: tax.addedToTotal,
    // Frozen onto the order item so eligibility never gets re-decided later —
    // and never gets decided by the app.
    returnEligible: !cfg.nonReturnableCategoryIds.has(product.categoryId),
    returnWindowDays: cfg.nonReturnableCategoryIds.has(product.categoryId) ? 0 : cfg.returnWindowDays,
    stockAvailable: listing?.stockQty ?? item.product?.stock ?? null,
    minOrderQty: listing?.minOrderQty ?? item.product?.minOrderQty ?? 1,
    listingStatus: listing?.status ?? null,
    unitPriceSnapshot: item.unitPriceSnapshot != null ? D(item.unitPriceSnapshot) : null,
  };
}

/**
 * Validate one line against the live offer. Returns blocking issues.
 *
 * This is the DISPLAY-TIME check — it tells the buyer what is wrong while they
 * are still on the cart screen. It is NOT the authority: checkout re-runs the
 * same checks inside its Serializable transaction, because anything read here is
 * already stale by the time the order is written.
 */
function validateLine(line, reservedByListing = null) {
  const issues = [];
  const label = line.name || 'This item';

  // Units THIS buyer is already holding for this checkout. They were decremented
  // from stockQty at /orders/initiate, so without counting them back the buyer
  // who reserved the last unit is told at confirm that it is gone — locked out
  // of their own purchase by the very hold that was protecting it.
  const held = (line.listingId && reservedByListing?.get(line.listingId)) || 0;

  if (line.listingId && line.listingStatus && line.listingStatus !== 'ACTIVE') {
    // OUT_OF_STOCK is DERIVED from stockQty reaching zero, so reserving the last
    // unit flips the listing into it — which is correct for everyone else and
    // wrong for the holder. A holder passes; BLOCKED and INACTIVE never do,
    // because those are trust-and-safety and seller decisions, not stock arithmetic.
    const heldThroughOutOfStock = held > 0 && line.listingStatus === 'OUT_OF_STOCK';
    if (!heldThroughOutOfStock) {
      issues.push({
        code: QUOTE_ISSUES.OFFER_UNAVAILABLE,
        listingId: line.listingId,
        message: `"${label}" is no longer available from this seller.`,
      });
      return issues;
    }
  }
  const available = (line.stockAvailable ?? 0) + held;
  if (line.stockAvailable != null && available < line.quantity) {
    issues.push({
      code: QUOTE_ISSUES.INSUFFICIENT_STOCK,
      listingId: line.listingId,
      available: line.stockAvailable,
      message: line.stockAvailable > 0
        ? `Only ${line.stockAvailable} left of "${label}".`
        : `"${label}" is out of stock.`,
    });
  }
  if (line.quantity < line.minOrderQty) {
    issues.push({
      code: QUOTE_ISSUES.BELOW_MIN_ORDER,
      listingId: line.listingId,
      minOrderQty: line.minOrderQty,
      message: `This seller's minimum order for "${label}" is ${line.minOrderQty}.`,
    });
  }
  if (line.unitPriceSnapshot && !line.unitPriceSnapshot.equals(line.unitPrice)) {
    // NOT an error — a price change is normal. It is surfaced so the buyer
    // re-approves it, which is also what the checkout transaction enforces.
    issues.push({
      code: QUOTE_ISSUES.PRICE_CHANGED,
      listingId: line.listingId,
      previousPrice: line.unitPriceSnapshot.toFixed(2),
      currentPrice: line.unitPrice.toFixed(2),
      message: `The price of "${label}" changed from ₹${line.unitPriceSnapshot.toFixed(2)} to ₹${line.unitPrice.toFixed(2)}.`,
    });
  }
  return issues;
}

/**
 * Build the authoritative quote for a set of cart rows.
 *
 * @param {object}  args
 * @param {Array}   args.cartItems       rows with `listing` (+variant+product+seller) and `product` included
 * @param {string}  [args.paymentMethod] 'cod' | 'upi' | 'card' | 'online'
 * @param {string}  [args.pincode]       delivery PIN code, for serviceability + ETA
 * @param {Array}   [args.complianceIssues] blocking issues from shopCompliance.service
 * @param {Map<string,number>} [args.reservedByListing] units this checkout already holds
 * @returns {Promise<object>} the quote
 */
export async function buildQuote({
  cartItems, paymentMethod = 'cod', pincode = null, complianceIssues = [], reservedByListing = null,
}) {
  const cfg = await pricingConfig();

  if (!cartItems?.length) {
    return {
      currency: 'INR',
      shipments: [],
      subtotal: '0.00', deliveryFee: '0.00', taxAmount: '0.00',
      taxIncludedInPrice: cfg.pricesIncludeTax, discountAmount: '0.00', codFee: '0.00',
      total: '0.00', totalPaise: 0,
      itemCount: 0, shipmentCount: 0,
      issues: [{ code: QUOTE_ISSUES.EMPTY_CART, message: 'Your cart is empty.' }],
      warnings: [],
      fingerprint: null,
      pricedAt: new Date().toISOString(),
    };
  }

  const lines = cartItems.map((i) => toLine(i, cfg));

  // ── Group into shipments (one per seller) ───────────────────────────────────
  // Delivery is charged per DISPATCH, and two Kendras dispatch twice. A cart-wide
  // flat fee would undercharge a two-seller cart and a per-item fee would gouge a
  // five-packet one.
  const bySeller = new Map();
  for (const line of lines) {
    const key = line.sellerId || '__unknown__';
    if (!bySeller.has(key)) bySeller.set(key, { sellerId: line.sellerId, sellerName: line.sellerName, items: [] });
    bySeller.get(key).items.push(line);
  }

  const issues = [...complianceIssues];
  const warnings = [];

  // Serviceability is one probe per seller, resolved concurrently.
  const serviceability = pincode
    ? await resolveServiceability({ sellerIds: [...bySeller.values()].map((s) => s.sellerId).filter(Boolean), pincode })
    : new Map();

  const shipments = [];
  for (const group of bySeller.values()) {
    const goods = round2(sumD(group.items, (i) => i.lineTotal));

    // FREIGHT items cannot be priced by parcel rules. Charging a ₹49 delivery on
    // a rotavator is not a rounding error, so the quote refuses instead of
    // guessing, and the buyer is routed to Request Quote.
    const freightItems = group.items.filter((i) => i.shippingClass === 'FREIGHT');
    if (freightItems.length && cfg.freightQuoteRequired) {
      issues.push({
        code: QUOTE_ISSUES.FREIGHT_QUOTE_REQUIRED,
        sellerId: group.sellerId,
        listingIds: freightItems.map((i) => i.listingId),
        message: 'Machinery in your cart needs a transport quote before it can be ordered. Request a quote from the seller to continue.',
      });
    }

    const heavyCount = group.items.filter((i) => i.shippingClass === 'HEAVY').length;
    const hasParcel = group.items.some((i) => i.shippingClass === 'PARCEL' || i.shippingClass === 'FREIGHT');

    // Free delivery is judged per shipment, on that seller's goods only. Judging
    // it on the cart-wide total would give free delivery on a ₹50 line just
    // because a different Kendra's line was expensive.
    const freeApplies = cfg.freeAbove.gt(0) && goods.gte(cfg.freeAbove);
    const parcelFee = hasParcel && !freeApplies ? cfg.feePerShipment : D(0);
    // Heavy handling is never waived by the free-delivery threshold — it is a
    // real transport cost, not a promotion.
    const heavyFee = cfg.heavyFee.times(heavyCount);

    const svc = group.sellerId ? serviceability.get(group.sellerId) : null;
    const surcharge = svc?.surcharge ? D(svc.surcharge) : D(0);

    if (pincode && svc && svc.serviceable === false) {
      issues.push({
        code: QUOTE_ISSUES.PINCODE_UNSERVICEABLE,
        sellerId: group.sellerId,
        pincode,
        message: `${group.sellerName || 'This seller'} does not deliver to PIN code ${pincode}. Remove the item or change your delivery address.`,
      });
    }

    const delivery = round2(parcelFee.plus(heavyFee).plus(surcharge));

    for (const line of group.items) issues.push(...validateLine(line, reservedByListing));

    shipments.push({
      sellerId: group.sellerId,
      sellerName: group.sellerName,
      itemCount: group.items.length,
      unitCount: group.items.reduce((s, i) => s + i.quantity, 0),
      goodsSubtotal: goods.toFixed(2),
      deliveryFee: delivery.toFixed(2),
      freeDeliveryApplied: freeApplies && hasParcel,
      // How much more this shipment needs for free delivery. Real arithmetic on a
      // real threshold — not a countdown or a manufactured urgency prompt.
      freeDeliveryShortfall: cfg.freeAbove.gt(0) && !freeApplies ? round2(cfg.freeAbove.minus(goods)).toFixed(2) : null,
      serviceable: svc ? svc.serviceable : null,
      etaMinDays: svc?.etaMinDays ?? null,
      etaMaxDays: svc?.etaMaxDays ?? null,
      codAvailable: svc ? svc.codAvailable : true,
      pickupAvailable: svc ? svc.pickupAvailable : false,
      items: group.items.map((i) => ({
        cartItemId: i.cartItemId,
        listingId: i.listingId,
        productId: i.productId,
        variantId: i.variantId,
        name: i.name,
        nameMr: i.nameMr,
        image: i.image,
        brand: i.brand,
        unit: i.unit,
        packSize: i.packSize,
        shippingClass: i.shippingClass,
        quantity: i.quantity,
        unitPrice: i.unitPrice.toFixed(2),
        mrp: i.mrp ? i.mrp.toFixed(2) : null,
        lineTotal: i.lineTotal.toFixed(2),
        taxRatePct: i.taxRatePct.toNumber(),
        taxAmount: i.taxAmount.toFixed(2),
        returnEligible: i.returnEligible,
        returnWindowDays: i.returnWindowDays,
        stockAvailable: i.stockAvailable,
        minOrderQty: i.minOrderQty,
      })),
    });
  }

  const subtotal = round2(sumD(shipments, (s) => s.goodsSubtotal));
  const shipmentDelivery = round2(sumD(shipments, (s) => s.deliveryFee));
  const codFee = paymentMethod === 'cod' ? cfg.codFee : D(0);
  const deliveryFee = round2(shipmentDelivery.plus(codFee));
  const taxAmount = round2(sumD(lines, (l) => l.taxAmount));
  const taxAddedToTotal = round2(sumD(lines, (l) => l.taxAddedToTotal));
  const discountAmount = D(0); // coupons are not implemented; the slot is here so the total is complete

  const total = round2(subtotal.plus(deliveryFee).plus(taxAddedToTotal).minus(discountAmount));

  // ETA across the order is the SLOWEST shipment: an order is not "delivered"
  // until every part of it is, and promising the fastest leg is a promise the
  // platform cannot keep.
  const etaMax = shipments.reduce((m, s) => (s.etaMaxDays != null && s.etaMaxDays > m ? s.etaMaxDays : m), 0);
  const etaMin = shipments.reduce((m, s) => (s.etaMinDays != null && (m === null || s.etaMinDays > m) ? s.etaMinDays : m), null);

  if (shipments.length > 1) {
    warnings.push({
      code: 'MULTIPLE_SHIPMENTS',
      message: `Your order will arrive in ${shipments.length} separate deliveries, one from each seller.`,
    });
  }

  const quote = {
    currency: 'INR',
    shipments,
    subtotal: subtotal.toFixed(2),
    deliveryFee: deliveryFee.toFixed(2),
    shipmentDeliveryFee: shipmentDelivery.toFixed(2),
    codFee: codFee.toFixed(2),
    taxAmount: taxAmount.toFixed(2),
    taxIncludedInPrice: cfg.pricesIncludeTax,
    discountAmount: discountAmount.toFixed(2),
    total: total.toFixed(2),
    totalPaise: toMinorUnits(total),
    itemCount: lines.length,
    unitCount: lines.reduce((s, l) => s + l.quantity, 0),
    shipmentCount: shipments.length,
    promisedEtaMinDays: etaMin,
    promisedEtaMaxDays: etaMax || null,
    paymentMethod,
    deliveryPincode: pincode,
    issues,
    warnings,
    pricedAt: new Date().toISOString(),
  };
  quote.fingerprint = quoteFingerprint({ ...quote, total });
  return quote;
}

/** True when nothing blocks checkout. PRICE_CHANGED blocks — the buyer re-approves. */
export function isQuoteCheckoutable(quote) {
  return !quote.issues?.length;
}

/**
 * Everything the order writer needs, derived from the quote rather than
 * recomputed — so the row that is written is provably the row that was quoted.
 */
export function orderTotalsFromQuote(quote) {
  return {
    totalAmount: quote.total,
    subtotal: quote.subtotal,
    deliveryFee: quote.deliveryFee,
    taxAmount: quote.taxAmount,
    discountAmount: quote.discountAmount,
    promisedEtaDays: quote.promisedEtaMaxDays ?? null,
    deliveryPincode: quote.deliveryPincode ?? null,
    pricingSnapshot: {
      version: 1,
      pricedAt: quote.pricedAt,
      fingerprint: quote.fingerprint,
      taxIncludedInPrice: quote.taxIncludedInPrice,
      codFee: quote.codFee,
      shipmentDeliveryFee: quote.shipmentDeliveryFee,
      shipments: quote.shipments.map((s) => ({
        sellerId: s.sellerId,
        goodsSubtotal: s.goodsSubtotal,
        deliveryFee: s.deliveryFee,
        freeDeliveryApplied: s.freeDeliveryApplied,
        etaMinDays: s.etaMinDays,
        etaMaxDays: s.etaMaxDays,
      })),
    },
  };
}

/** Per-line tax + snapshot fields, keyed by cart item id, for the order writer. */
export function orderItemExtrasFromQuote(quote) {
  const map = new Map();
  for (const s of quote.shipments) {
    for (const i of s.items) {
      map.set(i.cartItemId, {
        productName: i.name,
        productNameMr: i.nameMr,
        productImage: i.image,
        brand: i.brand,
        unit: i.unit,
        packSize: i.packSize,
        sellerName: s.sellerName,
        taxRatePct: i.taxRatePct,
        taxAmount: i.taxAmount,
        returnEligible: i.returnEligible,
        returnWindowDays: i.returnWindowDays,
      });
    }
  }
  return map;
}
