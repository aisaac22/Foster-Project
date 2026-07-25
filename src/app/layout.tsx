import Link from "next/link";
import { ClerkProvider, UserButton } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
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

  return (
    <ClerkProvider afterSignOutUrl="/sign-in">
      <html lang="en">
        <body>
          <header className="site-header">
            <span className="wordmark">Foster Care Dashboard</span>
            <nav>
              <Link href="/at-risk">At-risk homes</Link>
              <Link href="/counties">Counties</Link>
              {userId && <UserButton />}
            </nav>
          </header>
          <main className="site-main">{children}</main>
        </body>
      </html>
    </ClerkProvider>
  );
}