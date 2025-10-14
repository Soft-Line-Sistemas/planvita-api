import prisma, { Prisma } from '../utils/prisma';

type DocumentoType = Prisma.DocumentoGetPayload<{}>;

export class DocumentoService {
  async getAll(): Promise<DocumentoType[]> {
    return prisma.documento.findMany();
  }

  async getById(id: number): Promise<DocumentoType | null> {
    return prisma.documento.findUnique({ where: { id: Number(id) } });
  }

  async create(data: DocumentoType): Promise<DocumentoType> {
    return prisma.documento.create({ data });
  }

  async update(id: number, data: Partial<DocumentoType>): Promise<DocumentoType> {
    return prisma.documento.update({ where: { id: Number(id) }, data });
  }

  async delete(id: number): Promise<DocumentoType> {
    return prisma.documento.delete({ where: { id: Number(id) } });
  }
}
