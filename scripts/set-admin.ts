/**
 * Grants or revokes the admin role for a Clerk user, identified by email,
 * username, or raw Clerk user ID (whichever the account actually has — not
 * every account is required to have an email). The role lives in Clerk's
 * privateMetadata (server-only, never sent to the browser) — see
 * isAdmin()/requireAdmin() in src/lib/require-user.ts.
 *
 * Usage (PowerShell):
 *   npx tsx scripts/set-admin.ts someone@example.com admin
 *   npx tsx scripts/set-admin.ts someusername admin
 *   npx tsx scripts/set-admin.ts user_2abc123XYZ admin
 *   npx tsx scripts/set-admin.ts someusername user      (revoke)
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { clerkClient } from "@clerk/nextjs/server";
import type { User } from "@clerk/nextjs/server";

const identifier = process.argv[2];
const role = process.argv[3];

if (!identifier || (role !== "admin" && role !== "user")) {
  console.error("Usage: npx tsx scripts/set-admin.ts <email|username|user_id> <admin|user>");
  process.exit(1);
}

const client = await clerkClient();

async function findUser(): Promise<User | undefined> {
  if (identifier.startsWith("user_")) {
    return client.users.getUser(identifier).catch(() => undefined);
  }
  const byEmail = await client.users.getUserList({ emailAddress: [identifier] });
  if (byEmail.data[0]) return byEmail.data[0];
  const byUsername = await client.users.getUserList({ username: [identifier] });
  return byUsername.data[0];
}

const user = await findUser();
if (!user) {
  console.error(`No Clerk user found matching "${identifier}" (tried email, username, and user ID).`);
  process.exit(1);
}

await client.users.updateUserMetadata(user.id, {
  privateMetadata: { role: role === "admin" ? "admin" : null },
});

const label = user.username ?? user.emailAddresses[0]?.emailAddress ?? user.id;
console.log(`${label} (${user.id}) is now ${role === "admin" ? "an admin" : "a regular user"}.`);
