export interface CadastroTitularRequest {
  consultorId?: number | null;
  step1: {
    nomeCompleto: string;
    cpf: string;
    dataNascimento: string;
    sexo: 'Masculino' | 'Feminino';
    rg?: string;
    naturalidade: string;
    telefone: string;
    whatsapp: string;
    email: string;
    situacaoConjugal: string;
    profissao: string;
  };
  step2: {
    cep: string;
    uf: string;
    cidade: string;
    bairro: string;
    logradouro: string;
    complemento?: string;
    numero: string;
    pontoReferencia: string;
  };
  step3: {
    usarMesmosDados: boolean;
    nomeCompleto?: string;
    cpf?: string;
    rg?: string;
    dataNascimento?: string;
    sexo?: 'Masculino' | 'Feminino';
    naturalidade?: string;
    parentesco?: string;
    email?: string;
    telefone?: string;
    whatsapp?: string;
    situacaoConjugal?: string;
    profissao?: string;
    cep?: string;
    uf?: string;
    cidade?: string;
    bairro?: string;
    logradouro?: string;
    complemento?: string;
    numero?: string;
    pontoReferencia?: string;
  };
  dependentes: {
    nome: string;
    idade: number;
    dataNascimento?: string | null;
    parentesco: string;
    telefone: string;
    cpf: string;
  }[];
  step5?: {
    planoId?: number | null;
  };
}
