import { Router } from "express";
import authRouter from "./auth";

const router = Router();

router.get("/healthz", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

router.use("/auth/google", authRouter);

export default router;
