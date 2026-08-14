import type { SourceCatalogPageDto } from '../../../../shared/ipc/sources.js';

export type AdapterCapability = SourceCatalogPageDto['adapterCapabilities'][number];

export type SourceDraft = Readonly<{
  providerKey: string;
  providerName: string;
  lawId: string;
  scheme: 'http' | 'https';
  host: string;
  pathPrefix: string;
  monitoringIntervalHours: string;
  primaryVariant: 'compiled' | 'annotated' | 'other';
  primaryUrl: string;
  auxiliaryEnabled: boolean;
  auxiliaryRole: 'historical_auxiliary' | 'cross_check';
  auxiliaryVariant: 'compiled' | 'annotated' | 'other';
  auxiliaryUrl: string;
  detectionParameters: Readonly<Record<string, boolean>>;
}>;

export type DraftField = keyof SourceDraft;
export type DraftErrors = Readonly<Partial<Record<DraftField, string>>>;

export const validateSourceDraft = (
  draft: SourceDraft,
  capability: AdapterCapability | null,
): DraftErrors => {
  const errors: Partial<Record<DraftField, string>> = {};
  if (capability === null) return { providerName: 'Nenhum adaptador instalado está disponível.' };
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(draft.providerKey))
    errors.providerKey = 'Use letras minúsculas, números e hífens.';
  if (draft.providerName.trim().length < 3)
    errors.providerName = 'Informe um nome com pelo menos 3 caracteres.';
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(draft.lawId)
  )
    errors.lawId = 'Informe o UUID da lei cadastrada.';
  if (!capability.allowedSchemes.includes(draft.scheme))
    errors.scheme = 'O adaptador não aceita este esquema.';
  if (!capability.allowedHosts.includes(draft.host))
    errors.host = `Use um host permitido: ${capability.allowedHosts.join(' ou ')}.`;
  if (
    !draft.pathPrefix.startsWith('/') ||
    draft.pathPrefix.includes('?') ||
    draft.pathPrefix.includes('#')
  )
    errors.pathPrefix = 'Use um prefixo iniciado por “/”, sem consulta ou fragmento.';
  const interval = Number(draft.monitoringIntervalHours);
  if (!Number.isInteger(interval) || interval < 1 || interval > 744)
    errors.monitoringIntervalHours = 'Escolha entre 1 e 744 horas.';
  const urls: readonly Readonly<{
    field: 'primaryUrl' | 'auxiliaryUrl';
    value: string;
  }>[] = [
    { field: 'primaryUrl', value: draft.primaryUrl },
    ...(draft.auxiliaryEnabled
      ? ([{ field: 'auxiliaryUrl', value: draft.auxiliaryUrl }] as const)
      : []),
  ];
  for (const { field, value } of urls) {
    try {
      const url = new URL(value);
      if (
        url.username.length > 0 ||
        url.password.length > 0 ||
        url.hash.length > 0 ||
        url.protocol !== `${draft.scheme}:` ||
        url.hostname !== draft.host ||
        !(url.pathname === draft.pathPrefix || url.pathname.startsWith(draft.pathPrefix))
      ) {
        errors[field] = 'A URL deve respeitar esquema, host e prefixo configurados.';
      }
    } catch {
      errors[field] = 'Informe uma URL oficial completa.';
    }
  }
  if (draft.auxiliaryEnabled && draft.auxiliaryUrl === draft.primaryUrl)
    errors.auxiliaryUrl = 'A URL auxiliar deve ser diferente da primária.';
  return errors;
};
