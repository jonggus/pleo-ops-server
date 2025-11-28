// src/routes/estimate.js
import { Router } from "express";
import mongoose from "mongoose";
import { getAiAdjustment } from "../lib/ai.js";
import { sendKakaoAdminMemo } from "../lib/kakaoAdminMemo.js";

const router = Router();

/**
 * === Mongoose 모델 정의 ===
 */
const estimateSchema = new mongoose.Schema(
  {
    workQty: { type: Number, required: true },
    cartonQty: { type: Number, required: true },
    weightPerCarton: { type: Number, required: true },
    totalWeightKg: { type: Number, required: true },

    workLocation: { type: String, required: true },
    productType: { type: String },

    // 작업 방식: 스티커 / 박음질 / 도장 / 기타(입회 등)
    workMethod: { type: String },

    urgency: { type: String, default: "normal" },
    refInfo: { type: String },

    contact: {
      name: { type: String, required: true },
      phone: { type: String, required: true },
      email: { type: String, required: true },
    },

    memo: { type: String },

    // 안내 문구들 (교통비 가능성, 미싱 사용료 등)
    notices: { type: [String], default: [] },

    fees: {
      baseFee: { type: Number, required: true },
      cartonFee: { type: Number, required: true },
      transportFee: { type: Number, required: true, default: 0 },
      adjRate: { type: Number, required: true },
      totalFee: { type: Number, required: true },
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
 * === 룰 기반 견적 계산 ===
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

  // --------------------------------------------
  // ① 기본 단가 (개수 기준)
  // --------------------------------------------
  let unit = 150;

  if (workQty >= 9000) unit = 100;
  else if (workQty >= 5000) unit = 110;
  else if (workQty >= 3000) unit = 130;
  else if (workQty >= 1000) unit = 150;
  else if (workQty >= 200) unit = 400;
  else unit = 800;

  let baseFee = workQty * unit;
  let cartonFee = cartonQty * 200;

  // --------------------------------------------
  // ② 가중률 (무게/품목/위치/긴급도)
  // --------------------------------------------
  let ruleAdjRate = 0;

  // 무게
  if (totalWeightKg > 5000) ruleAdjRate += 0.3;
  else if (totalWeightKg > 2000) ruleAdjRate += 0.2;
  else if (totalWeightKg > 1000) ruleAdjRate += 0.1;

  const isFrozen =
    /냉동/.test(prodType) || /냉동/.test(workLoc) || /냉동/.test(memo || "");
  const isSack =
    /포대|가루|분말/.test(prodType) || /포대/.test(memo || "");
  const isBulkyLiving =
    /기저귀|부피|대형/.test(prodType) || /기저귀/.test(memo || "");

  if (isBulkyLiving) ruleAdjRate += 0.2;
  if (/주류|위스키|와인|유리/.test(prodType)) ruleAdjRate += 0.3;

  // 위치 요인
  if (/신항/.test(workLoc)) ruleAdjRate += 0.05;

  // 긴급도
  if (urg === "urgent") ruleAdjRate += 0.2;
  if (urg === "night") ruleAdjRate += 0.4;
  if (memo && /야간|긴급|급히/.test(memo)) ruleAdjRate += 0.1;

  // --------------------------------------------
  // ③ 룰 요금
  // --------------------------------------------
  let ruleFee = Math.round((baseFee + cartonFee) * (1 + ruleAdjRate));

  // --------------------------------------------
  // ④ 포대류 인건비 보장
  // --------------------------------------------
  if (isSack) {
    const laborDays = Math.max(1, totalWeightKg / 2500);
    const laborMin = laborDays * 150000;
    if (ruleFee < laborMin) ruleFee = laborMin;
  }

  // --------------------------------------------
  // ⑤ 냉동 프리미엄
  // --------------------------------------------
  if (isFrozen) {
    const extra = totalWeightKg > 1000 ? 100000 : 50000;
    ruleFee += extra;
  }

  // --------------------------------------------
  // ⑥ 교통비: 평택항/경기권 로직 제거
  //     (transportFee는 항상 0, 안내 문구만 별도로 처리)
  // --------------------------------------------
  const transportFee = 0;

  // --------------------------------------------
  // ⑦ 최소 요금 (인천항 8만, 공항 9만)
  // --------------------------------------------
  let minFee = 0;
  if (/공항/.test(workLoc)) minFee = 90000;
  else if (/인천/.test(workLoc) || /항/.test(workLoc)) minFee = 80000;

  if (ruleFee < minFee) ruleFee = minFee;

  return { baseFee, cartonFee, transportFee, ruleAdjRate, ruleFee };
}

/**
 * === 라우터 POST ===
 */
router.post("/", async (req, res) => {
  try {
    const {
      workQty,
      cartonQty,
      weightPerCarton,
      workLocation,
      productType,
      workMethod, // 스티커 / 박음질 / 도장 / 기타
      urgency,
      refInfo,
      contactName,
      contactPhone,
      contactEmail,
      memo,
    } = req.body;

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

    // === 1차 룰 기반 ===
    const {
      baseFee,
      cartonFee,
      transportFee,
      ruleAdjRate,
      ruleFee: ruleFeeRaw,
    } = calcRuleFee({
      workQty: w,
      cartonQty: c,
      totalWeightKg,
      workLocation,
      productType,
      urgency,
      memo,
    });

    let ruleFee = ruleFeeRaw;
    const notices = [];

    // 1) 창고 위치가 인천항이 아닌 경우: 교통비 안내
    if (!/인천항/.test(workLocation)) {
      notices.push("교통비가 발생할 수 있습니다.");
    }

    // 2) 작업 방식이 박음질인 경우: 견적 2배 및 안내문구
    const method = (workMethod || "").trim();
    const isSewing =
      method === "박음질" || /박음질/.test(method) || /봉제|재봉/.test(method);

    if (isSewing) {
      ruleFee = Math.round(ruleFee * 2); // 기존 룰 견적의 약 2배
      notices.push("미싱 사용료 별도 발생");
    }

    // === 2차 AI 조정 ===
    const aiInput = {
      workQty: w,
      cartonQty: c,
      weightPerCarton: kg,
      totalWeightKg,
      baseFee,
      cartonFee,
      memo,
      workLocation,
      productType,
      workMethod: method,
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
    }

    const totalAdjRate = ruleAdjRate + aiAdjRate;
    const totalFee = Math.round(ruleFee * (1 + aiAdjRate));
    const leadTimeDays = Math.max(1, Math.ceil(w / 30000));

    // === DB 저장 ===
    const doc = await Estimate.create({
      workQty: w,
      cartonQty: c,
      weightPerCarton: kg,
      totalWeightKg,
      workLocation,
      productType,
      workMethod: method,
      urgency,
      refInfo,
      contact: {
        name: contactName,
        phone: contactPhone,
        email: contactEmail,
      },
      memo,
      notices,
      fees: {
        baseFee,
        cartonFee,
        transportFee,
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

    // 카카오 관리자 알림 (실패해도 응답은 그대로 반환)
    sendKakaoAdminMemo(doc).catch((err) => {
      console.error("Kakao memo send error:", err);
    });


    // === 카카오 알림 (관리자/사장님에게 알림 보내기) ===
    // 필요 시 ../lib/kakaoAdminMemo.js 에서 구현한 함수가 호출됩니다.
    try {
      await sendKakaoAdminMemo(doc);
    } catch (kakaoErr) {
      console.error("Kakao send error:", kakaoErr);
    }

    return res.json({
      ok: true,
      estimate: {
        id: doc._id,
        totalWeightKg,
        baseFee,
        cartonFee,
        transportFee,
        ruleAdjRate,
        aiAdjRate,
        totalAdjRate,
        totalFee,
        leadTimeDays,
        aiComment,
        notices,
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
