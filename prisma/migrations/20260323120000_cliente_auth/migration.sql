IF OBJECT_ID(N'[dbo].[titular_credentials]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[titular_credentials] (
    [id] INT IDENTITY(1,1) NOT NULL,
    [titular_id] INT NOT NULL,
    [senha_hash] NVARCHAR(191) NULL,
    [email_verified] BIT NOT NULL CONSTRAINT [titular_credentials_email_verified_df] DEFAULT 0,
    [whatsapp_verified] BIT NOT NULL CONSTRAINT [titular_credentials_whatsapp_verified_df] DEFAULT 0,
    [last_login_at] DATETIME2 NULL,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [titular_credentials_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    [updated_at] DATETIME2 NOT NULL CONSTRAINT [titular_credentials_updated_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [titular_credentials_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [titular_credentials_titular_id_key] UNIQUE ([titular_id]),
    CONSTRAINT [titular_credentials_titular_id_fkey]
      FOREIGN KEY ([titular_id]) REFERENCES [dbo].[Titular]([id]) ON DELETE CASCADE
  );
END;

IF OBJECT_ID(N'[dbo].[titular_otps]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[titular_otps] (
    [id] UNIQUEIDENTIFIER NOT NULL CONSTRAINT [titular_otps_id_df] DEFAULT NEWID(),
    [titular_id] INT NOT NULL,
    [channel] NVARCHAR(20) NOT NULL,
    [purpose] NVARCHAR(50) NOT NULL,
    [code_hash] NVARCHAR(255) NOT NULL,
    [attempts] INT NOT NULL CONSTRAINT [titular_otps_attempts_df] DEFAULT 0,
    [expires_at] DATETIME2 NOT NULL,
    [consumed_at] DATETIME2 NULL,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [titular_otps_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [titular_otps_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [titular_otps_titular_id_fkey]
      FOREIGN KEY ([titular_id]) REFERENCES [dbo].[Titular]([id]) ON DELETE CASCADE
  );

  CREATE NONCLUSTERED INDEX [titular_otps_titular_id_purpose_expires_at_idx]
  ON [dbo].[titular_otps] ([titular_id], [purpose], [expires_at]);
END;

IF OBJECT_ID(N'[dbo].[titular_tokens]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[titular_tokens] (
    [id] UNIQUEIDENTIFIER NOT NULL CONSTRAINT [titular_tokens_id_df] DEFAULT NEWID(),
    [titular_id] INT NOT NULL,
    [type] NVARCHAR(50) NOT NULL,
    [purpose] NVARCHAR(50) NULL,
    [token_hash] NVARCHAR(64) NOT NULL,
    [expires_at] DATETIME2 NOT NULL,
    [consumed_at] DATETIME2 NULL,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [titular_tokens_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    [metadata] NVARCHAR(MAX) NULL,
    CONSTRAINT [titular_tokens_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [titular_tokens_token_hash_key] UNIQUE ([token_hash]),
    CONSTRAINT [titular_tokens_titular_id_fkey]
      FOREIGN KEY ([titular_id]) REFERENCES [dbo].[Titular]([id]) ON DELETE CASCADE
  );

  CREATE NONCLUSTERED INDEX [titular_tokens_titular_id_type_expires_at_idx]
  ON [dbo].[titular_tokens] ([titular_id], [type], [expires_at]);
END;

