-- Corrige a última faixa de adicional por dependente: R$ 49,00 para R$ 49,90.
UPDATE [dbo].[BusinessRules]
SET [valorAdicionalDependenteForaGradeFaixasJson] = REPLACE(
  [valorAdicionalDependenteForaGradeFaixasJson],
  '"valor":49}',
  '"valor":49.9}'
)
WHERE [valorAdicionalDependenteForaGradeFaixasJson] LIKE '%"valor":49}%';
