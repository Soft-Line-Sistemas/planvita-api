import { getPrismaForTenant } from '../utils/prisma';

const TENANTS = ['PAX', 'LIDER', 'BOSQUE'] as const;

async function seedTenant(tenant: string) {
  const prisma = getPrismaForTenant(tenant);

  const categoria = await prisma.parceriaCategoria.upsert({
    where: { slug: 'servicos-adicionais' },
    update: { nome: 'Serviços adicionais', ativo: true, ordem: 1 },
    create: {
      nome: 'Serviços adicionais',
      slug: 'servicos-adicionais',
      descricao: 'Benefícios extras para clientes Planvita',
      ativo: true,
      ordem: 1,
    },
  });

  const parceiro = await prisma.parceiro.upsert({
    where: { slug: 'planvita-beneficios' },
    update: { nome: 'Planvita Benefícios', ativo: true, destaque: true, ordem: 1 },
    create: {
      nome: 'Planvita Benefícios',
      slug: 'planvita-beneficios',
      descricaoCurta: 'Rede de benefícios e serviços adicionais Planvita',
      ativo: true,
      destaque: true,
      ordem: 1,
    },
  });

  await prisma.parceriaVantagem.upsert({
    where: { slug: 'clube-de-beneficios' },
    update: {
      parceiroId: parceiro.id,
      categoriaId: categoria.id,
      titulo: 'Clube de benefícios',
      descricaoCurta: 'Descontos de até 40% em parceiros.',
      descricaoCompleta:
        'Acesso a uma rede de parceiros com descontos e vantagens exclusivas para clientes Planvita.',
      tipo: 'CONVENIO',
      publico: 'CLIENTES_ATIVOS',
      status: 'PUBLICADO',
      destaque: true,
      ordem: 1,
      validadeInicio: null,
      validadeFim: null,
      instrucoesResgate: 'Abra a vantagem no app e siga as instruções de uso.',
      regrasUso: 'Sujeito à disponibilidade dos parceiros conveniados.',
    },
    create: {
      parceiroId: parceiro.id,
      categoriaId: categoria.id,
      titulo: 'Clube de benefícios',
      slug: 'clube-de-beneficios',
      descricaoCurta: 'Descontos de até 40% em parceiros.',
      descricaoCompleta:
        'Acesso a uma rede de parceiros com descontos e vantagens exclusivas para clientes Planvita.',
      tipo: 'CONVENIO',
      publico: 'CLIENTES_ATIVOS',
      status: 'PUBLICADO',
      destaque: true,
      ordem: 1,
      instrucoesResgate: 'Abra a vantagem no app e siga as instruções de uso.',
      regrasUso: 'Sujeito à disponibilidade dos parceiros conveniados.',
    },
  });

  await prisma.parceriaVantagem.upsert({
    where: { slug: 'telemedicina' },
    update: {
      parceiroId: parceiro.id,
      categoriaId: categoria.id,
      titulo: 'Telemedicina',
      descricaoCurta: 'Atendimento médico à distância com profissionais qualificados.',
      descricaoCompleta:
        'Consultas online com profissionais qualificados por meio de parceiros habilitados.',
      tipo: 'SERVICO',
      publico: 'CLIENTES_ATIVOS',
      status: 'PUBLICADO',
      destaque: true,
      ordem: 2,
      validadeInicio: null,
      validadeFim: null,
      instrucoesResgate: 'Acesse pelo app para iniciar seu atendimento remoto.',
      regrasUso: 'Disponível para clientes com plano ativo.',
    },
    create: {
      parceiroId: parceiro.id,
      categoriaId: categoria.id,
      titulo: 'Telemedicina',
      slug: 'telemedicina',
      descricaoCurta: 'Atendimento médico à distância com profissionais qualificados.',
      descricaoCompleta:
        'Consultas online com profissionais qualificados por meio de parceiros habilitados.',
      tipo: 'SERVICO',
      publico: 'CLIENTES_ATIVOS',
      status: 'PUBLICADO',
      destaque: true,
      ordem: 2,
      instrucoesResgate: 'Acesse pelo app para iniciar seu atendimento remoto.',
      regrasUso: 'Disponível para clientes com plano ativo.',
    },
  });

  const total = await prisma.parceriaVantagem.count({ where: { status: 'PUBLICADO' } });
  console.log(`[${tenant}] seed concluído. Vantagens publicadas: ${total}`);
}

async function main() {
  for (const tenant of TENANTS) {
    await seedTenant(tenant);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await Promise.all(TENANTS.map((tenant) => getPrismaForTenant(tenant).$disconnect()));
  });
