CREATE TABLE [NotificationTemplate] (
    [id] INT IDENTITY(1,1) NOT NULL,
    [tenantId] NVARCHAR(255) NOT NULL,
    [nome] NVARCHAR(255) NOT NULL,
    [canal] NVARCHAR(50) NOT NULL,
    [assunto] NVARCHAR(500) NULL,
    [htmlBody] NVARCHAR(MAX) NULL,
    [textBody] NVARCHAR(MAX) NULL,
    [anexos] NVARCHAR(MAX) NULL, -- JSON array de URLs
    [isDefault] BIT NOT NULL CONSTRAINT [NotificationTemplate_isDefault_df] DEFAULT 0,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [NotificationTemplate_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL CONSTRAINT [NotificationTemplate_updatedAt_df] DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT [NotificationTemplate_pkey] PRIMARY KEY ([id])
);

CREATE INDEX [NotificationTemplate_tenantId_canal_idx] ON [NotificationTemplate]([tenantId], [canal]);
CREATE INDEX [NotificationTemplate_tenantId_isDefault_idx] ON [NotificationTemplate]([tenantId], [isDefault]);
