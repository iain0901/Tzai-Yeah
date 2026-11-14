import { isIP } from "node:net";

/** Only enable TRUST_PROXY when the app is reachable exclusively through your proxy. */
export function clientAddress(request) {
  if (process.env.TRUST_PROXY !== "true") return "direct-server";
  // The trusted final proxy must overwrite X-Forwarded-For or append the actual
  // peer address. Never use a client-supplied leftmost address or CF headers.
  const address = request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim();
  return address && isIP(address) ? address : "direct-server";
}
