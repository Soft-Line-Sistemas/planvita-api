BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[BusinessRules] (
    [tenantId] NVARCHAR(1000) NOT NULL,
    [diasAvisoVencimento] INT,
    [diasAvisoPendencia] INT,
    [repeticaoPendenciaDias] INT,
    [diasSuspensaoPreventiva] INT,
    [diasSuspensao] INT,
    [diasPosSuspensao] INT,
    [avisoReajusteAnual] BIT,
    [diasAntesReajusteAnual] INT,
    [avisoRenovacaoAutomatica] BIT,
    [diasAntesRenovacao] INT,
    [permitirEstoqueNegativo] BIT,
    [notificarEstoqueBaixo] BIT,
    [quantidadeMinimaEstoque] INT,
    [notificarServicoPendente] BIT,
    [idadeMaximaDependente] INT,
    [limiteBeneficiarios] INT,
    [maximoBeneficiariosPorTipo] INT,
    [quilometragemMaxVeiculo] INT,
    [notificarManutencao] BIT,
    [intervaloManutencaoKm] INT,
    [intervaloManutencaoDias] INT,
    [diasAntesAvisoRenovacaoSepultamento] INT,
    [limiteTempoUsoSepultamento] INT,
    [notificarTaxaVencida] BIT,
    [tipoAvisoTaxaVencida] NVARCHAR(1000),
    [ativo] BIT CONSTRAINT [BusinessRules_ativo_df] DEFAULT 1,
    [criadoEm] DATETIME2 NOT NULL CONSTRAINT [BusinessRules_criadoEm_df] DEFAULT CURRENT_TIMESTAMP,
    [atualizadoEm] DATETIME2 NOT NULL,
    CONSTRAINT [BusinessRules_pkey] PRIMARY KEY CLUSTERED ([tenantId])
);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
