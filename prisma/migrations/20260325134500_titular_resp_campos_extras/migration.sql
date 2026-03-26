-- Titular extras
IF COL_LENGTH('Titular', 'sexo') IS NULL
BEGIN
  ALTER TABLE [dbo].[Titular] ADD [sexo] NVARCHAR(20) NULL;
END;
IF COL_LENGTH('Titular', 'rg') IS NULL
BEGIN
  ALTER TABLE [dbo].[Titular] ADD [rg] NVARCHAR(50) NULL;
END;
IF COL_LENGTH('Titular', 'naturalidade') IS NULL
BEGIN
  ALTER TABLE [dbo].[Titular] ADD [naturalidade] NVARCHAR(191) NULL;
END;
IF COL_LENGTH('Titular', 'pontoReferencia') IS NULL
BEGIN
  ALTER TABLE [dbo].[Titular] ADD [pontoReferencia] NVARCHAR(255) NULL;
END;

-- Corresponsável extras (pessoais)
IF COL_LENGTH('Corresponsavel', 'sexo') IS NULL
BEGIN
  ALTER TABLE [dbo].[Corresponsavel] ADD [sexo] NVARCHAR(20) NULL;
END;
IF COL_LENGTH('Corresponsavel', 'rg') IS NULL
BEGIN
  ALTER TABLE [dbo].[Corresponsavel] ADD [rg] NVARCHAR(50) NULL;
END;
IF COL_LENGTH('Corresponsavel', 'naturalidade') IS NULL
BEGIN
  ALTER TABLE [dbo].[Corresponsavel] ADD [naturalidade] NVARCHAR(191) NULL;
END;

-- Corresponsável endereço próprio
IF COL_LENGTH('Corresponsavel', 'cep') IS NULL
BEGIN
  ALTER TABLE [dbo].[Corresponsavel] ADD [cep] NVARCHAR(20) NULL;
END;
IF COL_LENGTH('Corresponsavel', 'uf') IS NULL
BEGIN
  ALTER TABLE [dbo].[Corresponsavel] ADD [uf] NVARCHAR(5) NULL;
END;
IF COL_LENGTH('Corresponsavel', 'cidade') IS NULL
BEGIN
  ALTER TABLE [dbo].[Corresponsavel] ADD [cidade] NVARCHAR(191) NULL;
END;
IF COL_LENGTH('Corresponsavel', 'bairro') IS NULL
BEGIN
  ALTER TABLE [dbo].[Corresponsavel] ADD [bairro] NVARCHAR(191) NULL;
END;
IF COL_LENGTH('Corresponsavel', 'logradouro') IS NULL
BEGIN
  ALTER TABLE [dbo].[Corresponsavel] ADD [logradouro] NVARCHAR(191) NULL;
END;
IF COL_LENGTH('Corresponsavel', 'complemento') IS NULL
BEGIN
  ALTER TABLE [dbo].[Corresponsavel] ADD [complemento] NVARCHAR(191) NULL;
END;
IF COL_LENGTH('Corresponsavel', 'numero') IS NULL
BEGIN
  ALTER TABLE [dbo].[Corresponsavel] ADD [numero] NVARCHAR(50) NULL;
END;
IF COL_LENGTH('Corresponsavel', 'pontoReferencia') IS NULL
BEGIN
  ALTER TABLE [dbo].[Corresponsavel] ADD [pontoReferencia] NVARCHAR(255) NULL;
END;

