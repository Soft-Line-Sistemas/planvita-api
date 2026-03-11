IF COL_LENGTH('dbo.Consultor', 'percentualComissaoIndicacao') IS NULL
BEGIN
  ALTER TABLE [dbo].[Consultor]
  ADD [percentualComissaoIndicacao] FLOAT(53) NOT NULL
    CONSTRAINT [Consultor_percentualComissaoIndicacao_df] DEFAULT 0;
END
