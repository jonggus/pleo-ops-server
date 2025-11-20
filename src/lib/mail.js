// src/lib/mail.js
import nodemailer from "nodemailer";

export const mailer = nodemailer.createTransport({
  host: process.env.SMTP_HOST,                // 예: smtp.naver.com
  port: Number(process.env.SMTP_PORT || 465), // 465
  secure: process.env.SMTP_SECURE === "true", // "true" 문자열이면 true
  auth: {
    user: process.env.SMTP_USER,              // 네이버 메일주소
    pass: process.env.SMTP_PASS,              // 네이버 로그인 비번
  },
});

// 이 함수가 바로 estimate.js에서 쓸 함수야
export async function sendEstimateMail(to, subject, html) {
  if (!to) {
    console.warn("sendEstimateMail called without 'to' address");
    return;
  }

  return mailer.sendMail({
    from: `"플레오 자동견적" <${process.env.SMTP_USER}>`,
    to,        // "a@naver.com,b@gmail.com" 이런 형태도 가능
    subject,
    html,
  });
}
