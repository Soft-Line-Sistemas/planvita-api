BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[api_keys] (
    [id] NVARCHAR(1000) NOT NULL,
    [tenant_id] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(1000) NOT NULL,
    [key_hash] NVARCHAR(1000) NOT NULL,
    [is_active] BIT NOT NULL CONSTRAINT [api_keys_is_active_df] DEFAULT 1,
    [permissions] NVARCHAR(1000) NOT NULL CONSTRAINT [api_keys_permissions_df] DEFAULT '{}',
    [rate_limit] INT NOT NULL CONSTRAINT [api_keys_rate_limit_df] DEFAULT 100,
    [window_ms] INT NOT NULL CONSTRAINT [api_keys_window_ms_df] DEFAULT 900000,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [api_keys_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    [updated_at] DATETIME2 NOT NULL,
    [last_used_at] DATETIME2,
    CONSTRAINT [api_keys_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [api_keys_key_hash_key] UNIQUE NONCLUSTERED ([key_hash])
);

-- CreateTable
CREATE TABLE [dbo].[LayoutConfig] (
    [id] INT NOT NULL IDENTITY(1,1),
    [tenantId] NVARCHAR(1000) NOT NULL,
    [nomeTema] NVARCHAR(1000) NOT NULL CONSTRAINT [LayoutConfig_nomeTema_df] DEFAULT 'Padrão',
    [corPrimaria] NVARCHAR(1000) NOT NULL CONSTRAINT [LayoutConfig_corPrimaria_df] DEFAULT '#007bff',
    [corSecundaria] NVARCHAR(1000) NOT NULL CONSTRAINT [LayoutConfig_corSecundaria_df] DEFAULT '#6c757d',
    [corFundo] NVARCHAR(1000) NOT NULL CONSTRAINT [LayoutConfig_corFundo_df] DEFAULT '#ffffff',
    [corTexto] NVARCHAR(1000) NOT NULL CONSTRAINT [LayoutConfig_corTexto_df] DEFAULT '#000000',
    [corBotaoPrimario] NVARCHAR(1000) NOT NULL CONSTRAINT [LayoutConfig_corBotaoPrimario_df] DEFAULT '#007bff',
    [corBotaoSecundario] NVARCHAR(1000) NOT NULL CONSTRAINT [LayoutConfig_corBotaoSecundario_df] DEFAULT '#6c757d',
    [corLink] NVARCHAR(1000) NOT NULL CONSTRAINT [LayoutConfig_corLink_df] DEFAULT '#007bff',
    [fontePrimaria] NVARCHAR(1000) NOT NULL CONSTRAINT [LayoutConfig_fontePrimaria_df] DEFAULT 'Arial, sans-serif',
    [fonteSecundaria] NVARCHAR(1000),
    [tamanhoFonteBase] INT NOT NULL CONSTRAINT [LayoutConfig_tamanhoFonteBase_df] DEFAULT 14,
    [tamanhoFonteTitulo] INT NOT NULL CONSTRAINT [LayoutConfig_tamanhoFonteTitulo_df] DEFAULT 18,
    [logoUrl] NVARCHAR(1000),
    [faviconUrl] NVARCHAR(1000),
    [backgroundUrl] NVARCHAR(1000),
    [bordaRadius] INT CONSTRAINT [LayoutConfig_bordaRadius_df] DEFAULT 4,
    [sombraPadrao] NVARCHAR(1000) CONSTRAINT [LayoutConfig_sombraPadrao_df] DEFAULT '0px 2px 4px rgba(0,0,0,0.1)',
    [ativo] BIT NOT NULL CONSTRAINT [LayoutConfig_ativo_df] DEFAULT 1,
    [criadoEm] DATETIME2 NOT NULL CONSTRAINT [LayoutConfig_criadoEm_df] DEFAULT CURRENT_TIMESTAMP,
    [atualizadoEm] DATETIME2 NOT NULL,
    CONSTRAINT [LayoutConfig_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[Titular] (
    [id] INT NOT NULL IDENTITY(1,1),
    [nome] NVARCHAR(1000) NOT NULL,
    [email] NVARCHAR(1000) NOT NULL,
    [telefone] NVARCHAR(1000),
    [dataNascimento] DATETIME2 NOT NULL,
    [statusPlano] NVARCHAR(1000) NOT NULL,
    [dataContratacao] DATETIME2 NOT NULL,
    [vendedorId] INT,
    CONSTRAINT [Titular_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Titular_email_key] UNIQUE NONCLUSTERED ([email])
);

-- CreateTable
CREATE TABLE [dbo].[Dependente] (
    [id] INT NOT NULL IDENTITY(1,1),
    [titularId] INT NOT NULL,
    [nome] NVARCHAR(1000) NOT NULL,
    [dataNascimento] DATETIME2 NOT NULL,
    [tipoDependente] NVARCHAR(1000) NOT NULL,
    CONSTRAINT [Dependente_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[Corresponsavel] (
    [id] INT NOT NULL IDENTITY(1,1),
    [titularId] INT NOT NULL,
    [nome] NVARCHAR(1000) NOT NULL,
    [email] NVARCHAR(1000) NOT NULL,
    [telefone] NVARCHAR(1000),
    [relacionamento] NVARCHAR(1000) NOT NULL,
    CONSTRAINT [Corresponsavel_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[Plano] (
    [id] INT NOT NULL IDENTITY(1,1),
    [nome] NVARCHAR(1000) NOT NULL,
    [valorBase] FLOAT(53) NOT NULL,
    [idadeMaxima] INT NOT NULL,
    [coberturaMaxima] INT NOT NULL,
    [carenciaDias] INT NOT NULL,
    [vigenciaMeses] INT NOT NULL,
    [status] NVARCHAR(1000) NOT NULL,
    [beneficiarios] NVARCHAR(1000) NOT NULL,
    CONSTRAINT [Plano_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[BeneficiarioTipo] (
    [id] INT NOT NULL IDENTITY(1,1),
    [nome] NVARCHAR(1000) NOT NULL,
    [idadeMax] INT,
    CONSTRAINT [BeneficiarioTipo_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[PlanoBeneficiarioTipo] (
    [planoId] INT NOT NULL,
    [beneficiarioTipoId] INT NOT NULL,
    CONSTRAINT [PlanoBeneficiarioTipo_pkey] PRIMARY KEY CLUSTERED ([planoId],[beneficiarioTipoId])
);

-- CreateTable
CREATE TABLE [dbo].[Beneficio] (
    [id] INT NOT NULL IDENTITY(1,1),
    [nome] NVARCHAR(1000) NOT NULL,
    [tipo] NVARCHAR(1000) NOT NULL,
    [descricao] NVARCHAR(1000) NOT NULL,
    [valor] FLOAT(53),
    [validade] INT,
    CONSTRAINT [Beneficio_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[PlanoBeneficio] (
    [planoId] INT NOT NULL,
    [beneficioId] INT NOT NULL,
    CONSTRAINT [PlanoBeneficio_pkey] PRIMARY KEY CLUSTERED ([planoId],[beneficioId])
);

-- CreateTable
CREATE TABLE [dbo].[Pagamento] (
    [id] INT NOT NULL IDENTITY(1,1),
    [titularId] INT NOT NULL,
    [valor] FLOAT(53) NOT NULL,
    [dataPagamento] DATETIME2 NOT NULL,
    [status] NVARCHAR(1000) NOT NULL,
    [metodoPagamento] NVARCHAR(1000) NOT NULL,
    CONSTRAINT [Pagamento_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[Consultor] (
    [id] INT NOT NULL IDENTITY(1,1),
    [nome] NVARCHAR(1000) NOT NULL,
    [email] NVARCHAR(1000) NOT NULL,
    CONSTRAINT [Consultor_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[Comissao] (
    [id] INT NOT NULL IDENTITY(1,1),
    [vendedorId] INT NOT NULL,
    [titularId] INT NOT NULL,
    [valor] FLOAT(53) NOT NULL,
    [dataGeracao] DATETIME2 NOT NULL,
    [statusPagamento] NVARCHAR(1000) NOT NULL,
    CONSTRAINT [Comissao_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[Documento] (
    [id] INT NOT NULL IDENTITY(1,1),
    [titularId] INT NOT NULL,
    [tipoDocumento] NVARCHAR(1000) NOT NULL,
    [arquivoUrl] NVARCHAR(1000) NOT NULL,
    [dataUpload] DATETIME2 NOT NULL,
    CONSTRAINT [Documento_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [api_keys_is_active_idx] ON [dbo].[api_keys]([is_active]);

-- AddForeignKey
ALTER TABLE [dbo].[Titular] ADD CONSTRAINT [Titular_vendedorId_fkey] FOREIGN KEY ([vendedorId]) REFERENCES [dbo].[Consultor]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Dependente] ADD CONSTRAINT [Dependente_titularId_fkey] FOREIGN KEY ([titularId]) REFERENCES [dbo].[Titular]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[Corresponsavel] ADD CONSTRAINT [Corresponsavel_titularId_fkey] FOREIGN KEY ([titularId]) REFERENCES [dbo].[Titular]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[PlanoBeneficiarioTipo] ADD CONSTRAINT [PlanoBeneficiarioTipo_planoId_fkey] FOREIGN KEY ([planoId]) REFERENCES [dbo].[Plano]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[PlanoBeneficiarioTipo] ADD CONSTRAINT [PlanoBeneficiarioTipo_beneficiarioTipoId_fkey] FOREIGN KEY ([beneficiarioTipoId]) REFERENCES [dbo].[BeneficiarioTipo]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[PlanoBeneficio] ADD CONSTRAINT [PlanoBeneficio_planoId_fkey] FOREIGN KEY ([planoId]) REFERENCES [dbo].[Plano]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[PlanoBeneficio] ADD CONSTRAINT [PlanoBeneficio_beneficioId_fkey] FOREIGN KEY ([beneficioId]) REFERENCES [dbo].[Beneficio]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[Pagamento] ADD CONSTRAINT [Pagamento_titularId_fkey] FOREIGN KEY ([titularId]) REFERENCES [dbo].[Titular]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[Comissao] ADD CONSTRAINT [Comissao_vendedorId_fkey] FOREIGN KEY ([vendedorId]) REFERENCES [dbo].[Consultor]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Comissao] ADD CONSTRAINT [Comissao_titularId_fkey] FOREIGN KEY ([titularId]) REFERENCES [dbo].[Titular]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Documento] ADD CONSTRAINT [Documento_titularId_fkey] FOREIGN KEY ([titularId]) REFERENCES [dbo].[Titular]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
