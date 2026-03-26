IF COL_LENGTH('Titular', 'situacaoConjugal') IS NULL
BEGIN
  ALTER TABLE [dbo].[Titular]
  ADD [situacaoConjugal] NVARCHAR(191) NULL;
END;

IF COL_LENGTH('Titular', 'profissao') IS NULL
BEGIN
  ALTER TABLE [dbo].[Titular]
  ADD [profissao] NVARCHAR(191) NULL;
END;

IF COL_LENGTH('Corresponsavel', 'situacaoConjugal') IS NULL
BEGIN
  ALTER TABLE [dbo].[Corresponsavel]
  ADD [situacaoConjugal] NVARCHAR(191) NULL;
END;

IF COL_LENGTH('Corresponsavel', 'profissao') IS NULL
BEGIN
  ALTER TABLE [dbo].[Corresponsavel]
  ADD [profissao] NVARCHAR(191) NULL;
END;

