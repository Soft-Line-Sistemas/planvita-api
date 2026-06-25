import { Prisma, getPrismaForTenant } from '../utils/prisma';
import { generateApiKey, hashApiKey } from '../utils/helpers';

type ApiKeyType = Prisma.ApiKeyGetPayload<{}>;
type ApiKeyCreateInput = {
  name?: string;
  isActive?: boolean;
  permissions?: string;
  rateLimit?: number;
  windowMs?: number;
};
type ApiKeyUpdateInput = Partial<ApiKeyCreateInput>;

export class ApiKeyService {
  private prisma;

  constructor(private tenantId: string) {
    if (!tenantId) {
      throw new Error('Tenant ID must be provided');
    }

    this.prisma = getPrismaForTenant(tenantId);
  }

  private async ensureLegacyView(): Promise<void> {
    await this.prisma.$executeRawUnsafe(`
      IF OBJECT_ID(N'ApiKey', N'V') IS NULL
         AND OBJECT_ID(N'ApiKey', N'U') IS NULL
         AND OBJECT_ID(N'api_keys', N'U') IS NOT NULL
      EXEC('CREATE VIEW ApiKey AS
            SELECT
              id,
              tenant_id,
              name,
              key_hash,
              is_active,
              permissions,
              rate_limit,
              window_ms,
              created_at,
              updated_at,
              last_used_at
            FROM api_keys');
    `);
  }

  private sanitize(apiKey: ApiKeyType) {
    const { keyHash: _keyHash, ...rest } = apiKey;
    return rest;
  }

  async getAll(): Promise<ApiKeyType[]> {
    const rows = await this.prisma.apiKey.findMany();
    return rows.map((row) => this.sanitize(row)) as ApiKeyType[];
  }

  async getById(id: string): Promise<ApiKeyType | null> {
    const row = await this.prisma.apiKey.findUnique({ where: { id } });
    return row ? (this.sanitize(row) as ApiKeyType) : null;
  }

  async create(data: ApiKeyCreateInput): Promise<ApiKeyType & { apiKey: string }> {
    await this.ensureLegacyView();
    const plainApiKey = generateApiKey();
    const keyHash = await hashApiKey(plainApiKey);
    const created = await this.prisma.apiKey.create({
      data: {
        tenantId: this.tenantId,
        name: String(data.name ?? '').trim() || 'API Key',
        keyHash,
        isActive: data.isActive ?? true,
        permissions: data.permissions ?? '{}',
        rateLimit: Number.isFinite(Number(data.rateLimit)) ? Number(data.rateLimit) : 100,
        windowMs: Number.isFinite(Number(data.windowMs)) ? Number(data.windowMs) : 900000,
      },
    });

    return {
      ...(this.sanitize(created) as ApiKeyType),
      apiKey: plainApiKey,
    };
  }

  async update(id: string, data: ApiKeyUpdateInput): Promise<ApiKeyType> {
    await this.ensureLegacyView();
    const updated = await this.prisma.apiKey.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: String(data.name).trim() } : {}),
        ...(data.isActive !== undefined ? { isActive: Boolean(data.isActive) } : {}),
        ...(data.permissions !== undefined ? { permissions: String(data.permissions) } : {}),
        ...(data.rateLimit !== undefined ? { rateLimit: Number(data.rateLimit) } : {}),
        ...(data.windowMs !== undefined ? { windowMs: Number(data.windowMs) } : {}),
      },
    });
    return this.sanitize(updated) as ApiKeyType;
  }

  async delete(id: string): Promise<ApiKeyType> {
    await this.ensureLegacyView();
    const deleted = await this.prisma.apiKey.delete({ where: { id } });
    return this.sanitize(deleted) as ApiKeyType;
  }
}
