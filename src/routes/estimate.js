// src/routes/estimate.js
import { Router } from "express";
import mongoose from "mongoose";

const router = Router();

// === Mongoose 모델 정의 ===
const estimateSchema = new mongoose.Schema(
  {
    workQty: Number,
    cartonQty: Number,
    weightPerCarton: Number,
    totalWeightKg: Number,
    contact: {
      name: String,
      phone: String,
      email: String,
    },
    memo: String,
    // 나중에 Cloudinary 붙이면 사용
    attachmentUrl: String,
    fees: {
      baseFee: Number,
      cartonFee: Number,
      adjRate: Number,
      totalFee: Number,
    },
    leadTimeDays: Number,
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

    if (!workQty || !cartonQty || !weightPerCarton ||
        !contactName || !contactPhone || !contactEmail) {
      return res
        .status(400)
        .json({ ok: false, message: "필수 입력값이 누락되었습니다." });
    }

    const w = Number(workQty);
    const c = Number(cartonQty);
    const kg = Number(weightPerCarton);

    const totalWeightKg = c * kg;

    // 아주 간단한 요율 예시 (나중에 AI 로직으로 교체)
    const baseFee = w * 500;      // 작업 수량 기준
    const cartonFee = c * 200;    // 카톤 수 기준
    let adjRate = 0;

    if (totalWeightKg > 500) adjRate += 0.1;            // 중량 많으면 10% 가중
    if (memo && /야간|긴급|급히/.test(memo)) adjRate += 0.1; // 메모에 “야간/긴급” 있으면 10% 가중

    const totalFee = Math.round((baseFee + cartonFee) * (1 + adjRate));
    const leadTimeDays = totalWeightKg > 1000 ? 3 : 2;

    // 실제 MongoDB에 저장하는 부분 🔥
    const doc = await Estimate.create({
      workQty: w,
      cartonQty: c,
      weightPerCarton: kg,
      totalWeightKg,
      contact: { name: contactName, phone: contactPhone, email: contactEmail },
      memo,
      attachmentUrl: "", // 아직 Cloudinary는 안 씀
      fees: { baseFee, cartonFee, adjRate, totalFee },
      leadTimeDays,
    });

    console.log("Estimate saved:", doc._id.toString());

    return res.json({
      ok: true,
      estimate: {
        id: doc._id,
        totalWeightKg,
        baseFee,
        cartonFee,
        adjRate,
        totalFee,
        leadTimeDays,
      },
    });
  } catch (err) {
    console.error("estimate error:", err);
    res.status(500).json({ ok: false, message: "서버 오류가 발생했습니다." });
  }
});

export default router;
