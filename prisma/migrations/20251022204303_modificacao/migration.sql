/*
  Warnings:

  - You are about to drop the column `beneficiarios` on the `Plano` table. All the data in the column will be lost.
  - You are about to drop the column `status` on the `Plano` table. All the data in the column will be lost.
  - You are about to drop the column `valorBase` on the `Plano` table. All the data in the column will be lost.
  - Added the required column `assistenciaFuneral` to the `Plano` table without a default value. This is not possible if the table is not empty.
  - Added the required column `valorMensal` to the `Plano` table without a default value. This is not possible if the table is not empty.

*/
BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[Plano] ALTER COLUMN [idadeMaxima] INT NULL;
ALTER TABLE [dbo].[Plano] DROP COLUMN [beneficiarios],
[status],
[valorBase];
ALTER TABLE [dbo].[Plano] ADD [assistenciaFuneral] INT NOT NULL,
[ativo] BIT NOT NULL CONSTRAINT [Plano_ativo_df] DEFAULT 1,
[auxilioCemiterio] INT,
[receitaMensal] FLOAT(53) NOT NULL CONSTRAINT [Plano_receitaMensal_df] DEFAULT 0,
[taxaInclusaCemiterioPublico] BIT NOT NULL CONSTRAINT [Plano_taxaInclusaCemiterioPublico_df] DEFAULT 0,
[totalClientes] INT NOT NULL CONSTRAINT [Plano_totalClientes_df] DEFAULT 0,
[valorMensal] FLOAT(53) NOT NULL;

-- CreateTable
CREATE TABLE [dbo].[PlanoBeneficiario] (
    [id] INT NOT NULL IDENTITY(1,1),
    [planoId] INT NOT NULL,
    [nome] NVARCHAR(1000) NOT NULL,
    CONSTRAINT [PlanoBeneficiario_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[PlanoCobertura] (
    [id] INT NOT NULL IDENTITY(1,1),
    [planoId] INT NOT NULL,
    [tipo] NVARCHAR(1000) NOT NULL,
    [descricao] NVARCHAR(1000) NOT NULL,
    CONSTRAINT [PlanoCobertura_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- AddForeignKey
ALTER TABLE [dbo].[PlanoBeneficiario] ADD CONSTRAINT [PlanoBeneficiario_planoId_fkey] FOREIGN KEY ([planoId]) REFERENCES [dbo].[Plano]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[PlanoCobertura] ADD CONSTRAINT [PlanoCobertura_planoId_fkey] FOREIGN KEY ([planoId]) REFERENCES [dbo].[Plano]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
