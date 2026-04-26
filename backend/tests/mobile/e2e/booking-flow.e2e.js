/**
 * E2E Test — Instrument Booking Flow (Detox)
 */

describe('Instrument Booking Flow — Happy Path', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
    // Login
    await element(by.id('phone-input')).typeText('9876543210');
    await element(by.id('send-otp-button')).tap();
    await waitFor(element(by.id('otp-input'))).toBeVisible().withTimeout(5000);
    await element(by.id('otp-input')).typeText('000000');
    await element(by.id('verify-otp-button')).tap();
    await waitFor(element(by.id('home-screen'))).toBeVisible().withTimeout(10000);
  });

  it('should navigate to Rent marketplace', async () => {
    await element(by.id('tab-rent')).tap();
    await waitFor(element(by.id('rent-home'))).toBeVisible().withTimeout(5000);
  });

  it('should browse machinery listings', async () => {
    await expect(element(by.id('machinery-list'))).toBeVisible();
    await expect(element(by.id('machinery-card-0'))).toBeVisible();
  });

  it('should filter by category', async () => {
    await element(by.id('category-tractor')).tap();
    await waitFor(element(by.id('machinery-list'))).toBeVisible().withTimeout(3000);
  });

  it('should open machinery detail', async () => {
    await element(by.id('machinery-card-0')).tap();
    await waitFor(element(by.id('machinery-detail'))).toBeVisible().withTimeout(3000);
    await expect(element(by.id('price-per-day'))).toBeVisible();
    await expect(element(by.id('availability-calendar'))).toBeVisible();
  });

  it('should select available dates', async () => {
    // Tap a future date that's not booked
    await element(by.id('calendar-day-15')).tap(); // Start date
    await element(by.id('calendar-day-17')).tap(); // End date
    await expect(element(by.id('selected-range'))).toBeVisible();
    await expect(element(by.id('total-cost'))).toBeVisible();
  });

  it('should submit booking request', async () => {
    await element(by.id('book-now-button')).tap();
    await waitFor(element(by.text('Booking Requested'))).toBeVisible().withTimeout(5000);
  });

  it('should see booking in My Bookings', async () => {
    await element(by.id('back-button')).tap();
    await element(by.id('bookings-tab')).tap();
    await waitFor(element(by.id('booking-item-0'))).toBeVisible().withTimeout(5000);
    await expect(element(by.text('PENDING'))).toBeVisible();
  });
});

describe('Instrument Booking Flow — Failure Path', () => {
  it('should show conflict error when dates are booked', async () => {
    // Attempt to book already booked dates
    // Should show 409 conflict error message
  });

  it('should prevent selecting past dates', async () => {
    // Past dates should be greyed out and non-tappable
  });

  it('should handle booking rejection by owner', async () => {
    // After owner rejects, booking status should update to CANCELLED
    // Notification should be received
  });
});
