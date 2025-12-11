SET QUOTED_IDENTIFIER ON;

-- Titular
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'Titular_asaasCustomerId_key')
  DROP INDEX Titular_asaasCustomerId_key ON Titular;
CREATE UNIQUE INDEX Titular_asaasCustomerId_key ON Titular(asaasCustomerId) WHERE asaasCustomerId IS NOT NULL;

-- Pagamento
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'Pagamento_asaasPaymentId_key')
  DROP INDEX Pagamento_asaasPaymentId_key ON Pagamento;
CREATE UNIQUE INDEX Pagamento_asaasPaymentId_key ON Pagamento(asaasPaymentId) WHERE asaasPaymentId IS NOT NULL;

-- ContaReceber
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ContaReceber_asaasPaymentId_key')
  DROP INDEX ContaReceber_asaasPaymentId_key ON ContaReceber;
CREATE UNIQUE INDEX ContaReceber_asaasPaymentId_key ON ContaReceber(asaasPaymentId) WHERE asaasPaymentId IS NOT NULL;