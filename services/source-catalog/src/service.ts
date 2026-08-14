import type {
  ActivateBindingRevisionRequest,
  CreateBindingRevisionRequest,
  CreateProviderRevisionRequest,
  DryRunBindingRevisionRequest,
  ChangeBindingActivationRequest,
  ListSourceCatalogRequest,
  RequestSourceCheckRequest,
  SourceCatalogAuthority,
} from './authority.js';

export interface SourceCatalogAuthenticator {
  authenticate(accessToken: string): Promise<Readonly<{ userId: string }> | null>;
}

export class SourceCatalogAuthenticationError extends Error {
  constructor() {
    super('Autenticação administrativa obrigatória.');
  }
}

const authenticatedUserId = async (
  authenticator: SourceCatalogAuthenticator,
  accessToken: string,
): Promise<string> => {
  const identity = await authenticator.authenticate(accessToken);
  if (identity === null) throw new SourceCatalogAuthenticationError();
  return identity.userId;
};

export const createSourceCatalogService = (options: {
  authenticator: SourceCatalogAuthenticator;
  authority: SourceCatalogAuthority;
}) => ({
  async listCatalog(accessToken: string, request: ListSourceCatalogRequest) {
    const actorUserId = await authenticatedUserId(options.authenticator, accessToken);
    return options.authority.listCatalog(actorUserId, request);
  },
  async createProviderRevision(accessToken: string, request: CreateProviderRevisionRequest) {
    const actorUserId = await authenticatedUserId(options.authenticator, accessToken);
    return options.authority.createProviderRevision(actorUserId, request);
  },
  async createBindingRevision(accessToken: string, request: CreateBindingRevisionRequest) {
    const actorUserId = await authenticatedUserId(options.authenticator, accessToken);
    return options.authority.createBindingRevision(actorUserId, request);
  },
  async dryRunBindingRevision(accessToken: string, request: DryRunBindingRevisionRequest) {
    const actorUserId = await authenticatedUserId(options.authenticator, accessToken);
    return options.authority.dryRunBindingRevision(actorUserId, request);
  },
  async activateBindingRevision(accessToken: string, request: ActivateBindingRevisionRequest) {
    const actorUserId = await authenticatedUserId(options.authenticator, accessToken);
    return options.authority.activateBindingRevision(actorUserId, request);
  },
  async pauseBinding(accessToken: string, request: ChangeBindingActivationRequest) {
    const actorUserId = await authenticatedUserId(options.authenticator, accessToken);
    return options.authority.pauseBinding(actorUserId, request);
  },
  async archiveBinding(accessToken: string, request: ChangeBindingActivationRequest) {
    const actorUserId = await authenticatedUserId(options.authenticator, accessToken);
    return options.authority.archiveBinding(actorUserId, request);
  },
  async restoreBindingRevision(accessToken: string, request: ActivateBindingRevisionRequest) {
    const actorUserId = await authenticatedUserId(options.authenticator, accessToken);
    return options.authority.restoreBindingRevision(actorUserId, request);
  },
  async requestSourceCheck(accessToken: string, request: RequestSourceCheckRequest) {
    const actorUserId = await authenticatedUserId(options.authenticator, accessToken);
    return options.authority.requestSourceCheck(actorUserId, request);
  },
});

export type SourceCatalogService = ReturnType<typeof createSourceCatalogService>;
