import prisma, { Prisma } from '../utils/prisma';

type ApiKeyType = Prisma.ApiKeyGetPayload<{}>;

export class ApiKeyService {
  async getAll(): Promise<ApiKeyType[]> {
    return prisma.apiKey.findMany();
  }

  async getById(id: number): Promise<ApiKeyType | null> {
    return prisma.apiKey.findUnique({ where: { id: Number(id) } });
  }

  async create(data: ApiKeyType): Promise<ApiKeyType> {
    return prisma.apiKey.create({ data });
  }

  async update(id: number, data: Partial<ApiKeyType>): Promise<ApiKeyType> {
    return prisma.apiKey.update({ where: { id: Number(id) }, data });
  }

  async delete(id: number): Promise<ApiKeyType> {
    return prisma.apiKey.delete({ where: { id: Number(id) } });
  }
}
