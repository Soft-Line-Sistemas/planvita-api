-- AlterTable: add WhatsApp age-redirect fields to BusinessRules
IF COL_LENGTH('BusinessRules', 'redirecionamentoWhatsappAtivo') IS NULL
BEGIN
  ALTER TABLE [dbo].[BusinessRules]
  ADD [redirecionamentoWhatsappAtivo] BIT NULL CONSTRAINT [DF_BusinessRules_redir_wa_ativo] DEFAULT 0;
END;

IF COL_LENGTH('BusinessRules', 'redirecionamentoWhatsappNumero') IS NULL
BEGIN
  ALTER TABLE [dbo].[BusinessRules]
  ADD [redirecionamentoWhatsappNumero] NVARCHAR(50) NULL;
END;

IF COL_LENGTH('BusinessRules', 'redirecionamentoWhatsappIdadeMin') IS NULL
BEGIN
  ALTER TABLE [dbo].[BusinessRules]
  ADD [redirecionamentoWhatsappIdadeMin] INT NULL CONSTRAINT [DF_BusinessRules_redir_wa_idade_min] DEFAULT 18;
END;

IF COL_LENGTH('BusinessRules', 'redirecionamentoWhatsappIdadeMax') IS NULL
BEGIN
  ALTER TABLE [dbo].[BusinessRules]
  ADD [redirecionamentoWhatsappIdadeMax] INT NULL CONSTRAINT [DF_BusinessRules_redir_wa_idade_max] DEFAULT 65;
END;
