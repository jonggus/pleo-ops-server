// server.js
import express from "express";
import cors from "cors";
import fileUpload from "express-fileupload";
import dotenv from "dotenv";               // ✅ 이렇게 import
import { connectDb } from "./src/db.js";   // ✅ DB 연결 함수
import estimateRouter from "./src/routes/estimate.js";

dotenv.config();

const app = express();

// ALLOWED_ORIGIN= https://pleo.netlify.app,http://localhost:8888
const allowedOrigins = (process.env.ALLOWED_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// CORS 설정
app.use(
  cors({
    origin(origin, callback) {
      // 브라우저가 Origin 안 보내는 경우(헬스체크 등) 허용
      if (!origin) return callback(null, true);
      if (!allowedOrigins.length || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  fileUpload({
    useTempFiles: true,
    tempFileDir: "/tmp",
  })
);

// 헬스체크
app.get("/health", (req, res) => res.json({ ok: true, ts: Date.now() }));

// 견적 API
app.use("/api/estimate", estimateRouter);

const PORT = Number(process.env.PORT) || 8080; // Render에서 PORT 주입

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
