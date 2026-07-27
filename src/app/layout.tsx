import Link from "next/link";
import { ClerkProvider, UserButton } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { isAdmin } from "@/lib/require-user";
import { NavDropdown } from "@/components/NavDropdown";
import { CsvUploadButton } from "@/components/CsvUploadButton";
import "./globals.css";

export const metadata = {
  title: "Foster Insights",
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
            <span className="wordmark">
              <img src="/fosterInsightImg.jpg" alt="" className="wordmark-logo" />
              Foster Insights
            </span>
            <nav>
              {userId && <Link href="/dashboard">Dashboard</Link>}
              <NavDropdown
                label="Analytics"
                items={[
                  { href: "/at-risk", label: "At-risk homes" },
                  { href: "/recruitment", label: "Recruitment" },
                  { href: "/trend", label: "Trend" },
                  { href: "/data-dictionary", label: "Data dictionary" },
                ]}
              />
              <Link href="/counties">Counties</Link>
              <Link href="/homes">All homes</Link>
              {userId && <UserButton />}
            </nav>
          </header>
          <main className="site-main">{children}</main>
          {admin && <CsvUploadButton />}
        </body>
      </html>
    </ClerkProvider>
  );
}