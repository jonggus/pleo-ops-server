// server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { connectDb } from "./src/db.js";
import estimateRouter from "./src/routes/estimate.js";
import adminKakaoRouter from "./src/routes/adminKakao.js";


app.use("/admin/kakao", adminKakaoRouter);

dotenv.config();

const app = express();

// ALLOWED_ORIGIN 예시 (.env)
// ALLOWED_ORIGIN=https://pleo.netlify.app,http://localhost:8888
const allowedOrigins = (process.env.ALLOWED_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// CORS 설정
app.use(
  cors({
    origin(origin, callback) {
      // 브라우저가 Origin을 안 보내는 경우(헬스체크, 서버 내부 호출 등) 허용
      if (!origin) return callback(null, true);

      if (!allowedOrigins.length || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

// 바디 파서
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 헬스체크
app.get("/health", (req, res) => res.json({ ok: true, ts: Date.now() }));

// 견적 API
app.use("/api/estimate", estimateRouter);

const PORT = process.env.PORT || 10000;

const start = async () => {
  try {
    await connectDb();
    app.listen(PORT, () => {
      console.log(`Server running on ${PORT}`);
    });
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
};

start();
