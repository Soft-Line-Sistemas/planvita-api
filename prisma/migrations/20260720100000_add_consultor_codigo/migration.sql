IF COL_LENGTH('Consultor', 'codigo') IS NULL
BEGIN
  ALTER TABLE [dbo].[Consultor]
  ADD [codigo] NVARCHAR(20) NULL;
END;

IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = 'Consultor_codigo_key'
    AND object_id = OBJECT_ID(N'[dbo].[Consultor]')
)
BEGIN
  EXEC(N'
    CREATE UNIQUE NONCLUSTERED INDEX [Consultor_codigo_key]
      ON [dbo].[Consultor]([codigo])
      WHERE [codigo] IS NOT NULL;
  ');
END;
