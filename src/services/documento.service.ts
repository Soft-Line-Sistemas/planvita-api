import { Prisma, getPrismaForTenant } from '../utils/prisma';

type DocumentoType = Prisma.DocumentoGetPayload<{}>;

export class DocumentoService {
  private prisma;

  constructor(private tenantId: string) {
    if (!tenantId) {
      throw new Error('Tenant ID must be provided');
    }

    this.prisma = getPrismaForTenant(tenantId);
  }

  async getAll(): Promise<DocumentoType[]> {
    return this.prisma.documento.findMany();
  }

  async getById(id: number): Promise<DocumentoType | null> {
    return this.prisma.documento.findUnique({ where: { id: Number(id) } });
  }

  async create(data: DocumentoType): Promise<DocumentoType> {
    return this.prisma.documento.create({ data });
  }

  async update(id: number, data: Partial<DocumentoType>): Promise<DocumentoType> {
    return this.prisma.documento.update({ where: { id: Number(id) }, data });
  }

  async delete(id: number): Promise<DocumentoType> {
    return this.prisma.documento.delete({ where: { id: Number(id) } });
  }
}
