// src/routes/adminKakao.js
import express from "express";
import axios from "axios";
import AdminToken from "../models/AdminToken.js";

const router = express.Router();

const {
  KAKAO_REST_API_KEY,
  KAKAO_CLIENT_SECRET,
  KAKAO_REDIRECT_URI,
} = process.env;

const TOKEN_URL = "https://kauth.kakao.com/oauth/token";

/**
 * 1) 관리자 로그인 시작
 * 예: /admin/kakao/auth?role=owner
 */
router.get("/auth", (req, res) => {
  const { role } = req.query;
  if (!role) return res.status(400).send("role 값 필요 (owner/boss)");

  const redirect = `https://kauth.kakao.com/oauth/authorize?response_type=code&client_id=${KAKAO_REST_API_KEY}&redirect_uri=${encodeURIComponent(
    KAKAO_REDIRECT_URI
  )}&scope=talk_message&state=${role}`;

  res.redirect(redirect);
});

/**
 * 2) 카카오 callback → Refresh Token 발급 → DB 저장
 */
router.get("/callback", async (req, res) => {
  const { code, state: role } = req.query;

  if (!code) return res.status(400).send("code 없음");
  if (!role) return res.status(400).send("role 없음");

  try {
    const params = new URLSearchParams();
    params.append("grant_type", "authorization_code");
    params.append("client_id", KAKAO_REST_API_KEY);
    if (KAKAO_CLIENT_SECRET)
      params.append("client_secret", KAKAO_CLIENT_SECRET);
    params.append("redirect_uri", KAKAO_REDIRECT_URI);
    params.append("code", code);

    const tokenRes = await axios.post(TOKEN_URL, params, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    const refreshToken = tokenRes.data.refresh_token;
    if (!refreshToken)
      return res.status(500).send("Refresh Token 발급 실패");

    // DB 저장: 이미 있으면 업데이트
    await AdminToken.findOneAndUpdate(
      { role },
      { refreshToken, updatedAt: new Date() },
      { upsert: true }
    );

    res.send(`
      <html>
      <body style="font-family:Arial; padding:40px;">
        <h2>카카오 연동 완료</h2>
        <p>역할(role): <b>${role}</b></p>
        <p>Refresh Token 저장 완료!</p>
        <p>이제 AI 견적이 들어오면 자동으로 카카오톡 알림이 전송됩니다.</p>
      </body>
      </html>
    `);
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).send("토큰 발급 오류");
  }
});

export default router;
