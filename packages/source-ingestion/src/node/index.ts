export { defuddleSnapshot, SourceExtractionError } from './defuddle.js';
export type { DefuddledDocument } from './defuddle.js';

export {
  fetchConfiguredPlanaltoSourceSet,
  fetchPlanaltoSourceSet,
  isPlanaltoNetworkError,
  isPublicIpAddress,
  PLANALTO_ALLOWED_HOSTS,
  PLANALTO_NETWORK_LIMITS,
  PlanaltoNetworkError,
} from './planalto-source.js';
export type {
  FetchedPlanaltoArtifact,
  PlanaltoNetworkErrorCode,
  PlanaltoNetworkPorts,
  ResolvedAddress,
  TransportRequest,
  TransportResponse,
} from './planalto-source.js';

export { ingestConfiguredPlanaltoSourceSet } from './ingest.js';
export type { IngestedPlanaltoArtifact, IngestedPlanaltoSourceSet } from './ingest.js';

export { createNodeSourceDryRunRunner } from './dry-run.js';
export type { SourceDryRunExecution, SourceDryRunRunner } from './dry-run.js';
