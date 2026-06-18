IF COL_LENGTH('WhatsappAutomationConfig', 'timezone') IS NULL
BEGIN
  ALTER TABLE [dbo].[WhatsappAutomationConfig]
  ADD [timezone] NVARCHAR(60) NOT NULL CONSTRAINT [DF_WhatsappAutomationConfig_timezone] DEFAULT N'America/Bahia';
END;

IF COL_LENGTH('WhatsappAutomationConfig', 'quietHoursStart') IS NULL
BEGIN
  ALTER TABLE [dbo].[WhatsappAutomationConfig]
  ADD [quietHoursStart] NVARCHAR(5) NULL;
END;

IF COL_LENGTH('WhatsappAutomationConfig', 'quietHoursEnd') IS NULL
BEGIN
  ALTER TABLE [dbo].[WhatsappAutomationConfig]
  ADD [quietHoursEnd] NVARCHAR(5) NULL;
END;

IF COL_LENGTH('WhatsappAutomationConfig', 'sendOnWeekends') IS NULL
BEGIN
  ALTER TABLE [dbo].[WhatsappAutomationConfig]
  ADD [sendOnWeekends] BIT NOT NULL CONSTRAINT [DF_WhatsappAutomationConfig_sendOnWeekends] DEFAULT 0;
END;

IF COL_LENGTH('WhatsappAutomationConfig', 'minIntervalMinutes') IS NULL
BEGIN
  ALTER TABLE [dbo].[WhatsappAutomationConfig]
  ADD [minIntervalMinutes] INT NOT NULL CONSTRAINT [DF_WhatsappAutomationConfig_minIntervalMinutes] DEFAULT 240;
END;
