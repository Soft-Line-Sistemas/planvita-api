-- AlterTable: adiciona coluna pagamento_confirmado_em no Titular
-- Registra o timestamp do primeiro pagamento confirmado pelo Asaas.
-- A carência do plano começa a contar a partir deste momento.
-- O acesso ao app (criação de senha) só é liberado após este campo ser preenchido.
ALTER TABLE "Titular" ADD "pagamento_confirmado_em" DATETIME2;
