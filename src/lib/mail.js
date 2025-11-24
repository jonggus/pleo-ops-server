// src/lib/mail.js
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendEstimateMail(to, subject, html) {
  if (!to) {
    console.warn("[mail] sendEstimateMail called without 'to'");
    return { ok: false, reason: "no_to" };
  }

  const toList = to.split(",").map(v => v.trim()).filter(Boolean);

  try {
    const result = await resend.emails.send({
      from: "플레오 견적 <onboarding@resend.dev>",
      to: toList,
      subject,
      html,
    });

    console.log("[mail] Resend result:", result);
    return { ok: true, result };
  } catch (err) {
    console.error("[mail] Resend error:", err);
    return { ok: false, error: err?.message || err };
  }
}

