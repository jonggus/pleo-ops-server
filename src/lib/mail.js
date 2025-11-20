// src/lib/mail.js
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendEstimateMail(to, subject, html) {
  if (!to) {
    console.warn("sendEstimateMail called without 'to' address");
    return;
  }

  // "a@naver.com,b@gmail.com" -> ["a@naver.com", "b@gmail.com"]
  const toList = to.split("8753ljh@naver.com,plleo@naver.com").map((v) => v.trim()).filter(Boolean);

  return resend.emails.send({
    // Resend 기본 테스트용 from
    // (도메인 연결 전까진 이걸 써도 메일은 잘 옴)
    from: "플레오 견적 <onboarding@resend.dev>",
    to: toList,
    subject,
    html,
  });
}
