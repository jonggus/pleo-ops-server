// server.js
import express from "express";
import cors from "cors";
import fileUpload from "express-fileupload";
import { config as dotenvConfig } from "dotenv";
import { connectDb } from "./src/db.js";  // ✅ 이 줄
import estimateRouter from "./src/routes/estimate.js";


dotenv.config();

const app = express();

// ALLOWED_ORIGIN= https://pleo.netlify.app,http://localhost:8888  (공백 없이)
const allowed = (process.env.ALLOWED_ORIGIN || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors({ origin: (process.env.ALLOWED_ORIGIN || "*").split(","),
                credentials: true }));

app.use(express.json());
app.use(fileUpload({ useTempFiles: true, tempFileDir: "/tmp" }));

app.get("/health", (req, res) => res.json({ ok: true, ts: Date.now() }));
app.use("/api/estimate", estimateRouter);

const PORT = Number(process.env.PORT) || 8888; // Render가 PORT를 넣어줌

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
