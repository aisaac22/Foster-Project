import Link from "next/link";
import { ClerkProvider, UserButton } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { isAdmin } from "@/lib/require-user";
import "./globals.css";

export const metadata = {
  title: "Foster Care Dashboard",
  description: "Placement analytics for recruitment and retention",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId } = await auth();
  const admin = userId ? await isAdmin() : false;

  return (
    <ClerkProvider afterSignOutUrl="/sign-in">
      <html lang="en">
        <body>
          <header className="site-header">
            <span className="wordmark">Foster Care Dashboard</span>
            <nav>
              {userId && <Link href="/dashboard">Dashboard</Link>}
              {admin && <Link href="/admin/cases">Admin</Link>}
              <Link href="/homes">All homes</Link>
              <Link href="/at-risk">At-risk homes</Link>
              <Link href="/counties">Counties</Link>
              <Link href="/recruitment">Recruitment</Link>
              {userId && <UserButton />}
            </nav>
          </header>
          <main className="site-main">{children}</main>
        </body>
      </html>
    </ClerkProvider>
  );
}