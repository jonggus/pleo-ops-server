// src/lib/ai.js
import OpenAI from "openai";

const client = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

/**
 * 플레오 보수작업 AI 견적 보정
 * @param {Object} payload - 견적 기본 데이터
 * @returns {Promise<{adjRate:number, comment:string}>}
 */
export async function getAiAdjustment(payload) {
  // API 키 없으면 그냥 0% 보정
  if (!client) {
    return { adjRate: 0, comment: "AI 비활성화 상태(OPENAI_API_KEY 없음)" };
  }

  const { workQty, cartonQty, weightPerCarton, totalWeightKg, baseFee, cartonFee, memo } =
    payload;

  const prompt = `
너는 인천항/인천공항 보세구역에서 실제 작업을 하는 보수작업 견적 어시스턴트야.
기본 견적이 이미 계산되어 있고, 너는 그것을 기준으로
+/- 몇 %를 조정할지와 간단한 이유만 제안해야 한다.

입력 데이터:
- 작업 수량: ${workQty}
- 카톤 수량: ${cartonQty}
- 카톤당 무게(kg): ${weightPerCarton}
- 총 중량(kg): ${totalWeightKg}
- 기본 작업비(원): ${baseFee}
- 카톤 수수료(원): ${cartonFee}
- 메모: ${memo || "없음"}

다음 조건을 지켜서 응답해:
1) 무리한 가격 인상/인하는 하지 말 것 (보통 -10% ~ +20% 범위)
2) JSON 형식으로만 답변할 것.
3) JSON 키는 딱 두 개만: "adjRate", "comment"

예:
{"adjRate":0.15,"comment":"야간 긴급 작업이라 15% 가산이 필요합니다."}
`;

  const completion = await client.responses.create({
    model: "gpt-4.1-mini",
    input: prompt,
  });

  const text =
    completion.output[0].content[0].type === "output_text"
      ? completion.output[0].content[0].text
      : "";

  try {
    const parsed = JSON.parse(text);
    const adjRate = Number(parsed.adjRate) || 0;
    const comment = typeof parsed.comment === "string" ? parsed.comment : "";
    // 안전범위 클램프 (-0.2 ~ +0.3)
    const safeAdj = Math.max(-0.2, Math.min(0.3, adjRate));
    return { adjRate: safeAdj, comment };
  } catch (e) {
    console.error("AI JSON parse error:", e, text);
    return { adjRate: 0, comment: "AI 응답 파싱 실패, 기본 금액 사용" };
  }
}
