IF COL_LENGTH('dbo.ParceriaVantagem', 'valorMensal') IS NULL
BEGIN
  ALTER TABLE [dbo].[ParceriaVantagem] ADD [valorMensal] FLOAT NULL CONSTRAINT [ParceriaVantagem_valorMensal_df] DEFAULT 0;
END;

IF COL_LENGTH('dbo.ParceriaVantagem', 'disponivelContratacao') IS NULL
BEGIN
  ALTER TABLE [dbo].[ParceriaVantagem] ADD [disponivelContratacao] BIT NOT NULL CONSTRAINT [ParceriaVantagem_disponivelContratacao_df] DEFAULT 0;
END;
