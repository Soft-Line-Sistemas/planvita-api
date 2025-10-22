USE planvita_lider;
GO

-- =============================================
-- Author:      Alan Alves
-- Create date: 2025-10-22
-- Description: Adiciona planos, beneficiários e coberturas
-- =============================================
CREATE OR ALTER PROCEDURE sp_InsertPlanos
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @PlanosTemp TABLE (
        id INT,
        nome VARCHAR(100)
    );

    -- -----------------------------
    -- Inserir Planos
    -- -----------------------------
    INSERT INTO Plano (
        nome, valorMensal, idadeMaxima, coberturaMaxima, carenciaDias, vigenciaMeses, 
        ativo, assistenciaFuneral, auxilioCemiterio, taxaInclusaCemiterioPublico
    )
    OUTPUT INSERTED.id, INSERTED.nome INTO @PlanosTemp(id, nome)
    VALUES
    ('Bosque Social', 49.99, 55, 10, 180, 60, 1, 2500, NULL, 1),
    ('Bosque Essencial', 69.90, 60, 10, 180, 60, 1, 2500, 3500, 0),
    ('Bosque Plus', 79.90, 70, 10, 180, 60, 1, 2500, 3500, 0),
    ('Bosque Família', 89.90, 80, 10, 180, 60, 1, 2500, 3500, 0),
    ('Bosque Sênior', 109.90, 85, 10, 180, 60, 1, 2500, 3500, 0),
    ('Bosque Premium', 129.90, NULL, 10, 180, 60, 1, 2500, 3500, 0);

    -- -----------------------------
    -- Inserir Beneficiários
    -- -----------------------------
    -- Bosque Social
    INSERT INTO PlanoBeneficiario (planoId, nome)
    SELECT id, v.beneficiario
    FROM @PlanosTemp p
    CROSS APPLY (VALUES
        ('Titular'),
        ('Esposo(a) até 55 anos'),
        ('Filhos e Netos')
    ) AS v(beneficiario)
    WHERE p.nome = 'Bosque Social';

    -- Bosque Essencial, Plus, Família, Sênior, Premium
    DECLARE @BeneficiariosCompletos TABLE (planoNome VARCHAR(100), beneficiario VARCHAR(100));
    INSERT INTO @BeneficiariosCompletos VALUES
        ('Bosque Essencial','Titular'),('Bosque Essencial','Pai e Mãe'),('Bosque Essencial','Cônjuge'),
        ('Bosque Essencial','Filhos'),('Bosque Essencial','Sogro(a)'),('Bosque Essencial','Neto e Bisnetos'),
        ('Bosque Essencial','Irmãos'),('Bosque Essencial','Sobrinhos até 50 anos'),
        ('Bosque Plus','Titular'),('Bosque Plus','Pai e Mãe'),('Bosque Plus','Cônjuge'),
        ('Bosque Plus','Filhos'),('Bosque Plus','Sogro(a)'),('Bosque Plus','Neto e Bisnetos'),
        ('Bosque Plus','Irmãos'),('Bosque Plus','Sobrinhos até 50 anos'),
        ('Bosque Família','Titular'),('Bosque Família','Pai e Mãe'),('Bosque Família','Cônjuge'),
        ('Bosque Família','Filhos'),('Bosque Família','Sogro(a)'),('Bosque Família','Neto e Bisnetos'),
        ('Bosque Família','Irmãos'),('Bosque Família','Sobrinhos até 50 anos'),
        ('Bosque Sênior','Titular'),('Bosque Sênior','Pai e Mãe'),('Bosque Sênior','Cônjuge'),
        ('Bosque Sênior','Filhos'),('Bosque Sênior','Sogro(a)'),('Bosque Sênior','Neto e Bisnetos'),
        ('Bosque Sênior','Irmãos'),('Bosque Sênior','Sobrinhos até 50 anos'),
        ('Bosque Premium','Titular'),('Bosque Premium','Pai e Mãe'),('Bosque Premium','Cônjuge'),
        ('Bosque Premium','Filhos'),('Bosque Premium','Sogro(a)'),('Bosque Premium','Neto e Bisnetos'),
        ('Bosque Premium','Irmãos'),('Bosque Premium','Sobrinhos até 50 anos');

    INSERT INTO PlanoBeneficiario (planoId, nome)
    SELECT p.id, b.beneficiario
    FROM @BeneficiariosCompletos b
    INNER JOIN @PlanosTemp p ON p.nome = b.planoNome;

    -- -----------------------------
    -- Inserir Coberturas (Exemplo)
    -- -----------------------------
    DECLARE @CoberturasPadrao TABLE (planoNome VARCHAR(100), tipo VARCHAR(50), descricao VARCHAR(100));
    INSERT INTO @CoberturasPadrao VALUES
        ('Bosque Social','servicosPadrao','Atendimento 24h'),
        ('Bosque Social','coberturaTranslado','Translado Nacional'),
        ('Bosque Social','servicosEspecificos','Cremação incluída'),
        ('Bosque Essencial','servicosPadrao','Atendimento 24h'),
        ('Bosque Essencial','coberturaTranslado','Translado Nacional'),
        ('Bosque Essencial','servicosEspecificos','Cremação incluída'),
        ('Bosque Plus','servicosPadrao','Atendimento 24h'),
        ('Bosque Plus','coberturaTranslado','Translado Nacional'),
        ('Bosque Plus','servicosEspecificos','Cremação incluída'),
        ('Bosque Família','servicosPadrao','Atendimento 24h'),
        ('Bosque Família','coberturaTranslado','Translado Nacional'),
        ('Bosque Família','servicosEspecificos','Cremação incluída'),
        ('Bosque Sênior','servicosPadrao','Atendimento 24h'),
        ('Bosque Sênior','coberturaTranslado','Translado Nacional'),
        ('Bosque Sênior','servicosEspecificos','Cremação incluída'),
        ('Bosque Premium','servicosPadrao','Atendimento 24h'),
        ('Bosque Premium','coberturaTranslado','Translado Nacional'),
        ('Bosque Premium','servicosEspecificos','Cremação incluída');

    INSERT INTO PlanoCobertura (planoId, tipo, descricao)
    SELECT p.id, c.tipo, c.descricao
    FROM @CoberturasPadrao c
    INNER JOIN @PlanosTemp p ON p.nome = c.planoNome;

    PRINT 'Planos, beneficiários e coberturas inseridos com sucesso!';
END;
GO

EXEC sp_InsertPlanos;
