import { Prisma, getPrismaForTenant } from '../utils/prisma';
import Logger from '../utils/logger';

type NotificationTemplateModel = Prisma.NotificationTemplateGetPayload<{}>;

export class NotificacaoTemplateService {
  private prisma;
  private logger = new Logger({ service: 'NotificacaoTemplateService' });

  constructor(private tenantId: string) {
    if (!tenantId) throw new Error('Tenant ID must be provided');
    this.prisma = getPrismaForTenant(tenantId);
  }

  async listar(): Promise<NotificationTemplateModel[]> {
    return this.prisma.notificationTemplate.findMany({
      where: { tenantId: this.tenantId },
      orderBy: [{ canal: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async criar(data: Partial<NotificationTemplateModel>): Promise<NotificationTemplateModel> {
    if (data.isDefault) {
      await this.desmarcarDefaults(data.canal);
    }
    return this.prisma.notificationTemplate.create({
      data: {
        tenantId: this.tenantId,
        nome: data.nome ?? 'Template sem nome',
        canal: (data.canal ?? 'email').toLowerCase(),
        assunto: data.assunto,
        htmlBody: data.htmlBody,
        textBody: data.textBody,
        anexos: data.anexos,
        isDefault: !!data.isDefault,
      },
    });
  }

  async atualizar(
    id: number,
    data: Partial<NotificationTemplateModel>,
  ): Promise<NotificationTemplateModel> {
    if (data.isDefault) {
      await this.desmarcarDefaults(data.canal);
    }
    return this.prisma.notificationTemplate.update({
      where: { id },
      data: {
        nome: data.nome,
        canal: data.canal?.toLowerCase(),
        assunto: data.assunto,
        htmlBody: data.htmlBody,
        textBody: data.textBody,
        anexos: data.anexos,
        isDefault: data.isDefault,
      },
    });
  }

  async remover(id: number) {
    return this.prisma.notificationTemplate.delete({ where: { id } });
  }

  async obterDefault(canal: string): Promise<NotificationTemplateModel | null> {
    return this.prisma.notificationTemplate.findFirst({
      where: { tenantId: this.tenantId, canal: canal.toLowerCase(), isDefault: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async desmarcarDefaults(canal?: string | null) {
    if (!canal) return;
    await this.prisma.notificationTemplate.updateMany({
      where: { tenantId: this.tenantId, canal: canal.toLowerCase(), isDefault: true },
      data: { isDefault: false },
    });
  }
}
