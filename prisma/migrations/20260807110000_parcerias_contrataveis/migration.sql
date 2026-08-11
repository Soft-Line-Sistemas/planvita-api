IF COL_LENGTH('dbo.ParceriaVantagem', 'valorMensal') IS NULL
BEGIN
  ALTER TABLE [dbo].[ParceriaVantagem] ADD [valorMensal] FLOAT NULL CONSTRAINT [ParceriaVantagem_valorMensal_df] DEFAULT 0;
END;

IF COL_LENGTH('dbo.ParceriaVantagem', 'disponivelContratacao') IS NULL
BEGIN
  ALTER TABLE [dbo].[ParceriaVantagem] ADD [disponivelContratacao] BIT NOT NULL CONSTRAINT [ParceriaVantagem_disponivelContratacao_df] DEFAULT 0;
END;

-- Mantém a Telemedicina já oferecida no cadastro disponível após a evolução
-- para vantagens configuráveis pelo painel.
UPDATE [dbo].[ParceriaVantagem]
SET [valorMensal] = 19.90,
    [disponivelContratacao] = 1
WHERE [slug] = 'telemedicina';
