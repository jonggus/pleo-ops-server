// src/routes/estimate.js
import { Router } from "express";
import mongoose from "mongoose";
import { getAiAdjustment } from "../lib/ai.js";
import { sendEstimateMail } from "../lib/mail.js";

const router = Router();

/**
 * === Mongoose 모델 정의 ===
 * index.html 폼 기준 필드
 * - workQty, cartonQty, weightPerCarton
 * - productType (제품 종류)
 * - workLocation (작업 위치/창고)
 * - urgency (긴급도)
 * - refInfo (BL번호 등)
 * - contactName/Phone/Email
 * - memo
 */
const estimateSchema = new mongoose.Schema(
  {
    workQty: { type: Number, required: true },
    cartonQty: { type: Number, required: true },
    weightPerCarton: { type: Number, required: true },
    totalWeightKg: { type: Number, required: true },

    // 작업 위치(그냥 문자열로 저장 – "인천항 보세창고" 그대로)
    workLocation: { type: String, required: true },

    // 제품 종류(생활용품, 냉동식품, 기저귀 등 자유 입력)
    productType: { type: String },

    // 긴급도: normal / urgent / night
    urgency: { type: String, default: "normal" },

    // BL번호 등 참고 정보
    refInfo: { type: String },

    contact: {
      name: { type: String, required: true },
      phone: { type: String, required: true },
      email: { type: String, required: true },
    },

    memo: { type: String },
    attachmentUrl: { type: String }, // 나중에 Cloudinary 붙일 예정

    fees: {
      baseFee: { type: Number, required: true },   // 수량 기준 기본 작업비
      cartonFee: { type: Number, required: true }, // 카톤 기준 비용
      adjRate: { type: Number, required: true },   // 룰 + AI 최종 조정률
      totalFee: { type: Number, required: true },  // 최종 견적
    },

    leadTimeDays: { type: Number, required: true },

    ai: {
      adjRate: { type: Number, default: 0 },
      comment: { type: String, default: "" },
    },
  },
  { timestamps: true }
);

const Estimate =
  mongoose.models.Estimate || mongoose.model("Estimate", estimateSchema);

/**
 * 룰 기반 견적 계산 함수
 * - 냉동/포대/기저귀/주류/무게/위치/긴급도 반영
 * - 인천항 최소 8만, 공항 최소 9만 보장
 */
function calcRuleFee({
  workQty,
  cartonQty,
  totalWeightKg,
  workLocation,
  productType,
  urgency,
  memo,
}) {
  const workLoc = workLocation || "";
  const prodType = productType || "";
  const urg = urgency || "normal";

  // ① 기본 단가 (개당 단가: 물량 구간별)
  let unit = 150; // 기본: 1,000개에 15만원 근처

  if (workQty >= 9000) {
    unit = 100; // 9,000개 이상: 100원 (예: 9,000개 → 90만원)
  } else if (workQty >= 5000) {
    unit = 110;
  } else if (workQty >= 3000) {
    unit = 130;
  } else if (workQty >= 1000) {
    unit = 150;
  } else if (workQty >= 200) {
    unit = 400; // 소량 작업
  } else {
    unit = 800; // 극소량(예: 40개) 최소 작업비 보장
  }

  let baseFee = workQty * unit;
  let cartonFee = cartonQty * 200; // 카톤 단가는 보정용

  // ② 가중률(rate) 계산
  let ruleAdjRate = 0;

  // (1) 무게 요인 – 톤수에 따라
  if (totalWeightKg > 5000) ruleAdjRate += 0.3; // 5톤 이상
  else if (totalWeightKg > 2000) ruleAdjRate += 0.2; // 2톤 이상
  else if (totalWeightKg > 1000) ruleAdjRate += 0.1; // 1톤 이상

  // (2) 제품 종류
  const isFrozen =
    /냉동/.test(prodType) || /냉동/.test(workLoc) || /냉동/.test(memo || "");
  const isSack =
    /포대|가루|분말/.test(prodType) || /포대/.test(memo || "");
  const isBulkyLiving =
    /기저귀|부피|대형/.test(prodType) || /기저귀/.test(memo || "");

  if (isBulkyLiving) {
    ruleAdjRate += 0.2; // 부피 큰 생활용품
  }

  if (/주류|위스키|와인|유리/.test(prodType)) {
    ruleAdjRate += 0.3; // 유리병/주류
  }

  // (3) 위치 요인
  if (/신항/.test(workLoc)) {
    ruleAdjRate += 0.05;
  }

  // (4) 긴급도
  if (urg === "urgent") {
    ruleAdjRate += 0.2; // 당일/익일
  } else if (urg === "night") {
    ruleAdjRate += 0.4; // 야간/주말
  }

  // 추가 텍스트 기반 긴급도
  if (memo && /야간|긴급|급히/.test(memo)) {
    ruleAdjRate += 0.1;
  }

  // ③ 기본 룰 요금 (퍼센트 가중 적용)
  let ruleFee = Math.round((baseFee + cartonFee) * (1 + ruleAdjRate));

  // ④ 포대류(무거운 가루/분말)의 최소 인건비 보장
  if (isSack) {
    // 2.5톤당 1일 인건비 15만원 기준
    const laborDays = Math.max(1, totalWeightKg / 2500);
    const laborMin = laborDays * 150000; // 남성 1일 15만원 기준

    if (ruleFee < laborMin) {
      ruleFee = laborMin;
    }
  }

  // ⑤ 냉동창고 프리미엄 (최종 견적에서 +5~10만원)
  if (isFrozen) {
    const extra = totalWeightKg > 1000 ? 100000 : 50000; // 1톤 넘으면 10만, 아니면 5만
    ruleFee += extra;
  }

  // ⑥ 위치별 최소 요금 (인천항 8만원, 인천 공항 9만원)
  let minFee = 0;
  if (/공항/.test(workLoc)) {
    minFee = 90000;
  } else if (/인천/.test(workLoc) || /항/.test(workLoc)) {
    minFee = 80000;
  }

  if (ruleFee < minFee) {
    ruleFee = minFee;
  }

  return { baseFee, cartonFee, ruleAdjRate, ruleFee };
}

// === 견적 저장 + 리턴 ===
router.post("/", async (req, res) => {
  try {
    const {
      workQty,
      cartonQty,
      weightPerCarton,
      workLocation,
      productType,
      urgency,
      refInfo,
      contactName,
      contactPhone,
      contactEmail,
      memo,
    } = req.body;

    // 기본 검증
    if (
      workQty == null ||
      cartonQty == null ||
      weightPerCarton == null ||
      !workLocation ||
      !contactName ||
      !contactPhone ||
      !contactEmail
    ) {
      return res
        .status(400)
        .json({ ok: false, message: "필수 입력값이 누락되었습니다." });
    }

    const w = Number(workQty);
    const c = Number(cartonQty);
    const kg = Number(weightPerCarton);

    if (!Number.isFinite(w) || !Number.isFinite(c) || !Number.isFinite(kg)) {
      return res
        .status(400)
        .json({ ok: false, message: "수량/무게는 숫자여야 합니다." });
    }

    const totalWeightKg = c * kg;

    // === 1차: 룰 기반 요율 계산 ===
    const { baseFee, cartonFee, ruleAdjRate, ruleFee } = calcRuleFee({
      workQty: w,
      cartonQty: c,
      totalWeightKg,
      workLocation,
      productType,
      urgency,
      memo,
    });

    // === 2차: AI 조정률 요청 (없어도 견적은 돌아감) ===
    const aiInput = {
      workQty: w,
      cartonQty: c,
      weightPerCarton: kg,
      totalWeightKg,
      baseFee,
      cartonFee,
      memo,
    };

    let aiAdjRate = 0;
    let aiComment = "";

    try {
      const ai = await getAiAdjustment(aiInput);
      if (ai) {
        aiAdjRate = ai.adjRate || 0;
        aiComment = ai.comment || "";
      }
    } catch (e) {
      console.error("AI adjust error:", e);
      // 크레딧 부족/키 없음 등은 여기서 조용히 무시하고 0%로 진행
    }

    // 룰 + AI 합산
    const totalAdjRate = ruleAdjRate + aiAdjRate;
    // ruleFee에는 이미 룰 조정/최소비용/냉동 프리미엄까지 반영
    const totalFee = Math.round(ruleFee * (1 + aiAdjRate));
    const leadTimeDays = totalWeightKg > 1000 ? 3 : 2;

    // === DB 저장 ===
    const doc = await Estimate.create({
      workQty: w,
      cartonQty: c,
      weightPerCarton: kg,
      totalWeightKg,
      workLocation,
      productType,
      urgency,
      refInfo,
      contact: {
        name: contactName,
        phone: contactPhone,
        email: contactEmail,
      },
      memo,
      attachmentUrl: "",
      fees: {
        baseFee,
        cartonFee,
        adjRate: totalAdjRate,
        totalFee,
      },
      leadTimeDays,
      ai: {
        adjRate: aiAdjRate,
        comment: aiComment,
      },
    });

    console.log("Estimate saved:", doc._id.toString());

    // === 💌 이메일 내용 생성 ===
    const html = `
      <h2>새로운 AI 자동 견적 요청이 접수되었습니다</h2>

      <h3>고객 정보</h3>
      <p><b>담당자명:</b> ${contactName}</p>
      <p><b>연락처:</b> ${contactPhone}</p>
      <p><b>이메일:</b> ${contactEmail}</p>

      <h3>작업 정보</h3>
      <p><b>작업 수량:</b> ${w.toLocaleString()} EA</p>
      <p><b>카톤 수량:</b> ${c.toLocaleString()} CTN</p>
      <p><b>카톤당 무게:</b> ${kg} kg</p>
      <p><b>총 중량:</b> ${totalWeightKg.toLocaleString()} kg</p>
      <p><b>작업 위치:</b> ${workLocation}</p>
      <p><b>제품 종류:</b> ${productType || "(미입력)"}</p>
      <p><b>BL번호/참고:</b> ${refInfo || "(미입력)"}</p>
      <p><b>메모:</b> ${memo || "(없음)"}</p>

      <h3>AI 자동견적 결과 (부가세 별도)</h3>
      <p><b>기본 작업비:</b> ${baseFee.toLocaleString()}원</p>
      <p><b>카톤비:</b> ${cartonFee.toLocaleString()}원</p>
      <p><b>룰 조정률:</b> ${(ruleAdjRate * 100).toFixed(1)}%</p>
      <p><b>AI 조정률:</b> ${(aiAdjRate * 100).toFixed(1)}%</p>
      <p><b>합산 조정률:</b> ${(totalAdjRate * 100).toFixed(1)}%</p>
      <p><b>총 견적 비용(부가세 별도):</b> ${totalFee.toLocaleString()}원</p>
      <p><b>작업 소요일:</b> 약 ${leadTimeDays}일</p>

      <h3>AI 의견</h3>
      <p>${aiComment || "현재 AI 추가 조정 없이 기본 단가만 적용되었습니다."}</p>

      <hr />
      <p>플레오 보수작업 자동견적 시스템</p>
    `;

    // === 💌 메일 발송 ===
    const to = process.env.ESTIMATE_MAIL_TO || process.env.SMTP_USER;

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
      // 이메일 실패해도 API 응답은 성공으로
    }

    // === 클라이언트로 응답 ===
    return res.json({
      ok: true,
      estimate: {
        id: doc._id,
        totalWeightKg,
        baseFee,
        cartonFee,
        ruleAdjRate,
        aiAdjRate,
        totalAdjRate,
        totalFee,
        leadTimeDays,
        aiComment,
      },
    });
  } catch (err) {
    console.error("estimate error:", err);
    return res
      .status(500)
      .json({ ok: false, message: "서버 오류가 발생했습니다." });
  }
});

export default router;
