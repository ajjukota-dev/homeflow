import { randomUUID } from "node:crypto";
import { query } from "../db";
import { hashPassword } from "../auth/password";

// Demo accounts (01-identity-access.md "Demo accounts"). One per PDF §13 role
// at <role>@demo.pranava, password Demo@2026 for all, plus booking-bound
// customer logins. Also documented in docs/demo/click-path.md "## Logins".
export const DEMO_PASSWORD = "Demo@2026";
export const PROJECT_ID = "p_eastcrest"; // seed.ts's East Crest project — demo config only

let demoHashPromise: Promise<string> | null = null;
function demoPasswordHash(): Promise<string> {
  if (!demoHashPromise) demoHashPromise = hashPassword(DEMO_PASSWORD);
  return demoHashPromise;
}

const STAFF: { slug: string; role: string; name: string; department: string | null }[] = [
  { slug: "management", role: "MANAGEMENT", name: "Meera Iyer", department: "MANAGEMENT" },
  { slug: "crm", role: "CRM", name: "Priya Nair", department: "CRM" },
  { slug: "accounts", role: "ACCOUNTS", name: "Arjun Menon", department: "ACCOUNTS" },
  { slug: "sales", role: "SALES", name: "Kabir Shah", department: "SALES" },
  { slug: "legal", role: "LEGAL", name: "Divya Krishnan", department: "LEGAL" },
  { slug: "registration", role: "REGISTRATION", name: "Farhan Ali", department: "REGISTRATION" },
  { slug: "site", role: "SITE", name: "Ravi Kumar", department: "PROJECTS" },
  { slug: "qa", role: "QA", name: "Sneha Reddy", department: "QA" },
  { slug: "customisation", role: "CUSTOMISATION", name: "Nikhil Bose", department: "CUSTOMISATION" },
  { slug: "fm", role: "FM", name: "Lakshmi Pillai", department: "FACILITY" },
  { slug: "banking", role: "BANKING", name: "Vikram Rao", department: "BANKING" },
  { slug: "superadmin", role: "SUPER_ADMIN", name: "Amarsh (Super Admin)", department: null },
];

const PORTALS: { userId: string; email: string; name: string; customerId: string; bookingId: string }[] = [
  { userId: "user_customer_demo", email: "customer@demo.pranava", name: "Ananya Rao", customerId: "c_ananya", bookingId: "b_v112" },
  { userId: "user_karthik", email: "karthik@demo.pranava", name: "Karthik Iyer", customerId: "c_karthik", bookingId: "b_v110" },
  { userId: "user_meera", email: "meera@demo.pranava", name: "Meera Krishnan", customerId: "c_meera", bookingId: "b_v111" },
  { userId: "user_rohan", email: "rohan@demo.pranava", name: "Rohan Desai", customerId: "c_rohan", bookingId: "b_v113" },
];

async function ensureTeam(department: string): Promise<string> {
  const id = `team_${department.toLowerCase()}`;
  const existing = await query<{ id: string }>(`SELECT id FROM team WHERE id = $1`, [id]);
  if (existing.rows[0]) return id;
  await query(`INSERT INTO team (id, name, department, project_id) VALUES ($1,$2,$3,$4)`, [
    id,
    `${department} team`,
    department,
    PROJECT_ID,
  ]);
  return id;
}

export async function seedStaffUsers(): Promise<void> {
  const existing = await query<{ id: string }>(`SELECT id FROM "user" WHERE id = 'user_crm'`);
  if (existing.rows[0]) return;

  const passwordHash = await demoPasswordHash();

  for (const s of STAFF) {
    const userId = `user_${s.slug}`;
    await query(
      `INSERT INTO "user" (id, email, display_name, password_hash, status, kind, default_project_id) VALUES ($1,$2,$3,$4,'ACTIVE','STAFF',$5)`,
      [userId, `${s.slug}@demo.pranava`, s.name, passwordHash, s.department ? PROJECT_ID : null]
    );
    await query(`INSERT INTO user_role (user_id, role_code) VALUES ($1,$2)`, [userId, s.role]);
    if (s.department) {
      const teamId = await ensureTeam(s.department);
      await query(
        `INSERT INTO project_team_assignment
           (id, project_id, team_id, user_id, department, role_scope, assignment_type, is_primary_owner, effective_from)
         VALUES ($1,$2,$3,$4,$5,$6,'DEDICATED', true, '2020-01-01')`,
        [randomUUID(), PROJECT_ID, teamId, userId, s.department, s.role]
      );
    }
  }
}

export async function seedCustomerLogins(): Promise<void> {
  const already = await query<{ n: number }>(`SELECT count(*)::int AS n FROM customer_login`);
  if ((already.rows[0]?.n ?? 0) >= 4) return;
  const passwordHash = await demoPasswordHash();
  for (const p of PORTALS) {
    const exists = await query<{ id: string }>(`SELECT id FROM "user" WHERE id = $1`, [p.userId]);
    if (!exists.rows[0]) {
      await query(
        `INSERT INTO "user" (id, email, display_name, password_hash, status, kind, default_project_id) VALUES ($1,$2,$3,$4,'ACTIVE','CUSTOMER',$5)`,
        [p.userId, p.email, p.name, passwordHash, PROJECT_ID]
      );
      await query(`INSERT INTO user_role (user_id, role_code) VALUES ($1,'CUSTOMER')`, [p.userId]);
    }
    const login = await query<{ user_id: string }>(`SELECT user_id FROM customer_login WHERE user_id = $1`, [p.userId]);
    if (!login.rows[0]) {
      await query(`INSERT INTO customer_login (user_id, customer_id, booking_id) VALUES ($1,$2,$3)`, [
        p.userId,
        p.customerId,
        p.bookingId,
      ]);
    }
  }
}

export async function seedUsers(): Promise<void> {
  await seedStaffUsers();
  await seedCustomerLogins();
}
