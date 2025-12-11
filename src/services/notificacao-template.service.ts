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

  async listar(flow?: string | null): Promise<NotificationTemplateModel[]> {
    return this.prisma.notificationTemplate.findMany({
      where: {
        tenantId: this.tenantId,
        ...(flow
          ? { OR: [{ flow: flow.toLowerCase() }, { flow: null }] }
          : {}),
      },
      orderBy: [{ canal: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async criar(data: Partial<NotificationTemplateModel>): Promise<NotificationTemplateModel> {
    if (data.isDefault) {
      await this.desmarcarDefaults(data.canal, data.flow);
    }
    return this.prisma.notificationTemplate.create({
      data: {
        tenantId: this.tenantId,
        nome: data.nome ?? 'Template sem nome',
        canal: (data.canal ?? 'email').toLowerCase(),
        flow: data.flow?.toLowerCase() ?? null,
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
      await this.desmarcarDefaults(data.canal, data.flow);
    }
    return this.prisma.notificationTemplate.update({
      where: { id },
      data: {
        nome: data.nome,
        canal: data.canal?.toLowerCase(),
        flow:
          data.flow === undefined
            ? undefined
            : data.flow?.toLowerCase() ?? null,
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

  async obterDefault(canal: string, flow?: string | null): Promise<NotificationTemplateModel | null> {
    const whereDefault: any = {
      tenantId: this.tenantId,
      canal: canal.toLowerCase(),
      isDefault: true,
    };

    if (flow) {
      const found = await this.prisma.notificationTemplate.findFirst({
        where: { ...whereDefault, flow: flow.toLowerCase() },
        orderBy: { createdAt: 'desc' },
      });
      if (found) return found;
    }

    return this.prisma.notificationTemplate.findFirst({
      where: { ...whereDefault, flow: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async desmarcarDefaults(canal?: string | null, flow?: string | null) {
    if (!canal) return;
    await this.prisma.notificationTemplate.updateMany({
      where: {
        tenantId: this.tenantId,
        canal: canal.toLowerCase(),
        isDefault: true,
        ...(flow ? { flow: flow.toLowerCase() } : {}),
      },
      data: { isDefault: false },
    });
  }
}
