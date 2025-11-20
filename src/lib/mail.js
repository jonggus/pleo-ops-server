// src/routes/estimate.js 안의 메일 보내는 부분

const to =
  process.env.ESTIMATE_MAIL_TO || process.env.SMTP_USER; 
// ESTIMATE_MAIL_TO 가 없으면 최소한 SMTP_USER 로라도 받도록 fallback

try {
  console.log("📧 메일 발송 시도... to =", to);
  await sendEstimateMail(
    to,
    "📌 새로운 AI 자동 견적 요청이 도착했습니다",
    html
  );
  console.log("📧 견적 이메일 전송 완료");
} catch (emailErr) {
  console.error("📧 이메일 오류:", emailErr);
}
