import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

/**
 * Call this at the top of every protected page.
 *
 * Middleware alone is not sufficient: CVE-2025-29927 showed that a crafted
 * request header can bypass Next.js middleware entirely. Checking the session
 * again *inside* the page — close to the data — is the defense-in-depth the
 * Next.js and Clerk teams now both recommend. It's one line per page.
 *
 * Returns the userId so a page can use it if needed.
 */
export async function requireUser(): Promise<string> {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  return userId;
}
