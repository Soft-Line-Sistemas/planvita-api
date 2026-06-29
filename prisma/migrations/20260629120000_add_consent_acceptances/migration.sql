CREATE TABLE [consent_acceptances] (
    [id] INT NOT NULL IDENTITY(1,1),
    [titularId] INT NOT NULL,
    [tenantId] NVARCHAR(255) NOT NULL,
    [termType] NVARCHAR(100) NOT NULL,
    [termVersion] NVARCHAR(100) NOT NULL,
    [origin] NVARCHAR(255) NOT NULL,
    [ipAddress] NVARCHAR(255),
    [acceptedAt] DATETIME2 NOT NULL CONSTRAINT [consent_acceptances_acceptedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [consent_acceptances_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [consent_acceptances_pkey] PRIMARY KEY CLUSTERED ([id])
);

CREATE INDEX [consent_acceptances_titularId_termType_acceptedAt_idx]
    ON [consent_acceptances]([titularId], [termType], [acceptedAt]);

CREATE INDEX [consent_acceptances_tenantId_acceptedAt_idx]
    ON [consent_acceptances]([tenantId], [acceptedAt]);

ALTER TABLE [consent_acceptances]
    ADD CONSTRAINT [consent_acceptances_titularId_fkey]
    FOREIGN KEY ([titularId]) REFERENCES [Titular]([id])
    ON DELETE NO ACTION ON UPDATE NO ACTION;
