import type { Metadata } from "next";
import Link from "next/link";
import { safeReturnPath } from "@/lib/server/auth";
import LoginForm from "./LoginForm";
import "./login.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "小屋帳號｜載耶小屋" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ return_to?: string | string[] }> }) {
  const query = await searchParams;
  return <main className="auth-page"><div className="auth-lights" aria-hidden="true"><i /><i /><i /><i /><i /></div><Link className="auth-brand" href="/">載耶小屋 <span>2026</span></Link><section className="auth-panel"><div className="auth-mark" aria-hidden="true">✦</div><p className="auth-eyebrow">A LITTLE PLACE FOR YOU</p><LoginForm returnTo={safeReturnPath(query.return_to)} /></section><p className="auth-footer">載物書院 · 把回憶，放進口袋裡。</p></main>;
}
