// src/lib/kakaoAdminMemo.js
import axios from "axios";
import AdminToken from "../models/AdminToken.js";

const REST_API_KEY = process.env.KAKAO_REST_API_KEY;
const CLIENT_SECRET = process.env.KAKAO_CLIENT_SECRET || "";

const TOKEN_URL =
  process.env.KAKAO_TOKEN_ENDPOINT || "https://kauth.kakao.com/oauth/token";
const SEND_URL =
  process.env.KAKAO_MEMO_SEND_ENDPOINT ||
  "https://kapi.kakao.com/v2/api/talk/memo/default/send";

/**
 * REFRESH_TOKEN → ACCESS_TOKEN 재발급
 */
async function getAccessToken(refreshToken) {
  const params = new URLSearchParams();
  params.append("grant_type", "refresh_token");
  params.append("client_id", REST_API_KEY);
  if (CLIENT_SECRET) params.append("client_secret", CLIENT_SECRET);
  params.append("refresh_token", refreshToken);

  const res = await axios.post(TOKEN_URL, params, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  if (!res.data.access_token) {
    throw new Error("카카오 ACCESS TOKEN 발급 실패");
  }

  return res.data.access_token;
}

/**
 * 카카오톡 나에게 보내기
 */
async function sendKakaoMemo(accessToken, messageObject) {
  const params = new URLSearchParams();
  params.append("template_object", JSON.stringify(messageObject));

  const res = await axios.post(SEND_URL, params, {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Bearer ${accessToken}`,
    },
  });

  return res.data;
}

/**
 * 메시지 템플릿 생성
 */
function buildMessageTemplate(estimate) {
  const totalFee = estimate.fees?.totalFee || 0;
  const workQty = estimate.workQty || 0;
  const cartonQty = estimate.cartonQty || 0;
  const totalWeightKg = estimate.totalWeightKg || 0;

  return {
    object_type: "text",
    text: [
      "[플레오 AI 견적 도착]",
      "",
      `고객명: ${estimate.contact?.name || "-"}`,
      `연락처: ${estimate.contact?.phone || "-"}`,
      `이메일: ${estimate.contact?.email || "-"}`,
      "",
      `작업 위치: ${estimate.workLocation || "-"}`,
      `작업 방식: ${estimate.workMethod || "-"}`,
      `제품 종류: ${estimate.productType || "-"}`,
      "",
      `작업 수량: ${workQty.toLocaleString()} EA`,
      `카톤 수량: ${cartonQty.toLocaleString()} CTN`,
      `총 중량: ${totalWeightKg.toLocaleString()} kg`,
      "",
      `예상 견적: ${totalFee.toLocaleString()}원 (부가세 별도)`,
      `예상 소요일: 약 ${estimate.leadTimeDays || "-"}일`,
      "",
      "※ 실제 금액은 담당자 확인 후 최종 확정됩니다.",
    ].join("\n"),
    link: {
      web_url: "https://xn--on3b27gxrdt6b.com",
      mobile_web_url: "https://xn--on3b27gxrdt6b.com",
    },
    button_title: "플레오 사이트 열기",
  };
}

/**
 * 메인: 관리자 모두에게 카카오톡 발송
 */
export async function sendKakaoAdminMemo(estimate) {
  try {
    const admins = await AdminToken.find({});
    if (!admins.length) {
      console.warn("[KAKAO MEMO] 저장된 관리자 토큰이 없습니다.");
      return;
    }

    const template = buildMessageTemplate(estimate);

    await Promise.all(
      admins.map(async (admin, idx) => {
        try {
          const accessToken = await getAccessToken(admin.refreshToken);
          await sendKakaoMemo(accessToken, template);
          console.log(
            `[KAKAO MEMO] 관리자 ${admin.role || idx + 1} 전송 완료`
          );
        } catch (err) {
          console.error(
            `[KAKAO MEMO] 관리자 ${admin.role || idx + 1} 오류:`,
            err.response?.data || err.message
          );
        }
      })
    );
  } catch (err) {
    console.error("sendKakaoAdminMemo 전체 오류:", err.message);
  }
}
