import { requireAdmin } from "@/lib/require-user";
import { AdminCaseList } from "./AdminCaseList";

export const dynamic = "force-dynamic";

export default async function AdminCasesPage({
  searchParams,
}: {
  searchParams: Promise<{ case_type?: string; status?: string; owner?: string; page?: string }>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  return <AdminCaseList searchParams={sp} />;
}
