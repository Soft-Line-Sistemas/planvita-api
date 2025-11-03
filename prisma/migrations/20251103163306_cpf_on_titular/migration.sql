/*
  Warnings:

  - You are about to drop the `PlanoBeneficio` table. If the table is not empty, all the data it contains will be lost.

*/
BEGIN TRY

BEGIN TRAN;

-- DropForeignKey
ALTER TABLE [dbo].[PlanoBeneficio] DROP CONSTRAINT [PlanoBeneficio_beneficioId_fkey];

-- DropForeignKey
ALTER TABLE [dbo].[PlanoBeneficio] DROP CONSTRAINT [PlanoBeneficio_planoId_fkey];

-- AlterTable
ALTER TABLE [dbo].[Titular] ADD [cpf] NVARCHAR(1000);

-- DropTable
DROP TABLE [dbo].[PlanoBeneficio];

-- CreateTable
CREATE TABLE [dbo].[Plano_Beneficio] (
    [plano_id] INT NOT NULL,
    [beneficio_id] INT NOT NULL,
    CONSTRAINT [Plano_Beneficio_pkey] PRIMARY KEY CLUSTERED ([plano_id],[beneficio_id])
);

-- AddForeignKey
ALTER TABLE [dbo].[Plano_Beneficio] ADD CONSTRAINT [Plano_Beneficio_plano_id_fkey] FOREIGN KEY ([plano_id]) REFERENCES [dbo].[Plano]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[Plano_Beneficio] ADD CONSTRAINT [Plano_Beneficio_beneficio_id_fkey] FOREIGN KEY ([beneficio_id]) REFERENCES [dbo].[Beneficio]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
