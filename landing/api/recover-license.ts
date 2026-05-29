import { sendEmail, licenseEmailHtml } from "../lib/email.js";
import { kvGet, kvSetEx } from "../lib/kv.js";

export const config = { runtime: "edge" };

/**
 * GET /api/recover-license?email=...
 *   → { ok: true, sent: boolean }
 *
 * Re-sends a buyer's license key to the email they purchased with. Looks up
 * `email:{email}` → licenseKey, then `license:{licenseKey}` → record, then
 * re-emails via Resend.
 *
 * Privacy: always returns ok:true (never reveals whether an email bought Lumi),
 * so it can't be used to enumerate customers. Rate-limited to 1 request / 60s
 * per email.
 */
export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const email = (url.searchParams.get("email") || "").trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return json({ ok: false, reason: "invalid email" }, 400);
  }

  const resendKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.LICENSE_FROM_EMAIL || "licenses@lumi.app";
  if (!resendKey) return json({ ok: false, reason: "server not configured" }, 500);

  // Rate-limit: 1 / 60s / email.
  const rlKey = `rl:recover:${email}`;
  if (await kvGet(rlKey)) {
    return json({ ok: true, sent: false, reason: "rate-limited" });
  }
  await kvSetEx(rlKey, "1", 60);

  const licenseKey = await kvGet(`email:${email}`);
  if (!licenseKey) {
    // Don't reveal that the email isn't a customer.
    return json({ ok: true, sent: false });
  }

  const recordRaw = await kvGet(`license:${licenseKey}`);
  const record = recordRaw
    ? (JSON.parse(recordRaw) as { plan?: "pro" | "dlc"; productId?: string })
    : {};
  const plan = record.plan === "dlc" ? "dlc" : "pro";

  try {
    await sendEmail({
      apiKey: resendKey,
      from: fromEmail,
      to: email,
      subject: `Your Lumi ${plan === "pro" ? "Pro" : "character"} license (recovered)`,
      html: licenseEmailHtml({ brand: "Lumi", licenseKey, plan, productId: record.productId }),
    });
  } catch (e) {
    console.error("[/api/recover-license] email failed:", e);
    return json({ ok: false, reason: "email failed" }, 502);
  }

  return json({ ok: true, sent: true });
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
