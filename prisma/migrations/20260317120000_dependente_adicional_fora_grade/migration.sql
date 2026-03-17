-- Campos para controle de adicional por dependente fora da grade familiar
IF COL_LENGTH('Dependente', 'parentescoNormalizado') IS NULL
BEGIN
  ALTER TABLE [dbo].[Dependente]
  ADD [parentescoNormalizado] NVARCHAR(191) NULL;
END;

IF COL_LENGTH('Dependente', 'foraGradeFamiliar') IS NULL
BEGIN
  ALTER TABLE [dbo].[Dependente]
  ADD [foraGradeFamiliar] BIT NOT NULL
      CONSTRAINT [Dependente_foraGradeFamiliar_df] DEFAULT 0;
END;

IF COL_LENGTH('Dependente', 'excluirCobrancaAdicional') IS NULL
BEGIN
  ALTER TABLE [dbo].[Dependente]
  ADD [excluirCobrancaAdicional] BIT NOT NULL
      CONSTRAINT [Dependente_excluirCobrancaAdicional_df] DEFAULT 0;
END;

IF COL_LENGTH('Dependente', 'valorAdicionalMensal') IS NULL
BEGIN
  ALTER TABLE [dbo].[Dependente]
  ADD [valorAdicionalMensal] FLOAT NOT NULL
      CONSTRAINT [Dependente_valorAdicionalMensal_df] DEFAULT 0;
END;

-- Regras de negócio: valor padrão do adicional por dependente fora da grade
IF COL_LENGTH('BusinessRules', 'valorAdicionalDependenteForaGrade') IS NULL
BEGIN
  ALTER TABLE [dbo].[BusinessRules]
  ADD [valorAdicionalDependenteForaGrade] FLOAT NULL
      CONSTRAINT [BusinessRules_valorAdicionalDependenteForaGrade_df] DEFAULT 14.9;
END;

IF COL_LENGTH('BusinessRules', 'valorAdicionalDependenteForaGrade') IS NOT NULL
BEGIN
  EXEC('
    UPDATE [dbo].[BusinessRules]
    SET [valorAdicionalDependenteForaGrade] = 14.9
    WHERE [valorAdicionalDependenteForaGrade] IS NULL;
  ');
END;

-- Permissão para habilitar/desabilitar isenção do adicional no dependente
IF NOT EXISTS (
  SELECT 1 FROM [dbo].[Permission]
  WHERE [name] = 'dependente.toggle_adicional_cobranca'
)
BEGIN
  INSERT INTO [dbo].[Permission] ([name], [description], [createdAt], [updatedAt])
  VALUES (
    'dependente.toggle_adicional_cobranca',
    'Permite excluir/aplicar cobrança adicional de dependente fora da grade familiar.',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  );
END;

-- Vincula automaticamente a permissão ao admin_master
DECLARE @roleId INT = (
  SELECT TOP 1 [id] FROM [dbo].[Role] WHERE [name] = 'admin_master'
);
DECLARE @permissionId INT = (
  SELECT TOP 1 [id]
  FROM [dbo].[Permission]
  WHERE [name] = 'dependente.toggle_adicional_cobranca'
);

IF @roleId IS NOT NULL AND @permissionId IS NOT NULL
AND NOT EXISTS (
  SELECT 1 FROM [dbo].[RolePermission]
  WHERE [roleId] = @roleId AND [permissionId] = @permissionId
)
BEGIN
  INSERT INTO [dbo].[RolePermission] ([roleId], [permissionId])
  VALUES (@roleId, @permissionId);
END;
