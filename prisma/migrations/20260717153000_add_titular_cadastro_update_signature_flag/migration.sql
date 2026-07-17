ALTER TABLE [dbo].[Titular]
ADD [atualizacao_cadastral_pendente_assinatura] BIT NOT NULL
    CONSTRAINT [Titular_atualizacao_cadastral_pendente_assinatura_df] DEFAULT 0;
