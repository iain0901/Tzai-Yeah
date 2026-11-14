import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionUser, safeReturnPath } from "@/lib/server/auth";

export async function getCurrentUser() {
  return getSessionUser(await headers());
}

export async function requireCurrentUser(returnTo = "/") {
  const user = await getCurrentUser();
  if (user) return user;
  redirect(`/login?return_to=${encodeURIComponent(safeReturnPath(returnTo))}`);
}
