// src/lib/kakaoAdminMemo.js
import axios from "axios";

/**
 * 관리자(본인 + 사장님) 두 명에게 카카오톡 "나에게 보내기" 전송
 * 
 * 전제:
 * - 관리자 2명의 REFRESH TOKEN을 환경변수에 저장
 * - 서버는 카카오 액세스 토큰을 매번 REFRESH TOKEN 기반으로 재발급
 * - 메시지 전송은 "나에게 보내기" API 사용
 * 
 * 필요한 ENV:
 *   KAKAO_REST_API_KEY
 *   KAKAO_CLIENT_SECRET (설정했다면)
 *   KAKAO_ADMIN_REFRESH_1=xxxx
 *   KAKAO_ADMIN_REFRESH_2=xxxx
 */

const REST_API_KEY = process.env.KAKAO_REST_API_KEY;
const CLIENT_SECRET = process.env.KAKAO_CLIENT_SECRET || "";
const REFRESH_1 = process.env.KAKAO_ADMIN_REFRESH_1; // 관리자1
const REFRESH_2 = process.env.KAKAO_ADMIN_REFRESH_2; // 관리자2

const TOKEN_URL = "https://kauth.kakao.com/oauth/token";
const SEND_URL = "https://kapi.kakao.com/v2/api/talk/memo/default/send";

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
 * 카카오톡 나에게 보내기 실행
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
 * 메시지 템플릿 구성
 */
function buildMessageTemplate(estimate) {
  return {
    object_type: "text",
    text: [
      "[플레오 AI 견적 도착]",
      "",
      `고객명: ${estimate.contact.name}`,
      `연락처: ${estimate.contact.phone}`,
      `이메일: ${estimate.contact.email}`,
      "",
      `작업 위치: ${estimate.workLocation}`,
      `작업 수량: ${estimate.workQty.toLocaleString()} EA`,
      `카톤 수량: ${estimate.cartonQty.toLocaleString()} CTN`,
      `총 중량: ${estimate.totalWeightKg.toLocaleString()} kg`,
      "",
      `작업 방식: ${estimate.workMethod || "-"}`,
      `제품 종류: ${estimate.productType || "-"}`,
      "",
      `예상 견적: ${estimate.fees.totalFee.toLocaleString()}원`,
      `예상 소요일: 약 ${estimate.leadTimeDays}일`,
      "",
      "※ 실제 금액은 담당자 확인 후 확정됩니다.",
    ].join("\n"),
    link: {
      web_url: "https://xn--on3b27gxrdt6b.com",
      mobile_web_url: "https://xn--on3b27gxrdt6b.com",
    },
    button_title: "플레오 사이트 열기",
  };
}

/**
 * === 메인 함수 ===
 * 견적 생성 후 estimate.js에서 sendKakaoAdminMemo(doc) 호출
 */
export async function sendKakaoAdminMemo(estimate) {
  try {
    if (!REFRESH_1 && !REFRESH_2) {
      console.warn("카카오 관리자 토큰이 설정되지 않음 (REFRESH_1/2 없음)");
      return;
    }

    const targets = [REFRESH_1, REFRESH_2].filter(Boolean);
    const template = buildMessageTemplate(estimate);

    await Promise.all(
      targets.map(async (refreshToken, idx) => {
        try {
          const accessToken = await getAccessToken(refreshToken);
          await sendKakaoMemo(accessToken, template);
          console.log(`[KAKAO MEMO] 관리자${idx + 1} 전송 완료`);
        } catch (err) {
          console.error(`[KAKAO MEMO] 관리자${idx + 1} 오류:`, err.message);
        }
      })
    );
  } catch (err) {
    console.error("sendKakaoAdminMemo 전체 오류:", err.message);
  }
}
