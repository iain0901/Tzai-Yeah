import type { Metadata } from "next";
import AdminConsole from "@/components/admin/AdminConsole";
import "./admin.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "工作人員後台｜載耶 2026" };

export default function AdminPage() {
  return <AdminConsole />;
}
