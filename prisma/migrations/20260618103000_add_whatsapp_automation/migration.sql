IF OBJECT_ID(N'[dbo].[WhatsappAutomationConfig]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[WhatsappAutomationConfig] (
    [id] INT NOT NULL IDENTITY(1,1),
    [tenantId] NVARCHAR(100) NOT NULL,
    [enabled] BIT NOT NULL CONSTRAINT [DF_WhatsappAutomationConfig_enabled] DEFAULT 1,
    [useFallbackProvider] BIT NOT NULL CONSTRAINT [DF_WhatsappAutomationConfig_useFallbackProvider] DEFAULT 1,
    [defaultCountryCode] NVARCHAR(10) NOT NULL CONSTRAINT [DF_WhatsappAutomationConfig_defaultCountryCode] DEFAULT N'55',
    [sessionPath] NVARCHAR(255) NULL,
    [clientId] NVARCHAR(150) NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [DF_WhatsappAutomationConfig_createdAt] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL CONSTRAINT [DF_WhatsappAutomationConfig_updatedAt] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [PK_WhatsappAutomationConfig] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_WhatsappAutomationConfig_tenantId] UNIQUE NONCLUSTERED ([tenantId])
  );
END;

IF OBJECT_ID(N'[dbo].[WhatsappAutomationRule]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[WhatsappAutomationRule] (
    [id] INT NOT NULL IDENTITY(1,1),
    [configId] INT NOT NULL,
    [key] NVARCHAR(120) NOT NULL,
    [title] NVARCHAR(160) NOT NULL,
    [flow] NVARCHAR(80) NOT NULL,
    [enabled] BIT NOT NULL CONSTRAINT [DF_WhatsappAutomationRule_enabled] DEFAULT 1,
    [priority] INT NOT NULL CONSTRAINT [DF_WhatsappAutomationRule_priority] DEFAULT 100,
    [triggerType] NVARCHAR(30) NOT NULL CONSTRAINT [DF_WhatsappAutomationRule_triggerType] DEFAULT N'FLOW',
    [offsetDays] INT NOT NULL CONSTRAINT [DF_WhatsappAutomationRule_offsetDays] DEFAULT 0,
    [recurrenceDays] INT NULL,
    [sendTime] NVARCHAR(5) NOT NULL CONSTRAINT [DF_WhatsappAutomationRule_sendTime] DEFAULT N'09:00',
    [template] NVARCHAR(MAX) NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [DF_WhatsappAutomationRule_createdAt] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL CONSTRAINT [DF_WhatsappAutomationRule_updatedAt] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [PK_WhatsappAutomationRule] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UQ_WhatsappAutomationRule_key] UNIQUE NONCLUSTERED ([key]),
    CONSTRAINT [FK_WhatsappAutomationRule_configId] FOREIGN KEY ([configId]) REFERENCES [dbo].[WhatsappAutomationConfig]([id]) ON DELETE CASCADE ON UPDATE CASCADE
  );
END;

IF OBJECT_ID(N'[dbo].[WhatsappAutomationDispatch]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[WhatsappAutomationDispatch] (
    [id] INT NOT NULL IDENTITY(1,1),
    [tenantId] NVARCHAR(100) NOT NULL,
    [configId] INT NULL,
    [ruleId] INT NULL,
    [titularId] INT NULL,
    [contaReceberId] INT NULL,
    [recipient] NVARCHAR(160) NULL,
    [flow] NVARCHAR(80) NULL,
    [status] NVARCHAR(30) NOT NULL CONSTRAINT [DF_WhatsappAutomationDispatch_status] DEFAULT N'PENDING',
    [scheduledFor] DATETIME2 NULL,
    [attemptedAt] DATETIME2 NULL,
    [sentAt] DATETIME2 NULL,
    [errorMessage] NVARCHAR(MAX) NULL,
    [payloadPreview] NVARCHAR(MAX) NULL,
    [providerRef] NVARCHAR(160) NULL,
    [provider] NVARCHAR(30) NOT NULL CONSTRAINT [DF_WhatsappAutomationDispatch_provider] DEFAULT N'OWN',
    [triggerMode] NVARCHAR(30) NOT NULL CONSTRAINT [DF_WhatsappAutomationDispatch_triggerMode] DEFAULT N'MANUAL',
    [fallbackUsed] BIT NOT NULL CONSTRAINT [DF_WhatsappAutomationDispatch_fallbackUsed] DEFAULT 0,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [DF_WhatsappAutomationDispatch_createdAt] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [PK_WhatsappAutomationDispatch] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [FK_WhatsappAutomationDispatch_configId] FOREIGN KEY ([configId]) REFERENCES [dbo].[WhatsappAutomationConfig]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT [FK_WhatsappAutomationDispatch_ruleId] FOREIGN KEY ([ruleId]) REFERENCES [dbo].[WhatsappAutomationRule]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION
  );
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_WhatsappAutomationConfig_tenantId' AND object_id = OBJECT_ID(N'[dbo].[WhatsappAutomationConfig]'))
BEGIN
  CREATE NONCLUSTERED INDEX [IX_WhatsappAutomationConfig_tenantId]
  ON [dbo].[WhatsappAutomationConfig]([tenantId]);
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_WhatsappAutomationRule_configId' AND object_id = OBJECT_ID(N'[dbo].[WhatsappAutomationRule]'))
BEGIN
  CREATE NONCLUSTERED INDEX [IX_WhatsappAutomationRule_configId]
  ON [dbo].[WhatsappAutomationRule]([configId]);
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_WhatsappAutomationRule_flow_enabled_priority' AND object_id = OBJECT_ID(N'[dbo].[WhatsappAutomationRule]'))
BEGIN
  CREATE NONCLUSTERED INDEX [IX_WhatsappAutomationRule_flow_enabled_priority]
  ON [dbo].[WhatsappAutomationRule]([flow], [enabled], [priority]);
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_WhatsappAutomationDispatch_tenantId_createdAt' AND object_id = OBJECT_ID(N'[dbo].[WhatsappAutomationDispatch]'))
BEGIN
  CREATE NONCLUSTERED INDEX [IX_WhatsappAutomationDispatch_tenantId_createdAt]
  ON [dbo].[WhatsappAutomationDispatch]([tenantId], [createdAt]);
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_WhatsappAutomationDispatch_ruleId_status' AND object_id = OBJECT_ID(N'[dbo].[WhatsappAutomationDispatch]'))
BEGIN
  CREATE NONCLUSTERED INDEX [IX_WhatsappAutomationDispatch_ruleId_status]
  ON [dbo].[WhatsappAutomationDispatch]([ruleId], [status]);
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_WhatsappAutomationDispatch_titularId_createdAt' AND object_id = OBJECT_ID(N'[dbo].[WhatsappAutomationDispatch]'))
BEGIN
  CREATE NONCLUSTERED INDEX [IX_WhatsappAutomationDispatch_titularId_createdAt]
  ON [dbo].[WhatsappAutomationDispatch]([titularId], [createdAt]);
END;
