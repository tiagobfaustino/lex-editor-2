import type {
  ActiveSourceImportConfiguration,
  LawSourceBinding,
  LawSourceBindingRevision,
  ProviderRevision,
  LawSourceArtifact,
  SourceProvider,
  SourceCheckRequestResult,
  SourceTestEvidence,
} from '@lex-editor/source-ingestion';

export interface ActiveSourceImportResolver {
  resolve(sourceUrl: string): Promise<ActiveSourceImportConfiguration | null>;
}

export type AppendProviderRevisionResult = Readonly<{
  provider: SourceProvider;
  revision: ProviderRevision;
}>;

export type AppendBindingRevisionResult = Readonly<{
  binding: LawSourceBinding;
  revision: LawSourceBindingRevision;
}>;

export type ActivateBindingRevisionInput = Readonly<{
  actorUserId: string;
  providerId: string;
  providerRevisionId: string;
  expectedProviderLockVersion: number;
  bindingId: string;
  bindingRevisionId: string;
  expectedBindingLockVersion: number;
  testEvidenceId: string;
}>;

export type SourceCatalogTestConfiguration = Readonly<{
  providerRevision: ProviderRevision;
  bindingRevision: LawSourceBindingRevision;
}>;

export type SourceDryRunExecution = Readonly<{
  sourceTestOutcome: 'success' | 'failure';
  completedStage: 'policy' | 'network' | 'detection' | 'adapter';
  evidenceDigest: string;
  errorCode: string | null;
}>;

export type SourceCatalogListItem = Readonly<{
  providerId: string;
  providerRevisionId: string;
  providerRevisionNumber: number;
  providerKey: string;
  providerName: string;
  adapterId: string;
  adapterContractVersion: number;
  providerLockVersion: number;
  bindingId: string;
  bindingRevisionId: string;
  bindingRevisionNumber: number;
  bindingLockVersion: number;
  lawId: string;
  lawTitle: string;
  sourceActivationState: 'draft' | 'active' | 'paused' | 'archived';
  sourceHealthState: 'unknown' | 'healthy' | 'degraded' | 'suspended';
  monitoringIntervalMs: number;
  lastSourceTestOutcome: 'success' | 'failure' | null;
  lastTestEvidenceId: string | null;
  lastTestedAt: string | null;
  lastCheckedAt: string | null;
  lastErrorCode: string | null;
  artifacts: readonly LawSourceArtifact[];
}>;

export type SourceCatalogPage = Readonly<{
  items: readonly SourceCatalogListItem[];
  nextCursor: string | null;
}>;

export type ChangeBindingActivationInput = Readonly<{
  actorUserId: string;
  bindingId: string;
  expectedBindingLockVersion: number;
  targetSourceActivationState: 'paused' | 'archived';
}>;

export type RequestSourceCheckInput = Readonly<{
  actorUserId: string;
  bindingId: string;
  idempotencyKey: string;
  requestedAt: string;
}>;

export interface SourceCatalogDryRunRunner {
  run(
    provider: ProviderRevision,
    binding: LawSourceBindingRevision,
  ): Promise<SourceDryRunExecution>;
}

export interface SourceCatalogRepository {
  listCatalog(
    actorUserId: string,
    cursor: string | null,
    limit: number,
  ): Promise<SourceCatalogPage>;
  getProviderRevision(actorUserId: string, providerRevisionId: string): Promise<ProviderRevision>;
  getTestConfiguration(
    actorUserId: string,
    providerRevisionId: string,
    bindingRevisionId: string,
  ): Promise<SourceCatalogTestConfiguration>;
  appendProviderRevision(
    revision: ProviderRevision,
    expectedLockVersion: number,
  ): Promise<AppendProviderRevisionResult>;
  appendBindingRevision(
    revision: LawSourceBindingRevision,
    expectedLockVersion: number,
  ): Promise<AppendBindingRevisionResult>;
  appendTestEvidence(evidence: SourceTestEvidence): Promise<SourceTestEvidence>;
  activateBindingRevision(input: ActivateBindingRevisionInput): Promise<
    Readonly<{
      provider: SourceProvider;
      binding: LawSourceBinding;
    }>
  >;
  restoreBindingRevision(input: ActivateBindingRevisionInput): Promise<
    Readonly<{
      provider: SourceProvider;
      binding: LawSourceBinding;
    }>
  >;
  changeBindingActivation(input: ChangeBindingActivationInput): Promise<LawSourceBinding>;
  requestSourceCheck(input: RequestSourceCheckInput): Promise<SourceCheckRequestResult>;
}
