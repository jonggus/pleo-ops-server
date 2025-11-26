// src/routes/estimate.js
import { Router } from "express";
import mongoose from "mongoose";
import { getAiAdjustment } from "../lib/ai.js";
import { sendEstimateMail } from "../lib/mail.js";

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

    urgency: { type: String, default: "normal" },
    refInfo: { type: String },

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
      transportFee: { type: Number, required: true, default: 0 },  // ★ 추가됨
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
  // ⑥ 평택항 교통비 (+100,000)
  // --------------------------------------------
  let transportFee = 0;
  if (/평택항/.test(workLoc) || /경기권/.test(workLoc)) {
    transportFee = 100000;
  }
  ruleFee += transportFee;

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
    const { baseFee, cartonFee, transportFee, ruleAdjRate, ruleFee } =
      calcRuleFee({
        workQty: w,
        cartonQty: c,
        totalWeightKg,
        workLocation,
        productType,
        urgency,
        memo,
      });

    // === 2차 AI 조정 ===
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

    // === 이메일 HTML ===
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
      <p><b>교통비(경기권 선택 시):</b> ${transportFee.toLocaleString()}원</p>
      <p><b>룰 조정률:</b> ${(ruleAdjRate * 100).toFixed(1)}%</p>
      <p><b>AI 조정률:</b> ${(aiAdjRate * 100).toFixed(1)}%</p>
      <p><b>합산 조정률:</b> ${(totalAdjRate * 100).toFixed(1)}%</p>
      <p><b>총 견적 비용(부가세 별도):</b> ${totalFee.toLocaleString()}원</p>
      <p><b>작업 소요일:</b> 약 ${leadTimeDays}일</p>

      <p style="color:#666;">
       ※ 경기권 작업은 기본 교통비 10만원이 포함되며, 작업 인원에 따라 비용이 추가될 수 있습니다(현장 확인 후 최종 확정).
      </p>

      <h3>AI 의견</h3>
      <p>${aiComment || "현재 AI 추가 조정 없이 기본 단가만 적용되었습니다."}</p>

      <hr />
      <p>플레오 보수작업 자동견적 시스템</p>
    `;

    // === 메일 발송 ===
    const to = process.env.ESTIMATE_MAIL_TO || process.env.SMTP_USER;
    const subject = "📌 새로운 AI 자동 견적 요청이 도착했습니다";

    try {
      const mailRes = await sendEstimateMail(to, subject, html);
      console.log("[mail] send result:", mailRes);
    } catch (emailErr) {
      console.error("📧 이메일 오류:", emailErr);
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
