import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { runSegmentationForBusiness } from "../lib/run-segmentation";

const prisma = new PrismaClient();

// Demo data for a salon and a clinic so the dashboard is meaningful before
// any real WhatsApp traffic arrives. Run with `npm run db:seed`.
async function main() {
  // Demo logins with a published password must never land in a live database (H2).
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_SEED !== "true") {
    throw new Error("Refusing to seed demo accounts in production (set ALLOW_SEED=true only on a throwaway database).");
  }
  const passwordHash = await bcrypt.hash("password123", 10);

  const salonOwner = await prisma.user.upsert({
    where: { email: "owner@glow-salon.demo" },
    update: {},
    create: {
      name: "Priya Sharma",
      email: "owner@glow-salon.demo",
      passwordHash,
      businesses: {
        create: {
          name: "Glow Salon & Spa",
          sector: "SALON",
          locations: { create: { name: "Glow Salon & Spa" } },
        },
      },
    },
    include: { businesses: { include: { locations: true } } },
  });

  const clinicOwner = await prisma.user.upsert({
    where: { email: "owner@wellness-clinic.demo" },
    update: {},
    create: {
      name: "Dr. Arjun Mehta",
      email: "owner@wellness-clinic.demo",
      passwordHash,
      businesses: {
        create: {
          name: "Wellness Family Clinic",
          sector: "CLINIC",
          locations: { create: { name: "Wellness Family Clinic" } },
        },
      },
    },
    include: { businesses: { include: { locations: true } } },
  });

  const salon = salonOwner.businesses[0];
  const clinic = clinicOwner.businesses[0];
  const salonLocation = salon.locations[0];
  const clinicLocation = clinic.locations[0];

  const now = Date.now();
  const daysAgo = (n: number) => new Date(now - n * 24 * 60 * 60 * 1000);

  const demoCustomers = [
    // salon
    { businessId: salon.id, locationId: salonLocation.id, phone: "919810000001", name: "Anjali Verma", visitCount: 8, totalSpend: 12000, lastSeenAt: daysAgo(5) },
    { businessId: salon.id, locationId: salonLocation.id, phone: "919810000002", name: "Rohit Kapoor", visitCount: 5, totalSpend: 4200, lastSeenAt: daysAgo(45) },
    { businessId: salon.id, locationId: salonLocation.id, phone: "919810000003", name: "Sneha Iyer", visitCount: 12, totalSpend: 18000, lastSeenAt: daysAgo(80) },
    { businessId: salon.id, locationId: salonLocation.id, phone: "919810000004", name: "Karan Malhotra", visitCount: 1, totalSpend: 800, lastSeenAt: daysAgo(2) },
    // clinic
    { businessId: clinic.id, locationId: clinicLocation.id, phone: "919820000001", name: "Meena Joshi", visitCount: 6, totalSpend: 9000, lastSeenAt: daysAgo(10) },
    { businessId: clinic.id, locationId: clinicLocation.id, phone: "919820000002", name: "Vikram Rao", visitCount: 4, totalSpend: 3000, lastSeenAt: daysAgo(35) },
    { businessId: clinic.id, locationId: clinicLocation.id, phone: "919820000003", name: "Divya Nair", visitCount: 9, totalSpend: 15000, lastSeenAt: daysAgo(70) },
    { businessId: clinic.id, locationId: clinicLocation.id, phone: "919820000004", name: "Aditya Kumar", visitCount: 1, totalSpend: 500, lastSeenAt: daysAgo(1) },
  ];

  for (const c of demoCustomers) {
    await prisma.customer.upsert({
      where: { locationId_phone: { locationId: c.locationId, phone: c.phone } },
      update: c,
      create: { ...c, firstSeenAt: daysAgo(c.visitCount * 20) },
    });
  }

  await runSegmentationForBusiness(salon.id);
  await runSegmentationForBusiness(clinic.id);

  // ── Restaurant Bundle demo (Nov 2026): a bubble tea / dessert café ──────
  // Made-up brand (the login is public): bills with amounts, ratings from the
  // feedback loop (one low rating the owner was alerted about) and birthdays.
  const cafeOwner = await prisma.user.upsert({
    where: { email: "owner@bobabay-cafe.demo" },
    update: {},
    create: {
      name: "Harleen Kaur",
      email: "owner@bobabay-cafe.demo",
      passwordHash,
      businesses: {
        create: {
          name: "Boba Bay Café",
          sector: "RESTAURANT",
          country: "IN",
          autoFeedback: true,
          autoBirthday: true,
          birthdayOfferText: "a free brownie sundae with any order on your birthday week",
          locations: {
            create: {
              name: "Boba Bay Café, Sarabha Nagar",
              googleReviewUrl: "https://g.page/r/boba-bay-cafe-demo/review",
              zomatoUrl: "https://www.zomato.com/ludhiana/boba-bay-cafe-demo",
            },
          },
        },
      },
    },
    include: { businesses: { include: { locations: true } } },
  });
  const cafe = cafeOwner.businesses[0];
  const cafeLocation = cafe.locations[0];
  const hoursAgo = (n: number) => new Date(now - n * 60 * 60 * 1000);
  const cafeCustomers: { phone: string; name: string; birthday?: string; bills: { at: Date; amount: number; rating?: number }[] }[] = [
    { phone: "919830000001", name: "Simran Gill", birthday: "12-02", bills: [{ at: daysAgo(40), amount: 420, rating: 5 }, { at: daysAgo(55), amount: 380 }, { at: daysAgo(70), amount: 510 }] },
    { phone: "919830000002", name: "Arjun Bedi", bills: [{ at: daysAgo(2), amount: 650, rating: 5 }, { at: daysAgo(9), amount: 300 }, { at: daysAgo(16), amount: 480, rating: 4 }, { at: daysAgo(23), amount: 520 }] },
    { phone: "919830000003", name: "Navneet Sandhu", birthday: "07-19", bills: [{ at: daysAgo(1), amount: 260, rating: 2 }] },
    { phone: "919830000004", name: "Kavya Arora", bills: [{ at: hoursAgo(2), amount: 340 }] },
    { phone: "919830000005", name: "Ishaan Malhi", birthday: "03-08", bills: [{ at: daysAgo(6), amount: 1250, rating: 5 }, { at: daysAgo(13), amount: 980 }, { at: daysAgo(20), amount: 1100 }, { at: daysAgo(27), amount: 1320 }, { at: daysAgo(34), amount: 890 }] },
    { phone: "919830000006", name: "Tanya Chopra", bills: [{ at: daysAgo(95), amount: 220 }, { at: daysAgo(120), amount: 310 }] },
  ];
  for (const c of cafeCustomers) {
    const sorted = [...c.bills].sort((a, b) => a.at.getTime() - b.at.getTime());
    const data = {
      businessId: cafe.id, locationId: cafeLocation.id, phone: c.phone, name: c.name, birthday: c.birthday ?? null,
      visitCount: c.bills.length, totalSpend: c.bills.reduce((t, b) => t + b.amount, 0),
      firstSeenAt: sorted[0].at, lastSeenAt: sorted[sorted.length - 1].at, consentStatus: "GRANTED", consentSource: "QR",
    };
    const customer = await prisma.customer.upsert({ where: { locationId_phone: { locationId: cafeLocation.id, phone: c.phone } }, update: data, create: data });
    for (const [i, b] of c.bills.entries()) {
      const asked = b.rating != null ? new Date(b.at.getTime() + 90 * 60 * 1000) : null;
      await prisma.visit.upsert({
        where: { businessId_externalId: { businessId: cafe.id, externalId: `demo-${c.phone}-${i}` } },
        update: {},
        create: {
          businessId: cafe.id, locationId: cafeLocation.id, customerId: customer.id, amount: b.amount, occurredAt: b.at,
          source: "pos:demo", externalId: `demo-${c.phone}-${i}`,
          feedbackRequestedAt: asked, rating: b.rating ?? null, ratedAt: asked ? new Date(asked.getTime() + 20 * 60 * 1000) : null,
        },
      });
    }
  }
  await runSegmentationForBusiness(cafe.id);

  await prisma.user.upsert({
    where: { email: "admin@regulars.demo" },
    update: { role: "SUPER_ADMIN" },
    create: {
      name: "Loopdesk Admin",
      email: "admin@regulars.demo",
      passwordHash,
      role: "SUPER_ADMIN",
    },
  });

  console.log("Seeded demo data:");
  console.log("  Salon login: owner@glow-salon.demo / password123");
  console.log("  Clinic login: owner@wellness-clinic.demo / password123");
  console.log("  Restaurant login: owner@bobabay-cafe.demo / password123");
  console.log("  Super admin login: admin@regulars.demo / password123 (/admin)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
