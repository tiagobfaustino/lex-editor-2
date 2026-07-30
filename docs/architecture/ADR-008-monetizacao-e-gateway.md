# ADR-008: Monetização, entitlements e gateway de pagamento

## Status

Aceito — 2026-07-30

## Contexto

O Vinculex atende inicialmente usuários brasileiros e precisa combinar uma
camada gratuita útil com assinatura recorrente de baixo atrito. A decisão não
pode depender apenas de esconder controles no cliente: limites de uso,
ativação, inadimplência e cancelamento alteram autorização e precisam ser
revalidados no servidor.

Stripe, Pagar.me, Iugu e Asaas foram considerados. Para o MVP, a prioridade é
operar em BRL, oferecer cartão e Pix, gerar cobranças recorrentes locais e
receber eventos que possam ser processados de forma idempotente. O Pix comum
não é débito recorrente automático: quando usado numa assinatura, cada
cobrança precisa ser paga pelo usuário.

## Decisão

### 1. Oferta do MVP

- O catálogo publicado, a leitura estruturada, a busca e o changelog são
  completos e gratuitos.
- O plano gratuito permite 20 favoritos e 5 notas existentes por usuário.
  Coleções, marcações, exportação, trilhas privadas, progresso completo e
  notificações personalizadas exigem Premium.
- Trilhas públicas podem ser lidas gratuitamente; ativação e progresso por
  trilha exigem Premium.
- Premium custa **R$ 19,90/mês** ou **R$ 199,00/ano**. Esses são preços de
  lista do MVP, em BRL, sem preço calculado no cliente.
- Cada conta com e-mail verificado recebe uma única avaliação Premium de 7
  dias, sem exigir pagamento. Ao fim, retorna ao plano gratuito, preservando
  dados já criados em modo somente leitura; novas mutações obedecem aos
  limites gratuitos.
- “Ilimitado” significa sem cota de produto pré-fixada, sujeito a proteção
  contra abuso e limites técnicos razoáveis documentados separadamente.

Preço e limites podem mudar em uma decisão futura versionada. Experimentos
comerciais nunca alteram silenciosamente os direitos de uma assinatura já
paga durante seu período vigente.

### 2. Gateway

O gateway do MVP é **Asaas**, com Checkout hospedado:

- cartão de crédito para renovação automática;
- Pix para cobrança mensal ou anual paga ativamente pelo usuário em cada
  ciclo;
- confirmação exclusivamente por evento verificado e reconciliação com a API
  do provedor; retorno do navegador não concede acesso;
- cancelamento encerra a renovação e mantém Premium até o fim do período pago;
- reembolso e contestação são tratados como eventos financeiros, não como
  edição manual de `subscription_status`.

Stripe não foi escolhido porque sua integração Pix comum declara não oferecer
pagamento recorrente. Pagar.me documenta assinatura por cartão ou boleto. O
Asaas documenta assinaturas com cartão, Pix ou boleto e identifica nas
cobranças o vínculo com a assinatura, atendendo melhor ao recorte brasileiro
do MVP. A escolha deve ser reavaliada se disponibilidade, contrato comercial,
custos ou confiabilidade operacional não forem aceitáveis antes do go-live.

### 3. Autoridade e entitlements

- Um catálogo versionado server-side define limites por plano. Frontend,
  mensagens comerciais e funções de mutação importam a mesma versão do
  contrato.
- Toda mutação limitada usa função/RPC transacional: bloqueia o usuário,
  revalida `account_status`, assinatura/período vigente, conta o recurso e
  grava ou rejeita atomicamente. “Contar no cliente e depois inserir” é
  proibido.
- Premium é concedido quando `trialing` e `now() < data_fim_trial`, ou quando
  `subscription_status IN ('active','past_due','canceled')` e
  `now() < data_proxima_renovacao`. Assim, cancelamento preserva o período já
  pago e inadimplência não cria carência implícita depois dele. `expired`
  nunca concede Premium.
- Downgrade não apaga favoritos, notas, marcações ou trilhas. Itens acima da
  cota ficam legíveis e removíveis; criação e edição que aumentem o uso ficam
  bloqueadas até o usuário reduzir a cota ou reativar Premium.
- `account_status = 'suspended'` sempre prevalece sobre entitlement financeiro.

### 4. Webhooks e reconciliação

- O endpoint valida `asaas-access-token` com comparação constante e, quando
  operacionalmente viável, restringe IPs oficiais. A API key do Asaas nunca é
  reutilizada como token de webhook.
- Entrega é tratada como *at least once*. `eventos_gateway_pagamento` reserva
  `(provedor, evento_id)` antes de enfileirar o trabalho; duplicatas retornam
  sucesso sem reaplicar efeitos.
- O handler persiste somente metadados allowlisted e hash do payload, responde
  `2xx` rapidamente e processa em fila. Payload integral, token e dados de
  cartão não entram em logs.
- O worker consulta o recurso na API do Asaas antes de alterar a assinatura,
  compara o instante do evento com o último estado aplicado e tolera eventos
  fora de ordem.
- Uma rotina de reconciliação periódica compara assinaturas em curso com o
  provedor. Webhook é o caminho rápido, não a única forma de recuperar
  divergências.

## Consequências

**Positivas**

- A oferta inicial fica implementável e testável sem decisões comerciais
  pendentes.
- Pix atende o público brasileiro sem ser confundido com débito automático.
- Idempotência, reconciliação e gates transacionais reduzem concessão indevida
  de acesso e corrida de cotas.

**Trade-offs aceitos**

- Usuários de Pix precisam concluir uma cobrança a cada ciclo.
- O MVP passa a depender do Asaas e de sua operação de webhooks/API.
- Preço e limites escolhidos são uma hipótese de produto e exigem medição de
  conversão, retenção e suporte.

## Referências

- [Asaas — Assinaturas](https://docs.asaas.com/docs/subscriptions)
- [Asaas — Criando uma assinatura](https://docs.asaas.com/docs/creating-a-subscription)
- [Asaas — Webhooks](https://docs.asaas.com/docs/about-webhooks)
- [Stripe — Pagamentos com Pix](https://docs.stripe.com/payments/pix?locale=pt-BR)
- [Pagar.me — Assinaturas](https://docs.pagar.me/docs/assinatura)
