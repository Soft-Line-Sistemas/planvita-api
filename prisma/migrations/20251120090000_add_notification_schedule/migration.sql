-- Tabela para agendamento de notificações recorrentes
CREATE TABLE [NotificationSchedule] (
    [id] INT IDENTITY(1,1) NOT NULL,
    [tenantId] NVARCHAR(1000) NOT NULL,
    [frequenciaMinutos] INT NOT NULL CONSTRAINT [NotificationSchedule_frequenciaMinutos_df] DEFAULT 1440,
    [proximaExecucao] DATETIME2 NOT NULL,
    [ultimaExecucao] DATETIME2 NULL,
    [metodoPreferencial] NVARCHAR(1000) NOT NULL CONSTRAINT [NotificationSchedule_metodoPreferencial_df] DEFAULT N'whatsapp',
    [ativo] BIT NOT NULL CONSTRAINT [NotificationSchedule_ativo_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [NotificationSchedule_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL CONSTRAINT [NotificationSchedule_updatedAt_df] DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT [NotificationSchedule_pkey] PRIMARY KEY ([id])
);

-- Índice para facilitar busca por tenant e próxima execução
CREATE INDEX [NotificationSchedule_tenantId_proximaExecucao_idx]
ON [NotificationSchedule]([tenantId], [proximaExecucao]);

-- Flag para bloquear notificações recorrentes por titular
ALTER TABLE [Titular]
ADD [bloquearNotificacaoRecorrente] BIT NOT NULL CONSTRAINT [Titular_bloquearNotificacaoRecorrente_df] DEFAULT 0;

-- Método preferencial por titular (email | whatsapp)
ALTER TABLE [Titular]
ADD [metodoNotificacaoRecorrente] NVARCHAR(1000) NULL CONSTRAINT [Titular_metodoNotificacaoRecorrente_df] DEFAULT N'email';
