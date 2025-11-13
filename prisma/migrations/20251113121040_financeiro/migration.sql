BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[BancoFinanceiro] (
    [id] INT NOT NULL IDENTITY(1,1),
    [nome] NVARCHAR(1000) NOT NULL,
    [agencia] NVARCHAR(1000),
    [conta] NVARCHAR(1000),
    [saldo] FLOAT(53) NOT NULL CONSTRAINT [BancoFinanceiro_saldo_df] DEFAULT 0,
    [ativo] BIT NOT NULL CONSTRAINT [BancoFinanceiro_ativo_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [BancoFinanceiro_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [BancoFinanceiro_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[TipoContabilFinanceiro] (
    [id] INT NOT NULL IDENTITY(1,1),
    [descricao] NVARCHAR(1000) NOT NULL,
    [natureza] NVARCHAR(1000),
    [ativo] BIT NOT NULL CONSTRAINT [TipoContabilFinanceiro_ativo_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [TipoContabilFinanceiro_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [TipoContabilFinanceiro_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[FormaPagamentoFinanceira] (
    [id] INT NOT NULL IDENTITY(1,1),
    [nome] NVARCHAR(1000) NOT NULL,
    [prazo] NVARCHAR(1000),
    [ativo] BIT NOT NULL CONSTRAINT [FormaPagamentoFinanceira_ativo_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [FormaPagamentoFinanceira_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [FormaPagamentoFinanceira_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[CentroResultadoFinanceiro] (
    [id] INT NOT NULL IDENTITY(1,1),
    [nome] NVARCHAR(1000) NOT NULL,
    [descricao] NVARCHAR(1000),
    [orcamento] FLOAT(53) NOT NULL CONSTRAINT [CentroResultadoFinanceiro_orcamento_df] DEFAULT 0,
    [ativo] BIT NOT NULL CONSTRAINT [CentroResultadoFinanceiro_ativo_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [CentroResultadoFinanceiro_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [CentroResultadoFinanceiro_pkey] PRIMARY KEY CLUSTERED ([id])
);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
