import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fileUpload from "express-fileupload";
import { connectDb } from "./src/db.js";
import estimateRouter from "./src/routes/estimate.js";

dotenv.config();
const app = express();

app.use(cors({ origin: process.env.ALLOWED_ORIGIN?.split(",") || "*", credentials: true }));
app.use(express.json());
app.use(fileUpload({ useTempFiles: true, tempFileDir: "/tmp" }));

app.get("/health", (req, res) => res.json({ ok: true, ts: Date.now() }));
app.use("/api/estimate", estimateRouter);

const start = async () => {
  await connectDb(); // Atlas 연결은 비워둬도 에러 없이 통과하도록 처리
  const port = process.env.PORT || 8080;
  app.listen(port, () => console.log(`Server running on ${port}`));
};
start();
