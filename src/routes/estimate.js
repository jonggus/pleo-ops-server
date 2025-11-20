// src/routes/estimate.js
import { Router } from "express";
import mongoose from "mongoose";
import { getAiAdjustment } from "../lib/ai.js";
import { sendEstimateMail } from "../lib/mail.js";

const router = Router();

// === Mongoose 모델 정의 ===
const estimateSchema = new mongoose.Schema(
  {
    workQty: { type: Number, required: true },
    cartonQty: { type: Number, required: true },
    weightPerCarton: { type: Number, required: true },
    totalWeightKg: { type: Number, required: true },

    // ✅ 작업 위치 (인천항/공항/신항/경기권 등)
    workLocation: {
      type: String,
      enum: ["INCHEON_PORT", "INCHEON_AIRPORT", "INCHEON_NEW_PORT", "GYEONGGI"],
      required: true,
    },

    // ✅ 물품 종류/위험도
    itemCategory: {
      type: String,
      enum: ["NORMAL", "FRAGILE", "HEAVY", "HIGH_VALUE"],
      default: "NORMAL",
    },

    contact: {
      name: { type: String, required: true },
      phone: { type: String, required: true },
      email: { type: String, required: true },
    },

    memo: { type: String },
    attachmentUrl: { type: String },

    fees: {
      baseFee: { type: Number, required: true },
      cartonFee: { type: Number, required: true },
      adjRate: { type: Number, required: true }, // 룰+AI 최종
      totalFee: { type: Number, required: true },
    },

    leadTimeDays: { type: Number, required: true },

    ai: {
      adjRate: { type: Number, default: 0 },
      comment: { type: String, default: "" },
    },

    // (선택) 나중에 화면에서 보여주기 좋게 룰 가중치 쪼개서 저장하고 싶으면:
    ruleBreakdown: {
      weightAdj: { type: Number, default: 0 },
      urgencyAdj: { type: Number, default: 0 },
      locationAdj: { type: Number, default: 0 },
      itemAdj: { type: Number, default: 0 },
      volumeAdj: { type: Number, default: 0 },
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

    // === 💌 이메일 내용 생성 ===
    const html = `
      <h2>새로운 AI 자동 견적 요청이 접수되었습니다</h2>

      <h3>고객 정보</h3>
      <p><b>담당자명:</b> ${contactName}</p>
      <p><b>연락처:</b> ${contactPhone}</p>
      <p><b>이메일:</b> ${contactEmail}</p>

      <h3>작업 정보</h3>
      <p><b>작업 수량:</b> ${w}</p>
      <p><b>카톤 수량:</b> ${c}</p>
      <p><b>카톤당 무게:</b> ${kg} kg</p>
      <p><b>총 중량:</b> ${totalWeightKg} kg</p>
      <p><b>메모:</b> ${memo || "(없음)"}</p>

      <h3>AI 자동견적 결과</h3>
      <p><b>기본 작업비:</b> ${baseFee.toLocaleString()}원</p>
      <p><b>카톤비:</b> ${cartonFee.toLocaleString()}원</p>
      <p><b>룰 조정률:</b> ${(ruleAdjRate * 100).toFixed(1)}%</p>
      <p><b>AI 조정률:</b> ${(aiAdjRate * 100).toFixed(1)}%</p>
      <p><b>합산 조정률:</b> ${(totalAdjRate * 100).toFixed(1)}%</p>
      <p><b>총 견적 비용:</b> ${totalFee.toLocaleString()}원</p>
      <p><b>작업 소요일:</b> 약 ${leadTimeDays}일</p>

      <h3>AI 의견</h3>
      <p>${aiComment || "(없음)"}</p>

      <hr />
      <p>플레오 보수작업 자동견적 시스템</p>
    `;

    // === 💌 메일 발송 ===
    const to =
      process.env.ESTIMATE_MAIL_TO || process.env.SMTP_USER; // COMPANY_MAIL 대신 ESTIMATE_MAIL_TO 사용

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
      // 이메일 실패해도 견적 API는 성공 응답 보내도록 유지
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
