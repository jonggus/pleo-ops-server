import mongoose from "mongoose";

const adminTokenSchema = new mongoose.Schema({
  role: { type: String, required: true, unique: true }, // owner, boss
  refreshToken: { type: String, required: true },
  updatedAt: { type: Date, default: Date.now },
});

export default mongoose.models.AdminToken ||
  mongoose.model("AdminToken", adminTokenSchema);
