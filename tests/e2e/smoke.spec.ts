import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

// Lança o diretório do aplicativo, não o arquivo de entrada: assim o Electron
// lê o package.json e resolve `main`, nome e versão como faria no pacote.
// Apontar direto para o bundle faria `app.getVersion()` cair no fallback da
// versão do próprio Electron.
const appDirectory = fileURLToPath(new URL('../..', import.meta.url));

const inheritedEnvironment = (): Record<string, string> => {
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    // Sem ELECTRON_RENDERER_URL o main resolve a interface pelo arquivo local,
    // exatamente como no pacote de produção.
    if (key === 'ELECTRON_RENDERER_URL') {
      continue;
    }

    // Terminais embarcados em aplicativos Electron (VS Code, Claude Code)
    // exportam ELECTRON_RUN_AS_NODE=1. Herdar essa variável faria o binário
    // subir como Node puro, rejeitar as flags do Chromium e nunca abrir janela.
    if (key === 'ELECTRON_RUN_AS_NODE') {
      continue;
    }

    if (value !== undefined) {
      result[key] = value;
    }
  }

  return result;
};

let app: ElectronApplication;
let mainWindow: Page;

test.beforeAll(async () => {
  app = await electron.launch({ args: [appDirectory], env: inheritedEnvironment() });
  mainWindow = await app.firstWindow();
  await mainWindow.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  await app.close();
});

test('abre a janela principal com as três áreas do shell', async () => {
  await expect(mainWindow).toHaveTitle('Lex Editor');

  await expect(mainWindow.getByRole('heading', { name: 'Importação' })).toBeVisible();
  await expect(mainWindow.getByRole('heading', { name: 'Preview' })).toBeVisible();
  await expect(mainWindow.getByRole('heading', { name: 'Logs e validação' })).toBeVisible();
});

test('aplica as preferências seguras na janela real', async () => {
  const preferences = await app.evaluate(({ BrowserWindow }) => {
    const [window] = BrowserWindow.getAllWindows();

    if (!window) {
      return null;
    }

    // `getLastWebPreferences` devolve as preferências efetivamente aplicadas.
    // Ela existe em runtime no Electron 43, mas não consta de electron.d.ts;
    // o cast é o mínimo necessário para ler o valor real em vez de reafirmar a
    // configuração de origem, que o teste unitário já cobre.
    const contents = window.webContents as unknown as {
      getLastWebPreferences?: () => Record<string, unknown> | null;
    };

    return contents.getLastWebPreferences?.() ?? null;
  });

  expect(preferences).not.toBeNull();
  expect(preferences).toMatchObject({
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    webSecurity: true,
    webviewTag: false,
  });
});

test('não entrega Node, Electron ou ipcRenderer ao renderer', async () => {
  const reachable = await mainWindow.evaluate(() => {
    const globalScope = globalThis as unknown as Record<string, unknown>;

    return {
      require: typeof globalScope['require'],
      process: typeof globalScope['process'],
      module: typeof globalScope['module'],
      ipcRenderer: typeof globalScope['ipcRenderer'],
      electron: typeof globalScope['electron'],
      // A ponte não pode vazar o objeto bruto por baixo da API nomeada.
      bridgeKeys: Object.keys(globalScope['lexDesktop'] ?? {}).sort(),
    };
  });

  expect(reachable.require).toBe('undefined');
  expect(reachable.process).toBe('undefined');
  expect(reachable.module).toBe('undefined');
  expect(reachable.ipcRenderer).toBe('undefined');
  expect(reachable.electron).toBe('undefined');
  expect(reachable.bridgeKeys).toEqual(['app', 'capabilities', 'version']);
});

test('expõe somente a capacidade declarada e ela responde', async () => {
  const bridge = await mainWindow.evaluate(async () => {
    const api = (globalThis as unknown as Record<string, unknown>)['lexDesktop'] as
      | {
          version: number;
          capabilities: readonly string[];
          app: { getVersion(): Promise<unknown> };
        }
      | undefined;

    if (!api) {
      return null;
    }

    return {
      version: api.version,
      capabilities: [...api.capabilities],
      appKeys: Object.keys(api.app).sort(),
      result: await api.app.getVersion(),
    };
  });

  expect(bridge).not.toBeNull();
  expect(bridge?.version).toBe(1);
  expect(bridge?.capabilities).toEqual(['app.getVersion']);
  expect(bridge?.appKeys).toEqual(['getVersion']);
  expect(bridge?.result).toEqual({ ok: true, value: { version: '0.1.0' } });
});

test('não vaza caminho real, segredo ou AST pela ponte', async () => {
  const payload = await mainWindow.evaluate(async () => {
    const api = (globalThis as unknown as Record<string, unknown>)['lexDesktop'] as {
      app: { getVersion(): Promise<unknown> };
    };

    return JSON.stringify(await api.app.getVersion());
  });

  // O DTO da única capacidade existente carrega apenas a versão. Qualquer
  // caminho de filesystem, token ou árvore normativa aqui seria violação da
  // ADR-007; este teste falha assim que um DTO futuro passar a vazá-los.
  expect(payload).not.toMatch(/\/home\/|[A-Za-z]:\\|\.\.\//);
  expect(payload).not.toMatch(/secret|token|password|senha|apikey|api_key/i);
  expect(payload).not.toMatch(/normaAst|blockId|sourceRef/i);
});

test('nega abertura de nova janela a partir do renderer', async () => {
  const opened = await mainWindow.evaluate(() => {
    // O escopo do `evaluate` é o do navegador; a tipagem do projeto é Node, por
    // isso `open` precisa ser declarada aqui.
    const browserScope = globalThis as unknown as { open(url: string): unknown };

    return browserScope.open('https://exemplo.invalido') !== null;
  });

  expect(opened).toBe(false);
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
});

test('mantém uma allowlist de canais IPC sem executor genérico', async () => {
  const registered = await app.evaluate(({ ipcMain }) => {
    const candidates = [
      'app:get-version',
      'execute',
      'shell',
      'readFile',
      'writeFile',
      'git',
      'supabase',
    ];

    // `ipcMain.handle` não aparece em `listenerCount`, que só conta listeners de
    // evento. Registrar duas vezes o mesmo canal lança — é essa recusa que prova
    // a existência do handler. Onde o registro passa, o canal estava livre e o
    // handler de sondagem é removido em seguida.
    return candidates.filter((channel) => {
      try {
        ipcMain.handle(channel, () => null);
        ipcMain.removeHandler(channel);
        return false;
      } catch {
        return true;
      }
    });
  });

  expect(registered).toEqual(['app:get-version']);
});
