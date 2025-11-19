// src/routes/estimate.js
import { Router } from "express";
import mongoose from "mongoose";

const Estimate = mongoose.models.Estimate || mongoose.model("Estimate", new mongoose.Schema({
  workQty: Number,
  cartonQty: Number,
  weightPerCarton: Number,
  totalWeightKg: Number,
  contact: { name: String, phone: String, email: String },
  memo: String,
  attachmentUrl: String,
  fees: { baseFee: Number, cartonFee: Number, adjRate: Number, totalFee: Number },
  leadTimeDays: Number,
  createdAt: { type: Date, default: Date.now },
}));

const router = Router();

router.post("/", async (req, res) => {
  try {
    const { workQty, cartonQty, weightPerCarton, contactName, contactPhone, contactEmail, memo } = req.body;
    if (!workQty || !cartonQty || !weightPerCarton || !contactName || !contactPhone || !contactEmail) {
      return res.status(400).json({ ok:false, message:"필수 입력 누락" });
    }

    // 파일 업로드(선택)
    let attachmentUrl = "";
    if (req.files?.attachment) {
      const up = await cloudinary.v2.uploader.upload(req.files.attachment.tempFilePath, { folder:"pleo-estimate" });
      attachmentUrl = up.secure_url;
    }

    // 간단 요율(초기 룰)
    const w = Number(workQty), c = Number(cartonQty), kg = Number(weightPerCarton);
    const totalWeightKg = c * kg;
    const baseFee = w * 500;
    const cartonFee = c * 200;
    let adjRate = 0;
    if (totalWeightKg > 500) adjRate += 0.10;
    if (attachmentUrl) adjRate += 0.05;
    if (memo && /야간|긴급|급히/.test(memo)) adjRate += 0.10;
    const totalFee = Math.round((baseFee + cartonFee) * (1 + adjRate));
    const leadTimeDays = totalWeightKg > 1000 ? 3 : 2;

    await Estimate.create({
      workQty:w, cartonQty:c, weightPerCarton:kg, totalWeightKg,
      contact:{ name:contactName, phone:contactPhone, email:contactEmail },
      memo, attachmentUrl,
      fees:{ baseFee, cartonFee, adjRate, totalFee },
      leadTimeDays
    });

    res.json({ ok:true, estimate:{ totalWeightKg, baseFee, cartonFee, aiAdj: Math.round((baseFee+cartonFee)*adjRate*-1), totalFee, leadTimeDays }});
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok:false, message:"서버 오류" });
  }
});

export default router;
