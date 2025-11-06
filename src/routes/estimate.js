import { Router } from "express";
const router = Router();

// Day 1: API 골격만. 실제 계산/업로드는 Day 3에서.
router.post("/", async (req, res) => {
  try {
    const { workQty, cartonQty, weightPerCarton } = req.body;
    // 최소 응답 (프론트 연동 테스트용)
    return res.json({
      ok: true,
      estimate: {
        echo: { workQty, cartonQty, weightPerCarton },
        message: "Day1: API skeleton OK"
      }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "server error" });
  }
});

export default router;
