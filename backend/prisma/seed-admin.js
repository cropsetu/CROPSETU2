/**
 * Seed / promote an ADMIN user for the admin panel.
 *
 *   node prisma/seed-admin.js <phone>
 *
 * Creates the user if the phone is new, or flips an existing user to ADMIN.
 * Login is still phone-OTP — this only grants the ADMIN role. The phone must be
 * the 10-digit form the OTP flow normalises to (e.g. 9876543210).
 */
import prisma from '../src/config/db.js';

async function main() {
  const phone = (process.argv[2] || '').replace(/\D/g, '').slice(-10);
  if (phone.length !== 10) {
    console.error('Usage: node prisma/seed-admin.js <10-digit-phone>');
    process.exit(1);
  }

  const existing = await prisma.user.findUnique({ where: { phone } });
  if (existing) {
    const updated = await prisma.user.update({
      where: { phone },
      data: { role: 'ADMIN', isActive: true },
      select: { id: true, phone: true, role: true },
    });
    console.log('Promoted existing user to ADMIN:', updated);
  } else {
    const created = await prisma.user.create({
      data: { phone, name: 'Administrator', role: 'ADMIN', isActive: true },
      select: { id: true, phone: true, role: true },
    });
    console.log('Created ADMIN user:', created);
  }
  console.log('Sign in at the admin app with phone', phone, 'using the OTP flow.');
}

main()
  .catch((err) => { console.error('seed-admin failed:', err); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
