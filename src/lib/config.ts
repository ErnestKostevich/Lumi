/**
 * Build-time configuration constants. Read from Vite env (only VITE_* is
 * exposed to the browser — everything else lives server-side in the worker).
 *
 * To activate payments:
 *   1. Deploy cloudflare-worker/ (see its README) → get worker URL
 *   2. Put it in .env.local as VITE_PAY_WORKER_URL=https://lumi-pay.<acct>.workers.dev
 *   3. Restart `pnpm tauri dev` so Vite picks up the new env
 *
 * If VITE_PAY_WORKER_URL is empty, the Upgrade button falls back to opening
 * NOWPayments static Payment Links (set their iids below in `staticInvoices`).
 */

export const BRAND = {
  name: "Lumi",
  tagline: "Anime Study Buddy",
  domain: "lumi.app",
  supportEmail: "hi@lumi.app",
};

const WORKER_URL = import.meta.env.VITE_PAY_WORKER_URL || "";

export const PAYMENTS = {
  /** When set, frontend hits `${WORKER_URL}/checkout?plan=...` (preferred). */
  workerUrl: WORKER_URL,
  /** Fallback: static Payment Link iids (NOWPayments dashboard → Payment Links). */
  staticInvoices: {
    pro: import.meta.env.VITE_NOWPAYMENTS_PRO_INVOICE_ID || "",
    dlc: import.meta.env.VITE_NOWPAYMENTS_DLC_INVOICE_ID || "",
  },
};

/** Build the URL the user should navigate to for a Pro upgrade. */
export function checkoutUrl(plan: "pro" | "dlc", opts: { email?: string; product?: string } = {}): string {
  if (PAYMENTS.workerUrl) {
    // Vercel Edge Functions live at /api/<name>, not /<name>.
    const u = new URL(`${PAYMENTS.workerUrl.replace(/\/$/, "")}/api/checkout`);
    u.searchParams.set("plan", plan);
    if (opts.email) u.searchParams.set("email", opts.email);
    if (opts.product) u.searchParams.set("product", opts.product);
    return u.toString();
  }
  // Fallback to static Payment Link
  const iid = plan === "pro" ? PAYMENTS.staticInvoices.pro : PAYMENTS.staticInvoices.dlc;
  if (!iid) {
    // Last-resort: open the landing pricing section so user can click manually
    return "https://lumi-bloom0.vercel.app/#pricing";
  }
  const u = new URL("https://nowpayments.io/payment/");
  u.searchParams.set("iid", iid);
  return u.toString();
}

/** Base URL for the Vercel API. Falls back to prod when env isn't set. */
const API_BASE = (PAYMENTS.workerUrl || "https://lumi-bloom0.vercel.app").replace(/\/$/, "");

/** Calls the /api/verify-license endpoint (Vercel Edge Function). */
export async function verifyLicenseRemote(key: string): Promise<{
  valid: boolean;
  plan?: "pro" | "dlc";
  expiresAt?: number;
  email?: string;
}> {
  if (!key) return { valid: false };
  try {
    const r = await fetch(
      `${API_BASE}/api/verify-license?key=${encodeURIComponent(key)}`,
    );
    if (!r.ok) return { valid: false };
    return await r.json();
  } catch {
    // Network failure — caller applies offline grace from cached state.
    return { valid: false };
  }
}

/** Calls /api/recover-license to re-send the license email to a buyer. */
export async function recoverLicenseByEmail(email: string): Promise<{
  ok: boolean;
  sent?: boolean;
  reason?: string;
}> {
  if (!email) return { ok: false, reason: "no email" };
  try {
    const r = await fetch(
      `${API_BASE}/api/recover-license?email=${encodeURIComponent(email)}`,
    );
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, reason: data?.reason || `HTTP ${r.status}` };
    return { ok: true, sent: !!data?.sent };
  } catch {
    return { ok: false, reason: "network" };
  }
}

// Legacy export kept so old imports don't break — points to checkoutUrl now.
export const NOWPAYMENTS = {
  baseUrl: "https://nowpayments.io/payment/",
  proInvoiceId: PAYMENTS.staticInvoices.pro,
  dlcInvoiceId: PAYMENTS.staticInvoices.dlc,
};
export function nowPaymentsUrl(_invoiceId: string, _orderId?: string): string {
  return checkoutUrl("pro");
}
