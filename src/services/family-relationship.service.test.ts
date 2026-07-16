const mockFs = {
  existsSync: jest.fn().mockReturnValue(false),
  readFileSync: jest.fn(),
};

jest.mock('fs', () => ({
  __esModule: true,
  default: mockFs,
  ...mockFs,
}));

const fs = require('fs').default;

// Reset module cache to clear the cached maps between tests
beforeEach(() => {
  jest.resetModules();
});

describe('family-relationship.service', () => {
  // ── canonicalizeRelationship ─────────────────────────────────────────────
  describe('canonicalizeRelationship', () => {
    let canonicalizeRelationship: (v?: string | null) => string;

    beforeEach(() => {
      const mod = require('./family-relationship.service');
      canonicalizeRelationship = mod.canonicalizeRelationship;
    });

    it('retorna "outro" para valor vazio', () => {
      expect(canonicalizeRelationship('')).toBe('outro');
    });

    it('retorna "outro" para null', () => {
      expect(canonicalizeRelationship(null)).toBe('outro');
    });

    it('retorna "outro" para undefined', () => {
      expect(canonicalizeRelationship(undefined)).toBe('outro');
    });

    it('retorna o valor normalizado quando não encontrado no mapa', () => {
      // Sem arquivo de mapa, o mapa padrão só tem "outro"
      const result = canonicalizeRelationship('parente distante');
      expect(result).toBe('parente distante');
    });

    it('normaliza acentos e espaços extras', () => {
      const result = canonicalizeRelationship('  Cônjuge  ');
      // "cônjuge" normalizado vira "conjuge" — não está no mapa padrão, retorna normalizado
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('normaliza maiúsculas para minúsculas', () => {
      const result1 = canonicalizeRelationship('FILHO');
      const result2 = canonicalizeRelationship('filho');
      expect(result1).toBe(result2);
    });

    it('classifica tio, sobrinho e primo como outro quando o mapa configurado assim', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(
        JSON.stringify({
          tio: ['tio', 'tia', 'tio(a)'],
          primeiro_grau: ['1 grau', '1° grau', '1º grau', '1o grau'],
          segundo_grau: ['2 grau', '2° grau', '2º grau', '2o grau'],
          outro: [
            'outro',
            'sobrinho',
            'sobrinha',
            'sobrinho(a)',
            'primo',
            'prima',
            'primo(a)',
          ],
        }),
      );

      jest.isolateModules(() => {
        const mod = require('./family-relationship.service');
        expect(mod.canonicalizeRelationship('Tio(a)')).toBe('tio');
        expect(mod.canonicalizeRelationship('Sobrinho(a)')).toBe('outro');
        expect(mod.canonicalizeRelationship('Primo(a)')).toBe('outro');
        expect(mod.canonicalizeRelationship('1° Grau')).toBe('primeiro_grau');
        expect(mod.canonicalizeRelationship('2° Grau')).toBe('segundo_grau');
      });
    });
  });

  // ── normalizeRelationshipSet ─────────────────────────────────────────────
  describe('normalizeRelationshipSet', () => {
    let normalizeRelationshipSet: (values: Array<string | null | undefined>) => Set<string>;

    beforeEach(() => {
      const mod = require('./family-relationship.service');
      normalizeRelationshipSet = mod.normalizeRelationshipSet;
    });

    it('retorna set com valores únicos', () => {
      const result = normalizeRelationshipSet(['filho', 'filho', 'conjuge']);
      expect(result.size).toBe(2);
    });

    it('retorna set vazio para array vazio', () => {
      expect(normalizeRelationshipSet([])).toEqual(new Set());
    });

    it('inclui "outro" para nulls e undefined', () => {
      const result = normalizeRelationshipSet([null, undefined]);
      expect(result.has('outro')).toBe(true);
    });

    it('filtra strings vazias (resultam em "outro")', () => {
      const result = normalizeRelationshipSet(['']);
      expect(result.has('outro')).toBe(true);
    });
  });

  // ── isRelationshipInGrade ────────────────────────────────────────────────
  describe('isRelationshipInGrade', () => {
    let isRelationshipInGrade: (dep: string | null | undefined, plan: Array<string | null | undefined>) => boolean;

    beforeEach(() => {
      const mod = require('./family-relationship.service');
      isRelationshipInGrade = mod.isRelationshipInGrade;
    });

    it('retorna true quando lista de beneficiários está vazia (plano aceita todos)', () => {
      expect(isRelationshipInGrade('filho', [])).toBe(true);
    });

    it('retorna true quando beneficiário está na lista (correspondência direta)', () => {
      // Sem mapa externo, canonicaliza para a string normalizada
      // Ambos são normalizados igualmente, então devem corresponder
      expect(isRelationshipInGrade('pai', ['pai'])).toBe(true);
    });

    it('retorna false quando dependente não está na lista de beneficiários', () => {
      expect(isRelationshipInGrade('sobrinho', ['filho', 'conjuge'])).toBe(false);
    });

    it('trata "pai e mae" como grupo cobrindo pai', () => {
      expect(isRelationshipInGrade('pai', ['pai e mae'])).toBe(true);
    });

    it('trata "pai e mae" como grupo cobrindo mae', () => {
      expect(isRelationshipInGrade('mae', ['pai e mae'])).toBe(true);
    });

    it('trata "filhos e netos" como grupo cobrindo filho', () => {
      expect(isRelationshipInGrade('filho', ['filhos e netos'])).toBe(true);
    });

    it('trata "filhos e netos" como grupo cobrindo neto', () => {
      expect(isRelationshipInGrade('neto', ['filhos e netos'])).toBe(true);
    });

    it('trata "filhos" como grupo cobrindo filho', () => {
      expect(isRelationshipInGrade('filho', ['filhos'])).toBe(true);
    });

    it('trata "irmaos" como grupo cobrindo irmao', () => {
      expect(isRelationshipInGrade('irmao', ['irmaos'])).toBe(true);
    });

    it('nao enquadra sobrinho em grade especifica quando ele passa a seguir a regra de outro', () => {
      expect(isRelationshipInGrade('sobrinho', ['sobrinhos ate 50 anos'])).toBe(false);
    });

    it('mantem compatibilidade legada de 1° e 2° grau com a grade familiar', () => {
      expect(isRelationshipInGrade('1° Grau', ['Pai e Mãe'])).toBe(true);
      expect(isRelationshipInGrade('2° Grau', ['Irmãos'])).toBe(true);
    });

    it('trata "esposo a ate 55 anos" como grupo cobrindo conjuge', () => {
      expect(isRelationshipInGrade('conjuge', ['esposo a ate 55 anos'])).toBe(true);
    });

    it('trata "neto e bisnetos" como grupo cobrindo neto', () => {
      expect(isRelationshipInGrade('neto', ['neto e bisnetos'])).toBe(true);
    });

    it('trata "tio" como beneficiário direto quando o plano cobre esse parentesco', () => {
      expect(isRelationshipInGrade('tio', ['Tio(a)'])).toBe(true);
    });

    it('retorna false para null como dependente', () => {
      expect(isRelationshipInGrade(null, ['filho'])).toBe(false);
    });

    it('retorna true quando lista de beneficiários tem apenas strings vazias (considerada vazia)', () => {
      // Strings vazias são filtradas → lista vazia → plano aceita todos
      expect(isRelationshipInGrade('filho', ['', null, undefined])).toBe(true);
    });
  });
});
