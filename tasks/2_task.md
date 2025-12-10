# Task 2 — UI/Operação e Rollout: Financeiro sincronizado com Asaas

## Objetivo
Entregar experiência completa no painel `/painel/gestao/financeiro`, garantindo transparência de status Asaas, ações operacionais seguras e rollout controlado para o time financeiro.

## Entregáveis
- Ajustes de UI exibindo status/método Asaas, links/PIX e avisos de conflito para baixas manuais.
- Ação de reconsulta de status (pull do Asaas) e feedback de sincronização.
- Templates de notificação atualizados com link/PIX atual e método de pagamento.
- Observabilidade operacional (logs/métricas) e documentação de uso/rollback para o time financeiro.
- Plano de rollout por tenant com validação em ambiente controlado.

## Passos detalhados (ordem sugerida)
1) **UI do financeiro**
   - Listagens de `ContaReceber`/`Pagamento` mostram status e método vindos do Asaas, selo “Sincronizado Asaas” quando há `asaasPaymentId` e tooltip quando desatualizado.
   - Botões “Copiar link” e “Copiar PIX” usando `paymentUrl`/`pixQrCode`; fallback quando indisponível.
   - Alerta/confirm modal para baixa manual em cobranças sincronizadas, registrando auditoria.
2) **Ações de reconsulta**
   - Adicionar botão “Atualizar status” que chama serviço de reconsulta Asaas e refresca status/links; tratar erros com mensagens amigáveis.
   - Garantir debounce e bloqueio de spam; logar `tenantId`, `asaasPaymentId` e usuário que acionou.
3) **Notificações**
   - Atualizar templates/mensagens recorrentes para incluir `paymentUrl`/PIX e método de pagamento atual da fatura aberta.
   - Se não houver fatura aberta, gerar `paymentLink` via serviço e persistir antes de enviar.
4) **Observabilidade e operação**
   - Criar dashboards/logs com últimos webhooks recebidos, reconsultas e reconciliações, filtráveis por `tenantId`.
   - Alarmes para falhas de webhook/reconciliação e para aumento de divergências.
5) **Documentação e treinamento**
   - Guia rápido para financeiro: como copiar link/PIX, interpretar status, quando usar baixa manual, como acionar reconsulta.
   - Playbook de rollback: desabilitar feature por tenant/toggle e caminhos de mitigação.
6) **Rollout controlado**
   - Habilitar em ambiente de homologação com Asaas sandbox e validar casos críticos (criar/atualizar plano, pagamento confirmado, vencido, cancelado, reconsulta).
   - Liberar por tenant em produção via toggle, monitorando métricas/alertas nas primeiras 24–48h.

## Critérios de aceite
- UI exibe status, método e links/PIX do Asaas quando disponíveis, com ações de copiar funcionais.
- Baixas manuais em cobranças sincronizadas requerem confirmação e registram log/auditoria.
- Reconsulta atualiza status/links e retorna mensagens claras em caso de falha.
- Notificações enviam link/PIX atual da fatura aberta ou geram link antes de enviar.
- Dashboards/alertas configurados e guia operacional entregue ao time financeiro.
