/**
 * 运行时系统图（SystemGraph）—— 模块出口
 *
 * P0-1 基础期：图内核 + 只读投影（领域无关，纯内存）。
 * 设计见 `.trae/specs/graph-engineering-p0.md`。
 */

export {
  SystemGraph,
  EDGE_CAUSAL_WEIGHT,
  DEFAULT_ROOT_CAUSE_MAX_DEPTH,
  DEFAULT_ROOT_CAUSE_LIMIT,
  projectTaskGraph,
  projectAgentGraph,
} from './SystemGraph.js';

export type {
  SystemNode,
  SystemNodeKind,
  SystemEdge,
  SystemEdgeKind,
  RootCauseCandidate,
  SystemGraphSnapshot,
  TaskStepLike,
  AgentLike,
} from './types.js';
