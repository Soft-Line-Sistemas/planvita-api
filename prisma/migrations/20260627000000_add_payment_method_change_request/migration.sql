CREATE TABLE [payment_method_change_requests] (
    [id] INT NOT NULL IDENTITY(1,1),
    [titularId] INT NOT NULL,
    [oldMethod] NVARCHAR(100),
    [newMethod] NVARCHAR(100) NOT NULL,
    [oldCardToken] NVARCHAR(MAX),
    [newCardToken] NVARCHAR(MAX),
    [asaasCustomerId] NVARCHAR(255),
    [asaasSubscriptionId] NVARCHAR(255),
    [status] NVARCHAR(50) NOT NULL,
    [errorMessage] NVARCHAR(MAX),
    [idempotencyKey] NVARCHAR(255),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [payment_method_change_requests_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [payment_method_change_requests_pkey] PRIMARY KEY CLUSTERED ([id])
);

CREATE UNIQUE INDEX [payment_method_change_requests_idempotencyKey_key]
    ON [payment_method_change_requests]([idempotencyKey])
    WHERE [idempotencyKey] IS NOT NULL;

CREATE INDEX [payment_method_change_requests_titularId_status_idx]
    ON [payment_method_change_requests]([titularId], [status]);

ALTER TABLE [payment_method_change_requests]
    ADD CONSTRAINT [payment_method_change_requests_titularId_fkey]
    FOREIGN KEY ([titularId]) REFERENCES [Titular]([id])
    ON DELETE NO ACTION ON UPDATE NO ACTION;
