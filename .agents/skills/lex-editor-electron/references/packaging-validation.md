# Empacotamento e validação

Use esta referência quando a mudança afetar build desktop, pacote, assinatura
ou controles que só podem ser verificados no artefato final.

## Empacotamento

- Fixe versões de dependências pelo mecanismo adotado no projeto e preserve o
  lockfile.
- Empacote o código da aplicação em ASAR quando compatível.
- Habilite e verifique os fuses de segurança adequados, incluindo validação de
  integridade do ASAR e carregamento apenas a partir do ASAR quando suportados
  pela configuração atual.
- Não inclua source maps, fixtures, credenciais, `.env`, chaves, arquivos de
  desenvolvimento ou conteúdo desnecessário no pacote público.
- Assine e, quando exigido pela plataforma/distribuição, notarize o artefato.
- Não adicione auto-update até existir feature ativa com origem, assinatura,
  política de rollback e UX especificadas.

Consulte a documentação atual do Electron e da ferramenta de empacotamento
antes de configurar opções ou fuses; nomes, suporte e defaults podem mudar.

## Validação mínima

Execute verificações proporcionais ao risco:

1. lint, typecheck e testes unitários relevantes;
2. testes de integração de IPC com payload inválido e remetente não confiável;
3. teste de navegação, nova janela e permissões negadas;
4. teste de XSS confirmando ausência de escalada para APIs privilegiadas;
5. build de produção e inicialização do artefato empacotado;
6. inspeção do conteúdo do pacote e busca por segredos;
7. inspeção dos fuses/configuração efetivamente gravados no binário;
8. verificação de assinatura/notarização quando aplicável.

Registre no fechamento da tarefa quais comandos foram executados e qualquer
limitação ambiental. Não marque um critério como validado apenas porque a
configuração fonte parece correta.

## Casos por integração

### Filesystem

Teste traversal, symlink, arquivo trocado, raiz não autorizada, tamanho
excessivo, falha parcial de gravação e ausência de caminho real nos DTOs.

### Rede

Teste loopback, faixa privada, DNS que muda, redirecionamento para destino
proibido, timeout, resposta grande e tipo inesperado.

### Git/processo

Teste argumentos maliciosos, branch/ref proibida, diretório fora do projeto,
falha parcial e ausência de shell/credenciais expostas.

## Fontes

- Electron ASAR Integrity:
  <https://www.electronjs.org/docs/latest/tutorial/asar-integrity>
- Electron Fuses:
  <https://www.electronjs.org/docs/latest/tutorial/fuses>
- Electron Code Signing:
  <https://www.electronjs.org/docs/latest/tutorial/code-signing>
- Estratégia do projeto: `spec/TEST_STRATEGY.md`
