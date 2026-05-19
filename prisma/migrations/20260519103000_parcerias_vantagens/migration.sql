IF OBJECT_ID(N'[dbo].[ParceriaCategoria]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[ParceriaCategoria] (
    [id] INT NOT NULL IDENTITY(1,1),
    [nome] NVARCHAR(191) NOT NULL,
    [slug] NVARCHAR(191) NOT NULL,
    [descricao] NVARCHAR(1000) NULL,
    [icone] NVARCHAR(191) NULL,
    [ordem] INT NOT NULL CONSTRAINT [ParceriaCategoria_ordem_df] DEFAULT 0,
    [ativo] BIT NOT NULL CONSTRAINT [ParceriaCategoria_ativo_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [ParceriaCategoria_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [ParceriaCategoria_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [ParceriaCategoria_slug_key] UNIQUE NONCLUSTERED ([slug])
  );
END;

IF OBJECT_ID(N'[dbo].[Parceiro]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[Parceiro] (
    [id] INT NOT NULL IDENTITY(1,1),
    [nome] NVARCHAR(191) NOT NULL,
    [slug] NVARCHAR(191) NOT NULL,
    [descricaoCurta] NVARCHAR(1000) NULL,
    [descricaoCompleta] NVARCHAR(MAX) NULL,
    [logoUrl] NVARCHAR(191) NULL,
    [bannerUrl] NVARCHAR(191) NULL,
    [siteUrl] NVARCHAR(191) NULL,
    [whatsapp] NVARCHAR(40) NULL,
    [telefone] NVARCHAR(40) NULL,
    [email] NVARCHAR(191) NULL,
    [endereco] NVARCHAR(191) NULL,
    [cidade] NVARCHAR(191) NULL,
    [uf] NVARCHAR(10) NULL,
    [ativo] BIT NOT NULL CONSTRAINT [Parceiro_ativo_df] DEFAULT 1,
    [destaque] BIT NOT NULL CONSTRAINT [Parceiro_destaque_df] DEFAULT 0,
    [ordem] INT NOT NULL CONSTRAINT [Parceiro_ordem_df] DEFAULT 0,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Parceiro_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Parceiro_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Parceiro_slug_key] UNIQUE NONCLUSTERED ([slug])
  );
END;

IF OBJECT_ID(N'[dbo].[ParceriaVantagem]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[ParceriaVantagem] (
    [id] INT NOT NULL IDENTITY(1,1),
    [parceiroId] INT NOT NULL,
    [categoriaId] INT NULL,
    [titulo] NVARCHAR(191) NOT NULL,
    [slug] NVARCHAR(191) NOT NULL,
    [descricaoCurta] NVARCHAR(1000) NULL,
    [descricaoCompleta] NVARCHAR(MAX) NULL,
    [tipo] NVARCHAR(100) NOT NULL,
    [valorDesconto] FLOAT NULL,
    [codigoCupom] NVARCHAR(191) NULL,
    [linkResgate] NVARCHAR(191) NULL,
    [instrucoesResgate] NVARCHAR(MAX) NULL,
    [regrasUso] NVARCHAR(MAX) NULL,
    [validadeInicio] DATETIME2 NULL,
    [validadeFim] DATETIME2 NULL,
    [publico] NVARCHAR(100) NOT NULL CONSTRAINT [ParceriaVantagem_publico_df] DEFAULT N'CLIENTES_ATIVOS',
    [status] NVARCHAR(100) NOT NULL CONSTRAINT [ParceriaVantagem_status_df] DEFAULT N'RASCUNHO',
    [destaque] BIT NOT NULL CONSTRAINT [ParceriaVantagem_destaque_df] DEFAULT 0,
    [ordem] INT NOT NULL CONSTRAINT [ParceriaVantagem_ordem_df] DEFAULT 0,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [ParceriaVantagem_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [ParceriaVantagem_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [ParceriaVantagem_slug_key] UNIQUE NONCLUSTERED ([slug])
  );
END;

IF OBJECT_ID(N'[dbo].[ParceriaVantagemPlano]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[ParceriaVantagemPlano] (
    [vantagemId] INT NOT NULL,
    [planoId] INT NOT NULL,
    CONSTRAINT [ParceriaVantagemPlano_pkey] PRIMARY KEY CLUSTERED ([vantagemId], [planoId])
  );
END;

IF OBJECT_ID(N'[dbo].[ParceriaVantagemResgate]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[ParceriaVantagemResgate] (
    [id] INT NOT NULL IDENTITY(1,1),
    [vantagemId] INT NOT NULL,
    [titularId] INT NOT NULL,
    [canal] NVARCHAR(100) NULL,
    [status] NVARCHAR(100) NOT NULL CONSTRAINT [ParceriaVantagemResgate_status_df] DEFAULT N'REGISTRADO',
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [ParceriaVantagemResgate_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [ParceriaVantagemResgate_pkey] PRIMARY KEY CLUSTERED ([id])
  );
END;

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'ParceriaVantagem_parceiroId_fkey')
BEGIN
  ALTER TABLE [dbo].[ParceriaVantagem]
  ADD CONSTRAINT [ParceriaVantagem_parceiroId_fkey]
  FOREIGN KEY ([parceiroId]) REFERENCES [dbo].[Parceiro]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;
END;

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'ParceriaVantagem_categoriaId_fkey')
BEGIN
  ALTER TABLE [dbo].[ParceriaVantagem]
  ADD CONSTRAINT [ParceriaVantagem_categoriaId_fkey]
  FOREIGN KEY ([categoriaId]) REFERENCES [dbo].[ParceriaCategoria]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;
END;

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'ParceriaVantagemPlano_vantagemId_fkey')
BEGIN
  ALTER TABLE [dbo].[ParceriaVantagemPlano]
  ADD CONSTRAINT [ParceriaVantagemPlano_vantagemId_fkey]
  FOREIGN KEY ([vantagemId]) REFERENCES [dbo].[ParceriaVantagem]([id]) ON DELETE CASCADE ON UPDATE CASCADE;
END;

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'ParceriaVantagemPlano_planoId_fkey')
BEGIN
  ALTER TABLE [dbo].[ParceriaVantagemPlano]
  ADD CONSTRAINT [ParceriaVantagemPlano_planoId_fkey]
  FOREIGN KEY ([planoId]) REFERENCES [dbo].[Plano]([id]) ON DELETE CASCADE ON UPDATE CASCADE;
END;

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'ParceriaVantagemResgate_vantagemId_fkey')
BEGIN
  ALTER TABLE [dbo].[ParceriaVantagemResgate]
  ADD CONSTRAINT [ParceriaVantagemResgate_vantagemId_fkey]
  FOREIGN KEY ([vantagemId]) REFERENCES [dbo].[ParceriaVantagem]([id]) ON DELETE CASCADE ON UPDATE CASCADE;
END;

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'ParceriaVantagemResgate_titularId_fkey')
BEGIN
  ALTER TABLE [dbo].[ParceriaVantagemResgate]
  ADD CONSTRAINT [ParceriaVantagemResgate_titularId_fkey]
  FOREIGN KEY ([titularId]) REFERENCES [dbo].[Titular]([id]) ON DELETE CASCADE ON UPDATE CASCADE;
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ParceriaVantagem_status_destaque_ordem_idx')
BEGIN
  CREATE NONCLUSTERED INDEX [ParceriaVantagem_status_destaque_ordem_idx] ON [dbo].[ParceriaVantagem]([status], [destaque], [ordem]);
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ParceriaVantagem_categoriaId_idx')
BEGIN
  CREATE NONCLUSTERED INDEX [ParceriaVantagem_categoriaId_idx] ON [dbo].[ParceriaVantagem]([categoriaId]);
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ParceriaVantagem_parceiroId_idx')
BEGIN
  CREATE NONCLUSTERED INDEX [ParceriaVantagem_parceiroId_idx] ON [dbo].[ParceriaVantagem]([parceiroId]);
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ParceriaVantagemResgate_titularId_createdAt_idx')
BEGIN
  CREATE NONCLUSTERED INDEX [ParceriaVantagemResgate_titularId_createdAt_idx] ON [dbo].[ParceriaVantagemResgate]([titularId], [createdAt]);
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ParceriaVantagemResgate_vantagemId_createdAt_idx')
BEGIN
  CREATE NONCLUSTERED INDEX [ParceriaVantagemResgate_vantagemId_createdAt_idx] ON [dbo].[ParceriaVantagemResgate]([vantagemId], [createdAt]);
END;

IF NOT EXISTS (SELECT 1 FROM [dbo].[Permission] WHERE [name] = 'parcerias.view')
INSERT INTO [dbo].[Permission] ([name], [description], [createdAt], [updatedAt]) VALUES ('parcerias.view', 'Visualizar parcerias e vantagens', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
IF NOT EXISTS (SELECT 1 FROM [dbo].[Permission] WHERE [name] = 'parcerias.create')
INSERT INTO [dbo].[Permission] ([name], [description], [createdAt], [updatedAt]) VALUES ('parcerias.create', 'Criar parcerias e vantagens', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
IF NOT EXISTS (SELECT 1 FROM [dbo].[Permission] WHERE [name] = 'parcerias.update')
INSERT INTO [dbo].[Permission] ([name], [description], [createdAt], [updatedAt]) VALUES ('parcerias.update', 'Atualizar parcerias e vantagens', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
IF NOT EXISTS (SELECT 1 FROM [dbo].[Permission] WHERE [name] = 'parcerias.delete')
INSERT INTO [dbo].[Permission] ([name], [description], [createdAt], [updatedAt]) VALUES ('parcerias.delete', 'Excluir parcerias e vantagens', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

DECLARE @roleId INT = (SELECT TOP 1 [id] FROM [dbo].[Role] WHERE [name] = 'admin_master');

IF @roleId IS NOT NULL
BEGIN
  INSERT INTO [dbo].[RolePermission] ([roleId], [permissionId])
  SELECT @roleId, p.[id]
  FROM [dbo].[Permission] p
  WHERE p.[name] IN ('parcerias.view', 'parcerias.create', 'parcerias.update', 'parcerias.delete')
    AND NOT EXISTS (
      SELECT 1 FROM [dbo].[RolePermission] rp WHERE rp.[roleId] = @roleId AND rp.[permissionId] = p.[id]
    );
END;
