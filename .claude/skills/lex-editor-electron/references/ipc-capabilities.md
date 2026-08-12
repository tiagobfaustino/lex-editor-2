# Capacidades IPC

Use esta referência para desenhar o contrato entre renderer, preload e main.

## Modelo

Prefira uma API pequena e orientada à intenção:

```ts
type LexDesktopApi = {
  app: {
    getVersion(): Promise<string>;
  };
  source: {
    selectLocal(input: { kind: "document" }): Promise<SourceSummary | null>;
    importUrl(input: { url: string }): Promise<SourceSummary>;
  };
  pipeline: {
    start(input: { sourceId: string; mode: PipelineMode }): Promise<{ jobId: string }>;
    onProgress(listener: (value: ProgressDto) => void): () => void;
  };
  export: {
    chooseDestination(input: { format: ExportFormat }): Promise<DestinationSummary | null>;
    write(input: { projectId: string; destinationId: string }): Promise<ExportResult>;
  };
};
```

Os nomes são exemplos de granularidade, não uma autorização para antecipar
features. Implemente somente as capacidades exigidas pela feature ativa.

## Preload

O preload adapta métodos individuais:

```ts
contextBridge.exposeInMainWorld("lexDesktop", {
  app: {
    getVersion: () => ipcRenderer.invoke("app:get-version"),
  },
  pipeline: {
    onProgress: (listener: (value: ProgressDto) => void) => {
      const handler = (_event: IpcRendererEvent, value: ProgressDto) => {
        listener(value);
      };
      ipcRenderer.on("pipeline:progress", handler);
      return () => ipcRenderer.removeListener("pipeline:progress", handler);
    },
  },
});
```

Não exponha `ipcRenderer`, o evento recebido ou um método genérico de
`invoke(channel, payload)`.

## Handler no main

Para cada canal:

1. valide `event.senderFrame`, o frame principal e a origem exata esperada;
2. valide o payload em runtime com esquema fechado e limites de tamanho;
3. autorize a capacidade conforme estado, projeto e recurso;
4. transforme IDs opacos em recursos privilegiados apenas no main;
5. execute o efeito;
6. devolva um DTO explícito ou erro sanitizado.

Centralize a checagem do remetente para que um handler novo não a esqueça.
Mantenha allowlists distintas e explícitas para desenvolvimento e produção.
Não autorize por prefixo textual de URL; faça parsing com `URL` e compare
protocolo, origem e frame.

## Regras de dados

DTOs podem conter IDs opacos, rótulos, enumerações, progresso, tamanhos e
estados necessários à interface. Não podem conter:

- caminho absoluto ou relativo do sistema;
- HTML bruto ou AST interno;
- objeto Electron, Node, stream ou função;
- token, cookie, chave, credencial ou ambiente protegido;
- stack trace ou mensagem de erro interna.

Use envelopes de erro pequenos e estáveis, por exemplo:

```ts
type DesktopErrorDto = {
  code: "INVALID_INPUT" | "NOT_ALLOWED" | "NOT_FOUND" | "FAILED";
  message: string;
  retryable: boolean;
};
```

## Checklist de revisão

- O renderer consegue escolher canal, caminho, comando ou host arbitrário?
- Um iframe ou conteúdo navegado consegue chamar a capacidade?
- Existe validação runtime além de tipos TypeScript?
- Há limites de tamanho, frequência e tempo?
- O callback vaza `IpcRendererEvent`?
- O retorno revela caminho, conteúdo interno ou segredo?
- Cancelamento e remoção de listeners estão definidos?
- Chamadas concorrentes e repetidas preservam o estado?

## Fontes

- Electron IPC:
  <https://www.electronjs.org/docs/latest/tutorial/ipc>
- Electron Context Isolation:
  <https://www.electronjs.org/docs/latest/tutorial/context-isolation>
- Electron contextBridge:
  <https://www.electronjs.org/docs/latest/api/context-bridge>
- Electron Security, validação de remetente:
  <https://www.electronjs.org/docs/latest/tutorial/security>
