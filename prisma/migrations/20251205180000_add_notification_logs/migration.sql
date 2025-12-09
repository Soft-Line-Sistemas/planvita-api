-- Tabela de logs de notificações recorrentes
CREATE TABLE [NotificationLog] (
    [id] INT IDENTITY(1,1) NOT NULL,
    [tenantId] NVARCHAR(255) NOT NULL,
    [logId] NVARCHAR(255) NULL,
    [titularId] INT NULL,
    [destinatario] NVARCHAR(255) NULL,
    [canal] NVARCHAR(50) NOT NULL,
    [status] NVARCHAR(50) NOT NULL,
    [motivo] NVARCHAR(2000) NULL,
    [payload] NVARCHAR(MAX) NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [NotificationLog_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [NotificationLog_pkey] PRIMARY KEY ([id])
);

CREATE INDEX [NotificationLog_tenantId_createdAt_idx] ON [NotificationLog]([tenantId], [createdAt]);
CREATE INDEX [NotificationLog_tenantId_logId_idx] ON [NotificationLog]([tenantId], [logId]);
