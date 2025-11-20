// src/routes/estimate.js
import { Router } from "express";
import mongoose from "mongoose";
import { getAiAdjustment } from "../lib/ai.js";

const router = Router();

// === Mongoose 모델 정의 ===
const estimateSchema = new mongoose.Schema(
  {
    workQty: { type: Number, required: true },
    cartonQty: { type: Number, required: true },
    weightPerCarton: { type: Number, required: true },
    totalWeightKg: { type: Number, required: true },

    contact: {
      name: { type: String, required: true },
      phone: { type: String, required: true },
      email: { type: String, required: true },
    },

    memo: { type: String },
    // 나중에 Cloudinary 붙이면 사용
    attachmentUrl: { type: String },

    fees: {
      baseFee: { type: Number, required: true },
      cartonFee: { type: Number, required: true },
      adjRate: { type: Number, required: true }, // 룰 + AI 최종 조정률
      totalFee: { type: Number, required: true },
    },

    leadTimeDays: { type: Number, required: true },

    // ✅ AI 관련 필드
    ai: {
      adjRate: { type: Number, default: 0 }, // AI 추가/감액 비율
      comment: { type: String, default: "" }, // AI 코멘트
    },
  },
  { timestamps: true }
);

const Estimate =
  mongoose.models.Estimate || mongoose.model("Estimate", estimateSchema);

// === 견적 저장 + 리턴 ===
router.post("/", async (req, res) => {
  try {
    const {
      workQty,
      cartonQty,
      weightPerCarton,
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
    const baseFee = w * 500;
    const cartonFee = c * 200;
    let ruleAdjRate = 0;

    if (totalWeightKg > 500) ruleAdjRate += 0.1;
    if (memo && /야간|긴급|급히/.test(memo)) ruleAdjRate += 0.1;

    const ruleFee = baseFee + cartonFee;

    // === 2차: AI 조정률 요청 ===
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
      // AI 실패해도 서비스는 돌아가야 하니까 조용히 0으로 진행
    }

    const totalAdjRate = ruleAdjRate + aiAdjRate;
    const totalFee = Math.round(ruleFee * (1 + totalAdjRate));
    const leadTimeDays = totalWeightKg > 1000 ? 3 : 2;

    // === DB 저장 ===
    const doc = await Estimate.create({
      workQty: w,
      cartonQty: c,
      weightPerCarton: kg,
      totalWeightKg,
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

    // === 클라이언트로 응답 ===
    return res.json({
      ok: true,
      estimate: {
        id: doc._id,
        totalWeightKg,
        baseFee,
        cartonFee,
        ruleAdjRate,   // 룰 기반 조정률
        aiAdjRate,     // AI 조정률
        totalAdjRate,  // 합산
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
