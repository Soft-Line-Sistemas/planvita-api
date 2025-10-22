import { Router } from "express";
import { RegrasController } from "../controllers/regras.controller";

const router = Router();
const controller = new RegrasController();

router.get("/", controller.getAll.bind(controller));
router.get("/:tenantId", controller.getByTenant.bind(controller));
router.post("/", controller.create.bind(controller));
router.put("/:tenantId", controller.update.bind(controller));

export default router;
