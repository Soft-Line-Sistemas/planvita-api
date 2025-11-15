BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[AssinaturaDigital] (
    [id] INT NOT NULL IDENTITY(1,1),
    [titularId] INT NOT NULL,
    [tipo] NVARCHAR(1000) NOT NULL,
    [arquivoId] NVARCHAR(1000) NOT NULL,
    [arquivoUrl] NVARCHAR(1000) NOT NULL,
    [filename] NVARCHAR(1000) NOT NULL,
    [mimetype] NVARCHAR(1000),
    [size] INT,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [AssinaturaDigital_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [AssinaturaDigital_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [AssinaturaDigital_titularId_tipo_key] UNIQUE NONCLUSTERED ([titularId],[tipo])
);

-- AddForeignKey
ALTER TABLE [dbo].[AssinaturaDigital] ADD CONSTRAINT [AssinaturaDigital_titularId_fkey] FOREIGN KEY ([titularId]) REFERENCES [dbo].[Titular]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
