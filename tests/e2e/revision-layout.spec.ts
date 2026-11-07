import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const appDirectory = fileURLToPath(new URL('../..', import.meta.url));

test('Lei 9.099 mantém preview e validação acessíveis após validar em duas larguras', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lex-revision-layout-'));
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) =>
        key !== 'ELECTRON_RENDERER_URL' && key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined,
    ),
  ) as Record<string, string>;
  const app = await electron.launch({
    args: [appDirectory],
    env: { ...env, XDG_CONFIG_HOME: root },
  });
  try {
    const window = await app.firstWindow();
    const errors: string[] = [];
    window.on('pageerror', (error) => {
      errors.push(error.message);
    });
    await app.evaluate(
      ({ dialog }, file) => {
        Object.defineProperty(dialog, 'showOpenDialog', {
          configurable: true,
          value: () => Promise.resolve({ canceled: false, filePaths: [file] }),
        });
      },
      join(appDirectory, 'fixtures/legal/l9099/snapshot.html'),
    );
    await window.getByRole('button', { name: 'Selecionar arquivo local' }).click();
    await expect(window.locator('.document-state')).toContainText('99 artigos');
    for (const width of [1280, 900]) {
      await window.setViewportSize({ width, height: 850 });
      await window.getByRole('button', { name: 'Validar revisão', exact: true }).click();
      await expect(window.locator('.editorial-toolbar')).toContainText('Validação completa');
      await expect(
        window.getByRole('button', { name: 'Validar revisão', exact: true }),
      ).toBeInViewport();
      const preview = await window.locator('#preview').boundingBox();
      const validation = await window.locator('.validation-panel').boundingBox();
      if (preview === null || validation === null) throw new Error('Painel desapareceu');
      await test.info().attach(`geometry-${String(width)}`, {
        body: JSON.stringify({ preview, validation, errors }),
        contentType: 'application/json',
      });
      await window.locator('#preview').scrollIntoViewIfNeeded();
      await window.screenshot({ path: test.info().outputPath(`revision-${String(width)}.png`) });
      expect(errors).toEqual([]);
      if (width === 1280) {
        expect(Math.abs(preview.y - validation.y)).toBeLessThan(3);
        expect(preview.width).toBeGreaterThan(validation.width);
      } else {
        expect(validation.y - preview.y - preview.height).toBeGreaterThanOrEqual(0);
        expect(validation.y - preview.y - preview.height).toBeLessThan(30);
        expect(Math.abs(preview.width - validation.width)).toBeLessThan(3);
      }
    }
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
