import mongoose from "mongoose";

export const connectDb = async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.log("MONGODB_URI not set (Day 1: skipping DB connect)");
    return;
  }
  if (mongoose.connection.readyState >= 1) return;
  await mongoose.connect(uri, { dbName: "pleo_ops" });
  console.log("MongoDB connected");
};
