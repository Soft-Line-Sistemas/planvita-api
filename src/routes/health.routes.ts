import express from "express";
import { healthController } from "../controllers/health.controller";

const router = express.Router();

router.get("/", healthController.healthCheck.bind(healthController));
router.get("/liveness", healthController.livenessCheck.bind(healthController));
router.get("/metrics", healthController.metricsCheck.bind(healthController));

export default router;
