import crypto from 'crypto';
import { getPrismaForTenant } from './prisma';
import { getConfiguredPublicTenants, normalizeTenantId } from './tenants';

const CONSULTOR_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CONSULTOR_CODE_LENGTH = 7;
const MAX_GENERATION_ATTEMPTS = 40;

function randomConsultorCode(length = CONSULTOR_CODE_LENGTH) {
  const bytes = crypto.randomBytes(length);
  let value = '';

  for (let index = 0; index < length; index += 1) {
    value += CONSULTOR_CODE_ALPHABET[bytes[index] % CONSULTOR_CODE_ALPHABET.length];
  }

  return value;
}

function normalizeConsultorCode(value?: string | null) {
  const normalized = String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  return normalized || null;
}

function buildTenantPool(tenantId: string) {
  const normalized = normalizeTenantId(tenantId);
  const pool = new Set(getConfiguredPublicTenants());
  if (normalized) {
    pool.add(normalized);
  }
  return Array.from(pool);
}

async function consultorCodeExists(
  tenantIds: string[],
  code: string,
  current?: { tenantId?: string | null; consultorId?: number | null },
) {
  for (const tenantId of tenantIds) {
    const prisma = getPrismaForTenant(tenantId);
    const consultor = await prisma.consultor.findFirst({
      where: {
        codigo: code,
      },
      select: {
        id: true,
      },
    });

    if (
      consultor &&
      !(
        tenantId === normalizeTenantId(current?.tenantId) &&
        consultor.id === Number(current?.consultorId)
      )
    ) {
      return true;
    }
  }

  return false;
}

export async function generateUniqueConsultorCode(
  tenantId: string,
  current?: { tenantId?: string | null; consultorId?: number | null },
) {
  const tenantPool = buildTenantPool(tenantId);

  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt += 1) {
    const code = randomConsultorCode();
    const exists = await consultorCodeExists(tenantPool, code, current);
    if (!exists) {
      return code;
    }
  }

  throw new Error('Não foi possível gerar um código único para o consultor.');
}

export async function ensureConsultorCode(
  tenantId: string,
  consultor: { id: number; codigo?: string | null },
) {
  const currentCode = normalizeConsultorCode(consultor.codigo);
  if (currentCode) {
    return currentCode;
  }

  const prisma = getPrismaForTenant(tenantId);
  const generatedCode = await generateUniqueConsultorCode(tenantId, {
    tenantId,
    consultorId: consultor.id,
  });

  const updated = await prisma.consultor.update({
    where: { id: consultor.id },
    data: { codigo: generatedCode },
    select: { codigo: true },
  });

  return normalizeConsultorCode(updated.codigo) ?? generatedCode;
}

export { normalizeConsultorCode };
