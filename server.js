// server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fileUpload from "express-fileupload";
import { connectDb } from "./src/db.js";
import estimateRouter from "./src/routes/estimate.js";

dotenv.config();

const app = express();

// ALLOWED_ORIGIN= https://pleo.netlify.app,http://localhost:8888  (공백 없이)
const allowed = (process.env.ALLOWED_ORIGIN || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors({
  origin: allowed.length ? allowed : true,
  credentials: true,
}));

app.use(express.json());
app.use(fileUpload({ useTempFiles: true, tempFileDir: "/tmp" }));

app.get("/health", (req, res) => res.json({ ok: true, ts: Date.now() }));
app.use("/api/estimate", estimateRouter);

const PORT = Number(process.env.PORT) || 10000; // Render가 PORT를 넣어줌

const start = async () => {
  try {
    await connectDb(); // Mongo 연결 실패해도 throw하지 않게 했다면 OK
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on ${PORT}`);
    });
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

start();
