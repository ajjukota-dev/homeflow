import { randomUUID } from "node:crypto";
import { query } from "../db";
import { hashPassword } from "../auth/password";

// Demo accounts (01-identity-access.md "Demo accounts"). One per PDF §13 role
// at <role>@demo.pranava, password Demo@2026 for all, plus a booking-bound
// customer login. Also documented in docs/demo/click-path.md "## Logins".
export const DEMO_PASSWORD = "Demo@2026";
const PROJECT_ID = "p_eastcrest"; // seed.ts's East Crest project — demo config only

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

async function ensureTeam(department: string): Promise<string> {
  const id = `team_${department.toLowerCase()}`;
  await query(`INSERT INTO team (id, name, department, project_id) VALUES ($1,$2,$3,$4)`, [
    id,
    `${department} team`,
    department,
    PROJECT_ID,
  ]);
  return id;
}

export async function seedUsers(): Promise<void> {
  const existing = await query<{ count: string }>(`SELECT count(*)::text FROM "user"`);
  if (Number(existing.rows[0]?.count ?? 0) > 0) return; // idempotent, mirrors seed/permissions.ts

  const passwordHash = await hashPassword(DEMO_PASSWORD);

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

  await query(
    `INSERT INTO "user" (id, email, display_name, password_hash, status, kind, default_project_id) VALUES ($1,$2,$3,$4,'ACTIVE','CUSTOMER',$5)`,
    ["user_customer_demo", "customer@demo.pranava", "Ananya Rao", passwordHash, PROJECT_ID]
  );
  await query(`INSERT INTO user_role (user_id, role_code) VALUES ($1,'CUSTOMER')`, ["user_customer_demo"]);
  await query(`INSERT INTO customer_login (user_id, customer_id, booking_id) VALUES ($1,'c_ananya','b_v112')`, [
    "user_customer_demo",
  ]);
}
