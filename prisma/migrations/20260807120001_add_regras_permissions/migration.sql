IF DB_NAME() = N'planvita_bosque'
BEGIN
  IF NOT EXISTS (SELECT 1 FROM [dbo].[Permission] WHERE [name] = 'regras.view')
  BEGIN
    INSERT INTO [dbo].[Permission] ([name], [description], [createdAt], [updatedAt])
    VALUES ('regras.view', 'Visualizar regras de negócio', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
  END;

  IF NOT EXISTS (SELECT 1 FROM [dbo].[Permission] WHERE [name] = 'regras.update')
  BEGIN
    INSERT INTO [dbo].[Permission] ([name], [description], [createdAt], [updatedAt])
    VALUES ('regras.update', 'Criar e atualizar regras de negócio', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
  END;
END;
