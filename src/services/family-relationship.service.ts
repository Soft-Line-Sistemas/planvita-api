import fs from 'fs';
import path from 'path';

type RelationshipMap = Record<string, string[]>;

const normalizeText = (value?: string | null): string => {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

let cachedMap: RelationshipMap | null = null;
let cachedReverse: Map<string, string> | null = null;

const possiblePaths = (): string[] => {
  return [
    path.resolve(__dirname, '../config/family-relationship-map.json'),
    path.resolve(process.cwd(), 'src/config/family-relationship-map.json'),
    path.resolve(process.cwd(), 'dist/config/family-relationship-map.json'),
  ];
};

const loadRelationshipMap = (): RelationshipMap => {
  if (cachedMap) return cachedMap;

  for (const filePath of possiblePaths()) {
    if (!fs.existsSync(filePath)) continue;

    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(content) as RelationshipMap;
    cachedMap = parsed;
    return parsed;
  }

  cachedMap = {
    outro: ['outro'],
  };
  return cachedMap;
};

const loadReverseMap = (): Map<string, string> => {
  if (cachedReverse) return cachedReverse;

  const reverse = new Map<string, string>();
  const relMap = loadRelationshipMap();

  Object.entries(relMap).forEach(([canonical, variants]) => {
    const normalizedCanonical = normalizeText(canonical);
    if (normalizedCanonical) reverse.set(normalizedCanonical, canonical);

    variants.forEach((variant) => {
      const normalizedVariant = normalizeText(variant);
      if (normalizedVariant) reverse.set(normalizedVariant, canonical);
    });
  });

  cachedReverse = reverse;
  return reverse;
};

export const canonicalizeRelationship = (value?: string | null): string => {
  const normalized = normalizeText(value);
  if (!normalized) return 'outro';

  const reverse = loadReverseMap();
  return reverse.get(normalized) ?? normalized;
};

export const normalizeRelationshipSet = (values: Array<string | null | undefined>): Set<string> => {
  const set = new Set<string>();

  values.forEach((value) => {
    const canonical = canonicalizeRelationship(value);
    if (canonical) set.add(canonical);
  });

  return set;
};

export const isRelationshipInGrade = (
  dependentRelationship: string | null | undefined,
  planBeneficiaries: Array<string | null | undefined>,
): boolean => {
  const normalizedDependent = canonicalizeRelationship(dependentRelationship);
  const rawBeneficiaries = planBeneficiaries
    .map((value) => String(value ?? '').trim())
    .filter((value) => value.length > 0);

  if (rawBeneficiaries.length === 0) return true;

  const matchesGroupedBeneficiary = (rawBeneficiary: string): boolean => {
    const normalizedBeneficiary = normalizeText(rawBeneficiary);

    if (
      normalizedBeneficiary.includes('pai e mae') ||
      normalizedBeneficiary.includes('mae e pai')
    ) {
      return normalizedDependent === 'pai' || normalizedDependent === 'mae';
    }

    if (normalizedBeneficiary.includes('filhos e netos')) {
      return normalizedDependent === 'filho' || normalizedDependent === 'neto';
    }

    if (normalizedBeneficiary.includes('neto e bisnetos')) {
      return normalizedDependent === 'neto';
    }

    if (normalizedBeneficiary.includes('sobrinhos ate 50 anos')) {
      return normalizedDependent === 'sobrinho';
    }

    if (normalizedBeneficiary.includes('esposo a ate 55 anos')) {
      return normalizedDependent === 'conjuge';
    }

    if (normalizedBeneficiary.includes('filhos')) {
      return normalizedDependent === 'filho';
    }

    if (normalizedBeneficiary.includes('irmaos')) {
      return normalizedDependent === 'irmao';
    }

    return false;
  };

  return rawBeneficiaries.some((beneficiary) => {
    const canonicalBeneficiary = canonicalizeRelationship(beneficiary);
    if (canonicalBeneficiary === normalizedDependent) return true;
    return matchesGroupedBeneficiary(beneficiary);
  });
};
