"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const health_controller_1 = require("../controllers/health.controller");
const router = express_1.default.Router();
router.get("/", health_controller_1.healthController.healthCheck.bind(health_controller_1.healthController));
router.get("/liveness", health_controller_1.healthController.livenessCheck.bind(health_controller_1.healthController));
router.get("/metrics", health_controller_1.healthController.metricsCheck.bind(health_controller_1.healthController));
exports.default = router;
