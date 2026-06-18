ALTER TABLE [dbo].[Corresponsavel]
ADD [cpf] NVARCHAR(191),
    [dataNascimento] DATETIME2;

ALTER TABLE [dbo].[Titular]
ADD [sucessao_titularidade_em] DATETIME2,
    [titular_anterior_nome] NVARCHAR(191),
    [titular_anterior_cpf] NVARCHAR(191);
