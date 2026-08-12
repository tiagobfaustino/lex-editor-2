import type {
  GetPublicationDiffCommand,
  ListPublicationHistoryCommand,
  PreparePublicationCommand,
  PrepareRollbackCommand,
  PublicationAttemptDto,
  PublicationConfirmationDto,
  PublicationDiffDto,
  PublicationHistoryPageDto,
  PublicationIdCommand,
} from '../../shared/ipc/publication.js';
import type { DesktopPublicationIpcCapabilities } from '../ipc/register.js';

export interface PublicationProjectAuthorizer {
  hasProject(projectId: string): Promise<boolean> | boolean;
  hasApprovedProject(projectId: string): Promise<boolean> | boolean;
}

export interface PublicationDesktopOperations {
  canAccessPublication(publicationId: string): Promise<boolean>;
  prepare(input: PreparePublicationCommand): Promise<PublicationConfirmationDto>;
  execute(publicationId: string): Promise<PublicationAttemptDto>;
  getAttempt(publicationId: string): Promise<PublicationAttemptDto>;
  retry(publicationId: string): Promise<PublicationAttemptDto>;
  listHistory(input: ListPublicationHistoryCommand): Promise<PublicationHistoryPageDto>;
  getDiff(input: GetPublicationDiffCommand): Promise<PublicationDiffDto>;
  prepareRollback(input: PrepareRollbackCommand): Promise<PublicationConfirmationDto>;
}

export const createPublicationDesktopCapabilities = (options: {
  projects: PublicationProjectAuthorizer;
  operations: PublicationDesktopOperations;
}): DesktopPublicationIpcCapabilities => {
  const preparedPublications = new Set<string>();
  const hasProject = (projectId: string) => options.projects.hasProject(projectId);
  const hasPublication = async (publicationId: string): Promise<boolean> =>
    preparedPublications.has(publicationId) ||
    options.operations.canAccessPublication(publicationId);

  const remember = (confirmation: PublicationConfirmationDto): PublicationConfirmationDto => {
    preparedPublications.add(confirmation.publicationId);
    return confirmation;
  };

  return {
    preparePublication: {
      authorize: ({ projectId }) => options.projects.hasApprovedProject(projectId),
      handle: async (input) => remember(await options.operations.prepare(input)),
    },
    executePublication: {
      authorize: ({ publicationId }) => hasPublication(publicationId),
      handle: ({ publicationId }: PublicationIdCommand) =>
        options.operations.execute(publicationId),
    },
    getPublicationAttempt: {
      authorize: ({ publicationId }) => hasPublication(publicationId),
      handle: ({ publicationId }: PublicationIdCommand) =>
        options.operations.getAttempt(publicationId),
    },
    retryPublication: {
      authorize: ({ publicationId }) => hasPublication(publicationId),
      handle: ({ publicationId }: PublicationIdCommand) => options.operations.retry(publicationId),
    },
    listPublicationHistory: {
      authorize: ({ projectId }) => hasProject(projectId),
      handle: (input) => options.operations.listHistory(input),
    },
    getPublicationDiff: {
      authorize: ({ projectId }) => hasProject(projectId),
      handle: (input) => options.operations.getDiff(input),
    },
    prepareRollback: {
      authorize: ({ projectId }) => hasProject(projectId),
      handle: async (input) => remember(await options.operations.prepareRollback(input)),
    },
  };
};
