IF COL_LENGTH('dbo.Consultor', 'valorComissaoIndicacao') IS NULL
BEGIN
  ALTER TABLE [dbo].[Consultor]
  ADD [valorComissaoIndicacao] FLOAT(53) NOT NULL
    CONSTRAINT [Consultor_valorComissaoIndicacao_df] DEFAULT 0;
END

IF COL_LENGTH('dbo.Comissao', 'contaPagarId') IS NULL
BEGIN
  ALTER TABLE [dbo].[Comissao]
  ADD [contaPagarId] INT;
END

IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = 'Comissao_contaPagarId_key'
    AND object_id = OBJECT_ID('dbo.Comissao')
)
BEGIN
  EXEC(N'CREATE UNIQUE INDEX [Comissao_contaPagarId_key]
    ON [dbo].[Comissao]([contaPagarId])
    WHERE [contaPagarId] IS NOT NULL');
END

IF NOT EXISTS (
  SELECT 1
  FROM sys.foreign_keys
  WHERE name = 'Comissao_contaPagarId_fkey'
    AND parent_object_id = OBJECT_ID('dbo.Comissao')
)
BEGIN
  ALTER TABLE [dbo].[Comissao]
  ADD CONSTRAINT [Comissao_contaPagarId_fkey]
  FOREIGN KEY ([contaPagarId]) REFERENCES [dbo].[ContaPagar]([id])
  ON DELETE NO ACTION ON UPDATE NO ACTION;
END
