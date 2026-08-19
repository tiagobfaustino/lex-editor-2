import { z } from 'zod';

import { identificar } from '../block-id/index.js';
import type { IdentifiedNormaAST, ParsedNormaAST } from '../ast/nodes.js';
import { identifiedNormaAstSchema, parsedNormaAstSchema } from '../ast/schemas.js';
import { reconciliar, registrarPublicacao } from '../reconciliation/index.js';
import {
  calculateRevisionHash,
  editorialCommandSchema,
  type EditorialCommand,
  type RevisionHash,
  type RevisionHashFunction,
} from './index.js';
import {
  validateLawMetadataChangesPolicy,
  type EditableLawMetadataChanges,
} from './frontmatter-metadata.js';
import {
  deriveMetadataWorkspace,
  type MetadataWorkspaceContext,
  type MetadataWorkspaceDerivatives,
} from './metadata-derivatives.js';
import {
  publicationHistoryStateFor,
  type PublicationHistoryEvidence,
} from './publication-history-authority.js';

export const editorialCommandErrorCodeSchema = z.enum([
  'invalid_command',
  'stale_revision',
  'target_not_found',
  'ambiguous_target',
  'field_not_allowed',
  'invalid_move',
  'pending_review_not_found',
  'invariant_violation',
  'identity_reconciliation_failed',
  'metadata_field_not_editable',
  'published_identity_immutable',
  'publication_history_required',
  'metadata_cross_field_invalid',
  'metadata_workspace_required',
  'metadata_derivation_failed',
  'no_change',
]);

export type EditorialCommandErrorCode = z.infer<typeof editorialCommandErrorCodeSchema>;

export type EditorialCommandResult =
  | Readonly<{
      ok: true;
      ast: IdentifiedNormaAST;
      revisionHash: RevisionHash;
      structuralChange: boolean;
      newAliases: readonly Readonly<{ antigo: string; novo: string }>[];
      missingPublishedBlockIds: readonly string[];
      metadataDerivatives?: MetadataWorkspaceDerivatives;
    }>
  | Readonly<{
      ok: false;
      error: Readonly<{
        code: EditorialCommandErrorCode;
        message: string;
      }>;
    }>;

type NodeRecord = Record<string, unknown>;

export interface ApplyEditorialCommandOptions {
  readonly publicationHistoryEvidence?: PublicationHistoryEvidence;
  readonly metadataWorkspace?: MetadataWorkspaceContext;
  /** Usado somente pelo replay de uma entrada já validada e ligada ao hash persistido. */
  readonly metadataReplayResultRevisionHash?: RevisionHash;
}

type NodeLocation = Readonly<{
  node: NodeRecord;
  parent: NodeRecord | null;
  index: number | null;
}>;

const failure = (code: EditorialCommandErrorCode, message: string): EditorialCommandResult => ({
  ok: false,
  error: { code, message },
});

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const childrenOf = (node: NodeRecord): NodeRecord[] =>
  Array.isArray(node['children']) ? (node['children'] as NodeRecord[]) : [];

const findLocations = (root: NodeRecord, nodeId: string): readonly NodeLocation[] => {
  const found: NodeLocation[] = [];
  const visit = (node: NodeRecord, parent: NodeRecord | null, index: number | null): void => {
    if (node['id'] === nodeId) found.push({ node, parent, index });
    childrenOf(node).forEach((child, childIndex) => {
      visit(child, node, childIndex);
    });
  };
  visit(root, null, null);
  return found;
};

const oneLocation = (root: NodeRecord, nodeId: string): NodeLocation | EditorialCommandResult => {
  const locations = findLocations(root, nodeId);
  if (locations.length === 0) {
    return failure('target_not_found', 'O nó alvo não existe na revisão atual.');
  }
  if (locations.length !== 1) {
    return failure('ambiguous_target', 'O ID interno identifica mais de um nó na revisão atual.');
  }
  const location = locations[0];
  return location ?? failure('target_not_found', 'O nó alvo não existe na revisão atual.');
};

const isFailure = (value: NodeLocation | EditorialCommandResult): value is EditorialCommandResult =>
  'ok' in value;

const textFieldAllowed = (node: NodeRecord, field: string): boolean => {
  const type = node['tipo'];
  if (field === 'caput') return type === 'artigo';
  if (field === 'texto')
    return ['paragrafo', 'inciso', 'alinea', 'item', 'pena'].includes(String(type));
  if (field === 'caption') return type === 'tabela';
  if (field === 'titulo')
    return [
      'lei',
      'ato_transitorio',
      'livro',
      'titulo',
      'capitulo',
      'secao',
      'subsecao',
      'anexo',
    ].includes(String(type));
  if (field === 'notaStatus') return type !== 'lei';
  if (field === 'redacaoAtualDadaPor' || field === 'renumeradoPara')
    return node['blockId'] !== undefined;
  return false;
};

const normalizeOrder = (parent: NodeRecord): void => {
  childrenOf(parent).forEach((child, index) => {
    child['ordem'] = index;
  });
};

const containsNode = (root: NodeRecord, candidate: NodeRecord): boolean => {
  if (root === candidate) return true;
  return childrenOf(root).some((child) => containsNode(child, candidate));
};

const stripIdentification = (ast: IdentifiedNormaAST): ParsedNormaAST => {
  const copy = clone(ast) as unknown as NodeRecord;
  const visit = (node: NodeRecord): void => {
    delete node['blockId'];
    childrenOf(node).forEach(visit);
  };
  copy['astPhase'] = 'parsed';
  visit(copy);
  return parsedNormaAstSchema.parse(copy);
};

const moveAndReconcile = (
  original: IdentifiedNormaAST,
  targetNodeId: string,
  newParentNodeId: string,
  newOrder: number,
): EditorialCommandResult | IdentifiedNormaAST => {
  const registry = registrarPublicacao(original, original.sigla);
  const parsed = stripIdentification(original);
  const root = parsed as unknown as NodeRecord;
  const target = oneLocation(root, targetNodeId);
  const destination = oneLocation(root, newParentNodeId);
  if (isFailure(target)) return target;
  if (isFailure(destination)) return destination;
  if (target.parent === null || target.index === null) {
    return failure('invalid_move', 'A raiz da norma não pode ser movida.');
  }
  if (containsNode(target.node, destination.node)) {
    return failure(
      'invalid_move',
      'Um nó não pode ser movido para si mesmo ou para um descendente.',
    );
  }
  const destinationChildren = childrenOf(destination.node);
  if (newOrder > destinationChildren.length) {
    return failure('invalid_move', 'A posição solicitada excede os filhos do novo pai.');
  }
  const sourceParent = target.parent;
  childrenOf(sourceParent).splice(target.index, 1);
  const adjustedOrder =
    sourceParent === destination.node && target.index < newOrder ? newOrder - 1 : newOrder;
  childrenOf(destination.node).splice(adjustedOrder, 0, target.node);
  normalizeOrder(sourceParent);
  if (sourceParent !== destination.node) normalizeOrder(destination.node);

  const validatedParsed = parsedNormaAstSchema.safeParse(root);
  if (!validatedParsed.success) {
    return failure('invariant_violation', 'A mudança estrutural viola a hierarquia da NormaAST.');
  }
  const identified = identificar(validatedParsed.data, original.sigla);
  if (!identified.ok) {
    return failure(
      'identity_reconciliation_failed',
      'A mudança estrutural não pôde receber identidade jurídica válida.',
    );
  }
  const reconciled = reconciliar(identified.valor, registry, original.sigla);
  if (!reconciled.ok) {
    return failure(
      'identity_reconciliation_failed',
      'A mudança estrutural conflita com o namespace histórico de Block IDs.',
    );
  }
  return reconciled.valor.arvore;
};

const applyLawMetadataChanges = (root: NodeRecord, changes: EditableLawMetadataChanges): void => {
  if (changes.titulo !== undefined) root['titulo'] = changes.titulo;
  if (changes.sigla !== undefined) root['sigla'] = changes.sigla;
  if (changes.tipoNorma !== undefined) root['tipoNorma'] = changes.tipoNorma;
  if (changes.numero !== undefined) root['numero'] = changes.numero;
  if (changes.ano !== undefined) root['ano'] = changes.ano;
  if (changes.ramo !== undefined) root['ramo'] = changes.ramo;
  if (changes.dataPublicacao !== undefined) root['dataPublicacao'] = changes.dataPublicacao;
  if (changes.dataAtualizacaoLegal !== undefined) {
    root['dataAtualizacaoLegal'] = changes.dataAtualizacaoLegal;
  }
  if (changes.legalStatus !== undefined) root['legalStatus'] = changes.legalStatus;
  if (changes.tags !== undefined) root['tags'] = changes.tags;
  if (changes.revogadaPor !== undefined) root['revogadaPor'] = changes.revogadaPor;
};

const applyLawMetadataOperation = (
  original: IdentifiedNormaAST,
  command: EditorialCommand,
  sha256: RevisionHashFunction,
  options: ApplyEditorialCommandOptions,
  currentRevisionHash: RevisionHash,
): EditorialCommandResult => {
  if (command.operation.kind !== 'set_law_metadata') {
    return failure('invalid_command', 'A operação não altera metadados da lei.');
  }
  const policy = validateLawMetadataChangesPolicy(
    original,
    command.operation.changes,
    publicationHistoryStateFor(original, options.publicationHistoryEvidence),
  );
  if (!policy.ok) return failure(policy.error.code, policy.error.message);

  let candidate: IdentifiedNormaAST;
  if (policy.changesIdentity) {
    if (
      options.metadataWorkspace === undefined &&
      options.metadataReplayResultRevisionHash === undefined
    ) {
      return failure(
        'metadata_workspace_required',
        'A correção de identidade exige o workspace completo para regenerar os derivados.',
      );
    }
    if ((original.idsDepreciados?.length ?? 0) > 0) {
      return failure(
        'identity_reconciliation_failed',
        'Uma norma com histórico de Block IDs depreciados não pode ser tratada como pré-publicação.',
      );
    }
    const parsed = stripIdentification(original);
    const root = parsed as unknown as NodeRecord;
    applyLawMetadataChanges(root, policy.changes);
    delete root['idsDepreciados'];
    const validatedParsed = parsedNormaAstSchema.safeParse(root);
    if (!validatedParsed.success) {
      return failure(
        'identity_reconciliation_failed',
        'A correção de identidade produziria uma NormaAST parsed inválida.',
      );
    }
    const identified = identificar(validatedParsed.data, validatedParsed.data.sigla);
    if (!identified.ok) {
      return failure(
        'identity_reconciliation_failed',
        'A nova identidade não pôde regenerar Block IDs canônicos.',
      );
    }
    candidate = identified.valor;
  } else {
    candidate = clone(original);
    applyLawMetadataChanges(candidate as unknown as NodeRecord, policy.changes);
  }

  const validated = identifiedNormaAstSchema.safeParse(candidate);
  if (!validated.success) {
    return failure('invariant_violation', 'O comando produziria uma NormaAST inválida.');
  }
  const revisionHash = calculateRevisionHash(validated.data, sha256);
  if (revisionHash === currentRevisionHash) {
    return failure('no_change', 'O comando não altera a revisão atual.');
  }
  if (
    options.metadataReplayResultRevisionHash !== undefined &&
    revisionHash !== options.metadataReplayResultRevisionHash
  ) {
    return failure(
      'metadata_derivation_failed',
      'O replay de metadados diverge do hash persistido no diário.',
    );
  }

  let metadataDerivatives: MetadataWorkspaceDerivatives | undefined;
  if (options.metadataWorkspace !== undefined) {
    const derived = deriveMetadataWorkspace(
      original,
      validated.data,
      options.metadataWorkspace,
      sha256,
    );
    if (!derived.ok) return failure('metadata_derivation_failed', derived.message);
    metadataDerivatives = derived.value;
  }

  return {
    ok: true,
    ast: validated.data,
    revisionHash,
    structuralChange: policy.changesIdentity,
    newAliases: [],
    missingPublishedBlockIds: [],
    ...(metadataDerivatives === undefined ? {} : { metadataDerivatives }),
  };
};

const applyNonStructuralOperation = (
  ast: IdentifiedNormaAST,
  command: EditorialCommand,
): EditorialCommandResult | IdentifiedNormaAST => {
  const root = ast as unknown as NodeRecord;
  const operation = command.operation;
  if (operation.kind === 'confirm_warning') return ast;
  if (operation.kind === 'set_law_metadata')
    return failure('invalid_command', 'Operação inválida.');
  const location = oneLocation(root, operation.targetNodeId);
  if (isFailure(location)) return location;
  if (operation.kind === 'replace_node_text') {
    if (!textFieldAllowed(location.node, operation.field)) {
      return failure('field_not_allowed', 'O campo não pertence à família do nó alvo.');
    }
    location.node[operation.field] = operation.value;
    return ast;
  }
  if (operation.kind === 'set_device_status') {
    if (location.node['tipo'] === 'lei' || location.node['deviceStatus'] === undefined) {
      return failure('field_not_allowed', 'O nó alvo não possui estado de dispositivo.');
    }
    location.node['deviceStatus'] = operation.deviceStatus;
    if (operation.notaStatus === undefined) delete location.node['notaStatus'];
    else location.node['notaStatus'] = operation.notaStatus;
    if (operation.deviceStatus === 'revoked') {
      if (operation.preservarTextoRevogado !== undefined)
        location.node['preservarTextoRevogado'] = operation.preservarTextoRevogado;
    } else {
      delete location.node['preservarTextoRevogado'];
    }
    return ast;
  }
  if (operation.kind === 'confirm_parse_interpretation') {
    const evidence = location.node['parseEvidence'];
    if (
      typeof evidence !== 'object' ||
      evidence === null ||
      (evidence as NodeRecord)['confidence'] !== 'low' ||
      (evidence as NodeRecord)['requiresHumanReview'] !== true
    ) {
      return failure(
        'pending_review_not_found',
        'O nó não possui interpretação de baixa confiança pendente.',
      );
    }
    const record = evidence as NodeRecord;
    const reasons = Array.isArray(record['reasons']) ? (record['reasons'] as unknown[]) : [];
    location.node['parseEvidence'] = {
      confidence: 'medium',
      reasons: [...new Set([...reasons, 'editorial_override'])],
      requiresHumanReview: false,
      editorialNote: operation.reason,
    };
    return ast;
  }
  return failure('invalid_command', 'A operação editorial não é suportada.');
};

export const applyEditorialCommand = (
  currentAst: unknown,
  rawCommand: unknown,
  sha256: RevisionHashFunction,
  options: ApplyEditorialCommandOptions = {},
): EditorialCommandResult => {
  const parsedAst = identifiedNormaAstSchema.safeParse(currentAst);
  const parsedCommand = editorialCommandSchema.safeParse(rawCommand);
  if (!parsedAst.success || !parsedCommand.success) {
    return failure('invalid_command', 'A árvore ou o comando editorial não satisfaz o contrato.');
  }
  const currentRevisionHash = calculateRevisionHash(parsedAst.data, sha256);
  if (parsedCommand.data.expectedRevisionHash !== currentRevisionHash) {
    return failure(
      'stale_revision',
      'O comando foi criado para uma revisão que não é mais a atual.',
    );
  }
  if (parsedCommand.data.operation.kind === 'set_law_metadata') {
    return applyLawMetadataOperation(
      parsedAst.data,
      parsedCommand.data,
      sha256,
      options,
      currentRevisionHash,
    );
  }
  const copy = clone(parsedAst.data);
  const operation = parsedCommand.data.operation;
  const structural = operation.kind === 'move_node';
  const applied =
    operation.kind === 'move_node'
      ? moveAndReconcile(
          copy,
          operation.targetNodeId,
          operation.newParentNodeId,
          operation.newOrder,
        )
      : applyNonStructuralOperation(copy, parsedCommand.data);
  if ('ok' in applied) return applied;
  const validated = identifiedNormaAstSchema.safeParse(applied);
  if (!validated.success) {
    return failure('invariant_violation', 'O comando produziria uma NormaAST inválida.');
  }
  const revisionHash = calculateRevisionHash(validated.data, sha256);
  if (
    revisionHash === currentRevisionHash &&
    parsedCommand.data.operation.kind !== 'confirm_warning'
  ) {
    return failure('no_change', 'O comando não altera a revisão atual.');
  }
  const identity = structural
    ? reconciliar(
        validated.data,
        registrarPublicacao(parsedAst.data, parsedAst.data.sigla),
        parsedAst.data.sigla,
      )
    : undefined;
  return {
    ok: true,
    ast: validated.data,
    revisionHash,
    structuralChange: structural,
    newAliases: identity?.ok ? identity.valor.aliasesNovos : [],
    missingPublishedBlockIds: identity?.ok ? identity.valor.ausentes : [],
  };
};
