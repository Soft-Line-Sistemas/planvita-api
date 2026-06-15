IF COL_LENGTH('BusinessRules', 'valorAdicionalDependenteForaGradeFaixasJson') IS NULL
BEGIN
  ALTER TABLE [dbo].[BusinessRules]
  ADD [valorAdicionalDependenteForaGradeFaixasJson] NVARCHAR(MAX) NULL;
END;

DECLARE @matrizPadrao NVARCHAR(MAX) = N'[
  {"idadeMaxima":60,"valor":9.9},
  {"idadeMaxima":70,"valor":19.9},
  {"idadeMaxima":80,"valor":29.9},
  {"idadeMaxima":null,"valor":49}
]';

IF COL_LENGTH('BusinessRules', 'valorAdicionalDependenteForaGradeFaixasJson') IS NOT NULL
BEGIN
  EXEC sp_executesql
    N'
      UPDATE [dbo].[BusinessRules]
      SET [valorAdicionalDependenteForaGradeFaixasJson] = @valor
      WHERE [valorAdicionalDependenteForaGradeFaixasJson] IS NULL
         OR LTRIM(RTRIM([valorAdicionalDependenteForaGradeFaixasJson])) = '''';
    ',
    N'@valor NVARCHAR(MAX)',
    @valor = @matrizPadrao;
END;
