IF COL_LENGTH('dbo.Titular', 'formaPagamentoAdesao') IS NULL
BEGIN
  ALTER TABLE [dbo].[Titular]
  ADD [formaPagamentoAdesao] NVARCHAR(50) NULL;
END;

IF COL_LENGTH('dbo.Titular', 'servicosAdicionaisJson') IS NULL
BEGIN
  ALTER TABLE [dbo].[Titular]
  ADD [servicosAdicionaisJson] NVARCHAR(MAX) NULL;
END;

IF COL_LENGTH('dbo.Titular', 'valorTotalContrato') IS NULL
BEGIN
  ALTER TABLE [dbo].[Titular]
  ADD [valorTotalContrato] FLOAT NULL;
END;
