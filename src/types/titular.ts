export interface CadastroTitularRequest {
  step1: {
    nomeCompleto: string;
    cpf: string;
    dataNascimento: string;
    telefone: string;
    whatsapp: string;
    email: string;
  };
  step2: {
    cep: string;
    uf: string;
    cidade: string;
    bairro: string;
    logradouro: string;
    complemento?: string;
    numero: string;
  };
  step3: {
    usarMesmosDados: boolean;
    nomeCompleto?: string;
    cpf?: string;
    rg?: string;
    dataNascimento?: string;
    parentesco?: string;
    email?: string;
    telefone?: string;
    whatsapp?: string;
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
