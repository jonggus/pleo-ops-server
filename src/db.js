// src/db.js
import mongoose from "mongoose";

export const connectDb = async () => {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    console.log("MONGODB_URI not set, skipping DB connect");
    return;
  }

  // 이미 연결되어 있으면 다시 연결하지 않음
  if (mongoose.connection.readyState >= 1) {
    return;
  }

  try {
    await mongoose.connect(uri, { dbName: "pleo_ops" });
    console.log("MongoDB connected");
  } catch (err) {
    console.error("MongoDB connection error:", err);
    throw err; // 서버 시작 쪽에서 잡아서 종료
  }
};
