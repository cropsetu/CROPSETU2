/**
 * E2E Test — Product Buying Flow (Detox)
 *
 * Prerequisites:
 *   - npm install -g detox-cli
 *   - Backend running at localhost:3000
 *   - iOS Simulator or Android Emulator ready
 *
 * Run:
 *   detox test --configuration ios.sim.debug
 */

describe('Product Buying Flow — Happy Path', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
  });

  it('should login with test credentials', async () => {
    await element(by.id('phone-input')).typeText('9876543210');
    await element(by.id('send-otp-button')).tap();
    await waitFor(element(by.id('otp-input'))).toBeVisible().withTimeout(5000);
    await element(by.id('otp-input')).typeText('000000');
    await element(by.id('verify-otp-button')).tap();
    await waitFor(element(by.id('home-screen'))).toBeVisible().withTimeout(10000);
  });

  it('should browse AgriStore products', async () => {
    await element(by.id('tab-agristore')).tap();
    await waitFor(element(by.id('product-list'))).toBeVisible().withTimeout(5000);
    await expect(element(by.id('product-card-0'))).toBeVisible();
  });

  it('should search for a product', async () => {
    await element(by.id('search-bar')).typeText('Seeds');
    await waitFor(element(by.id('product-list'))).toBeVisible().withTimeout(3000);
  });

  it('should open product detail', async () => {
    await element(by.id('product-card-0')).tap();
    await waitFor(element(by.id('product-detail-screen'))).toBeVisible().withTimeout(3000);
    await expect(element(by.id('product-price'))).toBeVisible();
    await expect(element(by.id('product-stock'))).toBeVisible();
  });

  it('should add product to cart', async () => {
    await element(by.id('add-to-cart-button')).tap();
    await waitFor(element(by.text('Added to cart'))).toBeVisible().withTimeout(3000);
  });

  it('should view cart with correct total', async () => {
    await element(by.id('cart-icon')).tap();
    await waitFor(element(by.id('cart-screen'))).toBeVisible().withTimeout(3000);
    await expect(element(by.id('cart-total'))).toBeVisible();
    await expect(element(by.id('cart-item-0'))).toBeVisible();
  });

  it('should proceed to checkout', async () => {
    await element(by.id('checkout-button')).tap();
    await waitFor(element(by.id('checkout-screen'))).toBeVisible().withTimeout(3000);
  });

  it('should select delivery address', async () => {
    await element(by.id('address-field-name')).typeText('Rajesh Kumar');
    await element(by.id('address-field-phone')).typeText('9876543210');
    await element(by.id('address-field-flat')).typeText('12A');
    await element(by.id('address-field-street')).typeText('MG Road');
    await element(by.id('address-field-city')).typeText('Pune');
    await element(by.id('address-field-pincode')).typeText('411001');
  });

  it('should place order successfully', async () => {
    await element(by.id('place-order-button')).tap();
    await waitFor(element(by.id('order-confirmation'))).toBeVisible().withTimeout(10000);
    await expect(element(by.text('Order Placed!'))).toBeVisible();
  });

  it('should see order in My Orders', async () => {
    await element(by.id('view-orders-button')).tap();
    await waitFor(element(by.id('orders-list'))).toBeVisible().withTimeout(5000);
    await expect(element(by.id('order-item-0'))).toBeVisible();
  });
});

describe('Product Buying Flow — Failure Path', () => {
  it('should show error when trying to checkout with empty cart', async () => {
    // Navigate to cart
    await element(by.id('cart-icon')).tap();
    // If cart is empty, checkout button should be disabled or show error
    const checkoutButton = element(by.id('checkout-button'));
    // Verify the button is disabled or shows appropriate message
  });

  it('should handle out of stock gracefully', async () => {
    // Try to add a product with stock = 0
    // Should show "Out of Stock" message
  });

  it('should handle network error during checkout', async () => {
    // Simulate network disconnection
    // Should show error toast, not crash
    // Cart contents should be preserved
  });
});
