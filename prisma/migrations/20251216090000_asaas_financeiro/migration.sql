-- Campos de integração com Asaas
ALTER TABLE [Titular]
ADD [asaasCustomerId] NVARCHAR(100) NULL;

CREATE UNIQUE INDEX [Titular_asaasCustomerId_key]
  ON [Titular]([asaasCustomerId]);

ALTER TABLE [Pagamento]
ADD [asaasPaymentId] NVARCHAR(100) NULL,
    [asaasSubscriptionId] NVARCHAR(100) NULL,
    [paymentUrl] NVARCHAR(500) NULL,
    [pixQrCode] NVARCHAR(MAX) NULL,
    [pixExpiration] DATETIME2 NULL,
    [dataVencimento] DATETIME2 NULL;

CREATE UNIQUE INDEX [Pagamento_asaasPaymentId_key]
  ON [Pagamento]([asaasPaymentId]);

ALTER TABLE [ContaReceber]
ADD [asaasPaymentId] NVARCHAR(100) NULL,
    [asaasSubscriptionId] NVARCHAR(100) NULL,
    [paymentUrl] NVARCHAR(500) NULL,
    [pixQrCode] NVARCHAR(MAX) NULL,
    [pixExpiration] DATETIME2 NULL,
    [metodoPagamento] NVARCHAR(50) NULL,
    [dataVencimento] DATETIME2 NULL;

CREATE UNIQUE INDEX [ContaReceber_asaasPaymentId_key]
  ON [ContaReceber]([asaasPaymentId]);
