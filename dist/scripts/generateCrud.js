"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const sdk_1 = require("@prisma/sdk");
const prismaSchemaPath = path_1.default.join(process.cwd(), 'prisma/schema.prisma');
const outputBase = path_1.default.join(process.cwd(), 'src');
async function generateCRUD() {
    const datamodel = fs_1.default.readFileSync(prismaSchemaPath, 'utf-8');
    const dmmf = await (0, sdk_1.getDMMF)({ datamodel });
    const models = dmmf.datamodel.models.map((m) => m.name);
    for (const model of models) {
        const pascal = model;
        const fileName = model.toLowerCase();
        const camel = model[0].toLowerCase() + model.slice(1);
        const lower = model.toLowerCase();
        const serviceDir = path_1.default.join(outputBase, 'services');
        const controllerDir = path_1.default.join(outputBase, 'controllers');
        const routesDir = path_1.default.join(outputBase, 'routes');
        if (!fs_1.default.existsSync(serviceDir))
            fs_1.default.mkdirSync(serviceDir, { recursive: true });
        if (!fs_1.default.existsSync(controllerDir))
            fs_1.default.mkdirSync(controllerDir, { recursive: true });
        if (!fs_1.default.existsSync(routesDir))
            fs_1.default.mkdirSync(routesDir, { recursive: true });
        const serviceContent = `
import prisma, { Prisma } from '../utils/prisma';

type ${pascal}Type = Prisma.${pascal}GetPayload<{}>;

export class ${pascal}Service {
  async getAll(): Promise<${pascal}Type[]> {
    return prisma.${camel}.findMany();
  }

  async getById(id: number): Promise<${pascal}Type | null> {
    return prisma.${camel}.findUnique({ where: { id: Number(id) } });
  }

  async create(data: ${pascal}Type): Promise<${pascal}Type> {
    return prisma.${camel}.create({ data });
  }

  async update(id: number, data: Partial<${pascal}Type>): Promise<${pascal}Type> {
    return prisma.${camel}.update({ where: { id: Number(id) }, data });
  }

  async delete(id: number): Promise<${pascal}Type> {
    return prisma.${camel}.delete({ where: { id: Number(id) } });
  }
}
`;
        fs_1.default.writeFileSync(path_1.default.join(serviceDir, `${fileName}.service.ts`), serviceContent.trim() + '\n');
        const controllerContent = `
import { Request, Response } from 'express';
import { ${pascal}Service } from '../services/${lower}.service';
import Logger from '../utils/logger';

export class ${pascal}Controller {
  private service = new ${pascal}Service();
  private logger = new Logger({ service: '${pascal}Controller' });

  async getAll(req: Request, res: Response) {
    try {
      const result = await this.service.getAll();
      this.logger.info('getAll executed successfully');
      res.json(result);
    } catch (error) {
      this.logger.error('Failed to get all ${pascal}', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  async getById(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const result = await this.service.getById(Number(id));
      if (!result) {
        this.logger.warn(\`${pascal} not found for id: \${id}\`);
        return res.status(404).json({ message: '${pascal} not found' });
      }
      this.logger.info(\`getById executed successfully for id: \${id}\`);
      res.json(result);
    } catch (error) {
      this.logger.error(\`Failed to get ${pascal} by id\`, error, { params: req.params });
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  async create(req: Request, res: Response) {
    try {
      const data = req.body;
      const result = await this.service.create(data);
      this.logger.info('create executed successfully', { data });
      res.status(201).json(result);
    } catch (error) {
      this.logger.error('Failed to create ${pascal}', error, { body: req.body });
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  async update(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const data = req.body;
      const result = await this.service.update(Number(id), data);
      this.logger.info(\`update executed successfully for id: \${id}\`, { data });
      res.json(result);
    } catch (error) {
      this.logger.error(\`Failed to update ${pascal}\`, error, { params: req.params, body: req.body });
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  async delete(req: Request, res: Response) {
    try {
      const { id } = req.params;
      await this.service.delete(Number(id));
      this.logger.info(\`delete executed successfully for id: \${id}\`);
      res.status(204).send();
    } catch (error) {
      this.logger.error(\`Failed to delete ${pascal}\`, error, { params: req.params });
      res.status(500).json({ message: 'Internal server error' });
    }
  }
}
`;
        fs_1.default.writeFileSync(path_1.default.join(controllerDir, `${fileName}.controller.ts`), controllerContent.trim() + '\n');
        const routeContent = `
import { Router } from 'express';
import { ${pascal}Controller } from '../controllers/${lower}.controller';

const router = Router();
const controller = new ${pascal}Controller();

router.get('/', controller.getAll.bind(controller));
router.get('/:id', controller.getById.bind(controller));
router.post('/', controller.create.bind(controller));
router.put('/:id', controller.update.bind(controller));
router.delete('/:id', controller.delete.bind(controller));

export default router;
`;
        fs_1.default.writeFileSync(path_1.default.join(routesDir, `${fileName}.routes.ts`), routeContent.trim() + '\n');
    }
    console.log('✅ CRUD successfully generated for all Prisma models!');
}
generateCRUD().catch((err) => {
    console.error('❌ Error generating CRUD:', err);
});
