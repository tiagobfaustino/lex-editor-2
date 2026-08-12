import type {
  ApproveLegislativeUpdateCommand,
  LegislativeUpdateCountsDto,
  LegislativeUpdateDecisionDto,
  LegislativeUpdateDetailDto,
  LegislativeUpdateIdCommand,
  LegislativeUpdateListDto,
  ListLegislativeUpdatesCommand,
  RejectLegislativeUpdateCommand,
} from '../../shared/ipc/updates.js';
import type { DesktopUpdateIpcCapabilities } from '../ipc/register.js';

export interface LegislativeUpdateReviewOperations {
  list(input: ListLegislativeUpdatesCommand): Promise<LegislativeUpdateListDto>;
  getDetail(input: LegislativeUpdateIdCommand): Promise<LegislativeUpdateDetailDto>;
  getCounts(): Promise<LegislativeUpdateCountsDto>;
  approve(input: ApproveLegislativeUpdateCommand): Promise<LegislativeUpdateDecisionDto>;
  reject(input: RejectLegislativeUpdateCommand): Promise<LegislativeUpdateDecisionDto>;
  reprocess(input: LegislativeUpdateIdCommand): Promise<LegislativeUpdateDecisionDto>;
}

export const createLegislativeUpdateDesktopCapabilities = (options: {
  operations: LegislativeUpdateReviewOperations;
}): DesktopUpdateIpcCapabilities => ({
  listUpdates: { authorize: () => true, handle: (input) => options.operations.list(input) },
  getUpdateDetail: {
    authorize: () => true,
    handle: (input) => options.operations.getDetail(input),
  },
  getUpdateCounts: { authorize: () => true, handle: () => options.operations.getCounts() },
  approveUpdate: { authorize: () => true, handle: (input) => options.operations.approve(input) },
  rejectUpdate: { authorize: () => true, handle: (input) => options.operations.reject(input) },
  reprocessUpdate: {
    authorize: () => true,
    handle: (input) => options.operations.reprocess(input),
  },
});
