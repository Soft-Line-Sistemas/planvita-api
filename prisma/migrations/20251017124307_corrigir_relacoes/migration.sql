BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[Imposto] (
    [id] INT NOT NULL IDENTITY(1,1),
    [nome] NVARCHAR(1000) NOT NULL,
    [aliquota] FLOAT(53) NOT NULL,
    [tipo] NVARCHAR(1000) NOT NULL,
    [ativo] BIT NOT NULL CONSTRAINT [Imposto_ativo_df] DEFAULT 1,
    CONSTRAINT [Imposto_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[TaxaCartao] (
    [id] INT NOT NULL IDENTITY(1,1),
    [bandeira] NVARCHAR(1000) NOT NULL,
    [percentual] FLOAT(53) NOT NULL,
    [fixo] FLOAT(53),
    [ativo] BIT NOT NULL CONSTRAINT [TaxaCartao_ativo_df] DEFAULT 1,
    CONSTRAINT [TaxaCartao_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[ContaPagar] (
    [id] INT NOT NULL IDENTITY(1,1),
    [descricao] NVARCHAR(1000) NOT NULL,
    [valor] FLOAT(53) NOT NULL,
    [vencimento] DATETIME2 NOT NULL,
    [dataPagamento] DATETIME2,
    [status] NVARCHAR(1000) NOT NULL,
    [fornecedor] NVARCHAR(1000),
    CONSTRAINT [ContaPagar_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[ContaReceber] (
    [id] INT NOT NULL IDENTITY(1,1),
    [descricao] NVARCHAR(1000) NOT NULL,
    [valor] FLOAT(53) NOT NULL,
    [vencimento] DATETIME2 NOT NULL,
    [dataRecebimento] DATETIME2,
    [status] NVARCHAR(1000) NOT NULL,
    [clienteId] INT,
    CONSTRAINT [ContaReceber_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[Orcamento] (
    [id] INT NOT NULL IDENTITY(1,1),
    [clienteId] INT,
    [valorTotal] FLOAT(53) NOT NULL,
    [dataEmissao] DATETIME2 NOT NULL CONSTRAINT [Orcamento_dataEmissao_df] DEFAULT CURRENT_TIMESTAMP,
    [status] NVARCHAR(1000) NOT NULL,
    [observacao] NVARCHAR(1000),
    CONSTRAINT [Orcamento_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[Recibo] (
    [id] INT NOT NULL IDENTITY(1,1),
    [numero] NVARCHAR(1000) NOT NULL,
    [clienteId] INT,
    [valor] FLOAT(53) NOT NULL,
    [dataEmissao] DATETIME2 NOT NULL CONSTRAINT [Recibo_dataEmissao_df] DEFAULT CURRENT_TIMESTAMP,
    [descricao] NVARCHAR(1000),
    CONSTRAINT [Recibo_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Recibo_numero_key] UNIQUE NONCLUSTERED ([numero])
);

-- CreateTable
CREATE TABLE [dbo].[NotaFiscal] (
    [id] INT NOT NULL IDENTITY(1,1),
    [numero] NVARCHAR(1000) NOT NULL,
    [valorTotal] FLOAT(53) NOT NULL,
    [dataEmissao] DATETIME2 NOT NULL CONSTRAINT [NotaFiscal_dataEmissao_df] DEFAULT CURRENT_TIMESTAMP,
    [status] NVARCHAR(1000) NOT NULL,
    [chaveAcesso] NVARCHAR(1000),
    CONSTRAINT [NotaFiscal_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [NotaFiscal_numero_key] UNIQUE NONCLUSTERED ([numero])
);

-- CreateTable
CREATE TABLE [dbo].[Produto] (
    [id] INT NOT NULL IDENTITY(1,1),
    [nome] NVARCHAR(1000) NOT NULL,
    [descricao] NVARCHAR(1000),
    [quantidade] INT NOT NULL CONSTRAINT [Produto_quantidade_df] DEFAULT 0,
    [precoUnitario] FLOAT(53) NOT NULL,
    [tipo] NVARCHAR(1000) NOT NULL,
    [ativo] BIT NOT NULL CONSTRAINT [Produto_ativo_df] DEFAULT 1,
    CONSTRAINT [Produto_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[MovimentoEstoque] (
    [id] INT NOT NULL IDENTITY(1,1),
    [produtoId] INT NOT NULL,
    [tipo] NVARCHAR(1000) NOT NULL,
    [quantidade] INT NOT NULL,
    [dataMovimento] DATETIME2 NOT NULL CONSTRAINT [MovimentoEstoque_dataMovimento_df] DEFAULT CURRENT_TIMESTAMP,
    [observacao] NVARCHAR(1000),
    CONSTRAINT [MovimentoEstoque_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[Servico] (
    [id] INT NOT NULL IDENTITY(1,1),
    [nome] NVARCHAR(1000) NOT NULL,
    [descricao] NVARCHAR(1000),
    [custoBase] FLOAT(53) NOT NULL,
    [precoVenda] FLOAT(53) NOT NULL,
    [ativo] BIT NOT NULL CONSTRAINT [Servico_ativo_df] DEFAULT 1,
    CONSTRAINT [Servico_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[ServicoItem] (
    [id] INT NOT NULL IDENTITY(1,1),
    [servicoId] INT NOT NULL,
    [produtoId] INT,
    [quantidade] INT NOT NULL CONSTRAINT [ServicoItem_quantidade_df] DEFAULT 1,
    [custo] FLOAT(53),
    CONSTRAINT [ServicoItem_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[Falecido] (
    [id] INT NOT NULL IDENTITY(1,1),
    [nome] NVARCHAR(1000) NOT NULL,
    [dataFalecimento] DATETIME2,
    CONSTRAINT [Falecido_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[AutorizacaoLegal] (
    [id] INT NOT NULL IDENTITY(1,1),
    [falecidoId] INT NOT NULL,
    [responsavelId] INT,
    [tecnicoId] INT,
    [tipo] NVARCHAR(1000) NOT NULL,
    [dataAssinatura] DATETIME2 NOT NULL CONSTRAINT [AutorizacaoLegal_dataAssinatura_df] DEFAULT CURRENT_TIMESTAMP,
    [assinaturaUrl] NVARCHAR(1000),
    CONSTRAINT [AutorizacaoLegal_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[Veiculo] (
    [id] INT NOT NULL IDENTITY(1,1),
    [placa] NVARCHAR(1000) NOT NULL,
    [modelo] NVARCHAR(1000) NOT NULL,
    [ano] INT NOT NULL,
    [tipo] NVARCHAR(1000) NOT NULL,
    [ativo] BIT NOT NULL CONSTRAINT [Veiculo_ativo_df] DEFAULT 1,
    [quilometragemAtual] INT,
    CONSTRAINT [Veiculo_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Veiculo_placa_key] UNIQUE NONCLUSTERED ([placa])
);

-- CreateTable
CREATE TABLE [dbo].[Motorista] (
    [id] INT NOT NULL IDENTITY(1,1),
    [nome] NVARCHAR(1000) NOT NULL,
    [cpf] NVARCHAR(1000),
    [cnh] NVARCHAR(1000),
    [telefone] NVARCHAR(1000),
    [ativo] BIT NOT NULL CONSTRAINT [Motorista_ativo_df] DEFAULT 1,
    CONSTRAINT [Motorista_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[Manutencao] (
    [id] INT NOT NULL IDENTITY(1,1),
    [veiculoId] INT NOT NULL,
    [data] DATETIME2 NOT NULL,
    [descricao] NVARCHAR(1000) NOT NULL,
    [custo] FLOAT(53) NOT NULL,
    CONSTRAINT [Manutencao_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[Abastecimento] (
    [id] INT NOT NULL IDENTITY(1,1),
    [veiculoId] INT NOT NULL,
    [motoristaId] INT,
    [data] DATETIME2 NOT NULL,
    [litros] FLOAT(53) NOT NULL,
    [valorTotal] FLOAT(53) NOT NULL,
    CONSTRAINT [Abastecimento_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[Cemiterio] (
    [id] INT NOT NULL IDENTITY(1,1),
    [nome] NVARCHAR(1000) NOT NULL,
    [endereco] NVARCHAR(1000) NOT NULL,
    [cidade] NVARCHAR(1000) NOT NULL,
    [bairro] NVARCHAR(1000),
    [observacoes] NVARCHAR(1000),
    [ativo] BIT NOT NULL CONSTRAINT [Cemiterio_ativo_df] DEFAULT 1,
    CONSTRAINT [Cemiterio_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[TipoSepultamento] (
    [id] INT NOT NULL IDENTITY(1,1),
    [nome] NVARCHAR(1000) NOT NULL,
    [descricao] NVARCHAR(1000),
    [valor] FLOAT(53),
    CONSTRAINT [TipoSepultamento_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[Sepultamento] (
    [id] INT NOT NULL IDENTITY(1,1),
    [falecidoId] INT NOT NULL,
    [cemiterioId] INT NOT NULL,
    [tipoId] INT NOT NULL,
    [dataSepultamento] DATETIME2 NOT NULL,
    [observacoes] NVARCHAR(1000),
    CONSTRAINT [Sepultamento_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- AddForeignKey
ALTER TABLE [dbo].[ContaReceber] ADD CONSTRAINT [ContaReceber_clienteId_fkey] FOREIGN KEY ([clienteId]) REFERENCES [dbo].[Titular]([id]) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[Orcamento] ADD CONSTRAINT [Orcamento_clienteId_fkey] FOREIGN KEY ([clienteId]) REFERENCES [dbo].[Titular]([id]) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[Recibo] ADD CONSTRAINT [Recibo_clienteId_fkey] FOREIGN KEY ([clienteId]) REFERENCES [dbo].[Titular]([id]) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[MovimentoEstoque] ADD CONSTRAINT [MovimentoEstoque_produtoId_fkey] FOREIGN KEY ([produtoId]) REFERENCES [dbo].[Produto]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[ServicoItem] ADD CONSTRAINT [ServicoItem_servicoId_fkey] FOREIGN KEY ([servicoId]) REFERENCES [dbo].[Servico]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[ServicoItem] ADD CONSTRAINT [ServicoItem_produtoId_fkey] FOREIGN KEY ([produtoId]) REFERENCES [dbo].[Produto]([id]) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[AutorizacaoLegal] ADD CONSTRAINT [AutorizacaoLegal_falecidoId_fkey] FOREIGN KEY ([falecidoId]) REFERENCES [dbo].[Falecido]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[AutorizacaoLegal] ADD CONSTRAINT [AutorizacaoLegal_responsavelId_fkey] FOREIGN KEY ([responsavelId]) REFERENCES [dbo].[Corresponsavel]([id]) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[AutorizacaoLegal] ADD CONSTRAINT [AutorizacaoLegal_tecnicoId_fkey] FOREIGN KEY ([tecnicoId]) REFERENCES [dbo].[User]([id]) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[Manutencao] ADD CONSTRAINT [Manutencao_veiculoId_fkey] FOREIGN KEY ([veiculoId]) REFERENCES [dbo].[Veiculo]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[Abastecimento] ADD CONSTRAINT [Abastecimento_veiculoId_fkey] FOREIGN KEY ([veiculoId]) REFERENCES [dbo].[Veiculo]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[Abastecimento] ADD CONSTRAINT [Abastecimento_motoristaId_fkey] FOREIGN KEY ([motoristaId]) REFERENCES [dbo].[Motorista]([id]) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[Sepultamento] ADD CONSTRAINT [Sepultamento_falecidoId_fkey] FOREIGN KEY ([falecidoId]) REFERENCES [dbo].[Falecido]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[Sepultamento] ADD CONSTRAINT [Sepultamento_cemiterioId_fkey] FOREIGN KEY ([cemiterioId]) REFERENCES [dbo].[Cemiterio]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[Sepultamento] ADD CONSTRAINT [Sepultamento_tipoId_fkey] FOREIGN KEY ([tipoId]) REFERENCES [dbo].[TipoSepultamento]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
