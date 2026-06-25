const PUBLIC_TENANT_ORDER = ['lider', 'pax', 'bosque'] as const;

const TENANT_LABELS: Record<string, string> = {
  lider: 'Lider',
  pax: 'Pax',
  bosque: 'Campo do Bosque',
};

export function normalizeTenantId(value?: string | null): string | null {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();
  if (!normalized) return null;
  return /^[a-z0-9-]+$/.test(normalized) ? normalized : null;
}

export function getTenantLabel(tenantId?: string | null): string {
  const normalized = normalizeTenantId(tenantId);
  if (!normalized) return 'Tenant';
  return TENANT_LABELS[normalized] ?? normalized;
}

export function getConfiguredPublicTenants(): string[] {
  return PUBLIC_TENANT_ORDER.filter((tenantId) => {
    const envVar = `DATABASE_URL_${tenantId.toUpperCase()}`;
    return Boolean(process.env[envVar]);
  });
}
