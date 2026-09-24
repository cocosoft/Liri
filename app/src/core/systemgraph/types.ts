/**
 * 运行时系统图 —— 契约类型（P0-1 基础期）
 *
 * 来源：`GraphEngineering_论文精读与代码对标优化建议.md` §四 P0-1 / P0-2；
 * 设计见 `.trae/specs/graph-engineering-p0.md` §二。
 *
 * **分层约束**：本目录属 `core/`，**必须保持领域无关**（R00-001 分层门禁）——
 * 不得 import `modules/workflow`、`agent/registry` 等业务模块；领域侧以**结构化入参**
 * （TS structural typing）投影，而非 core 反向依赖业务类型。
 *
 * **方向约定（重要）**：所有边一律表示 **`from` 是因 / `to` 是果（上游 → 下游）**：
 * - `dependsOn`  ：`from` = 前提步骤，`to` = 依赖它的步骤（即"to 依赖 from"）
 * - `producedBy` ：`from` = 产出者（agent / 工具执行），`to` = 产物（state / task）
 * - `blockedBy`  ：`from` = 阻塞源，`to` = 被阻塞者
 * - `assignedTo` ：`from` = 执行者（agent），`to` = 被指派的任务
 *
 * 由此，**根因检索恒沿 `in` 边回溯**（谁在因果上先于失败点）——四类边共用同一方向语义，
 * 避免"按边类型各判一次方向"的分叉。
 */

/** 节点类型：论文 §11.2 的"任务 / 智能体 / 状态"三图合一 */
export type SystemNodeKind = 'task' | 'agent' | 'state';

/** 系统图节点 */
export interface SystemNode {
  /** 全局唯一 id（任务用步骤 id；智能体用 agent id；状态用 run/step 派生 id） */
  id: string;
  kind: SystemNodeKind;
  /** 人类可读标签（如步骤描述 / 角色名） */
  label?: string;
  /** 领域附加属性（**不参与内核算法**，仅作载体：如 `{ tool }`、`{ capabilities }`） */
  attrs?: Record<string, unknown>;
}

/** 边类型：论文 §11.2 的四类系统级关系 */
export type SystemEdgeKind =
  | 'dependsOn'
  | 'assignedTo'
  | 'producedBy'
  | 'blockedBy';

/** 系统图有向边（`from` 因 → `to` 果） */
export interface SystemEdge {
  from: string;
  to: string;
  kind: SystemEdgeKind;
  /**
   * P0-2 基础：**证据引用** —— 指向可回溯的具体位置（tool call id / message id /
   * checkpoint id / run 记录 id）。根因候选集会沿路径收集该字段，使"为什么判定它是根因"
   * 可被独立复核（而非仅给出结论）。
   */
  evidenceRef?: string;
}

/** 根因候选（P0-2 输出） */
export interface RootCauseCandidate {
  nodeId: string;
  kind: SystemNodeKind;
  /** 距失败点的**反向边跳数**（1 = 直接上游） */
  distance: number;
  /** 回溯路径上的边（按 失败点 → 更上游 的顺序） */
  path: SystemEdge[];
  /** 路径上收集到的证据引用（去重、保序） */
  pathEvidenceRefs: string[];
  /** 排序得分（越大越可能是根因），公式见 `SystemGraph.ts` 的 `EDGE_CAUSAL_WEIGHT` */
  score: number;
}

/** 图快照（可序列化；用于落盘 / 跨进程传递 / 测试断言） */
export interface SystemGraphSnapshot {
  nodes: SystemNode[];
  edges: SystemEdge[];
}

/** 任务侧**结构化**入参（`WorkflowStepSpec` 天然满足，core 不 import 其类型） */
export interface TaskStepLike {
  id: string;
  description?: string;
  tool?: string;
  dependsOn?: readonly string[];
}

/**
 * 智能体侧**结构化**入参。
 *
 * **注意**：`agent/registry` 的 `AgentDefinition` 用 `agentId` 而非 `id`，**不**直接
 * 满足本接口 ⇒ 领域侧需一次 `agentId → id` 映射（见 `AgentRegistry.toAgentLike`）。
 * core 保持领域无关，不迁就业务字段名。
 */
export interface AgentLike {
  id: string;
  role?: string;
  capabilities?: readonly string[];
  expertise?: readonly string[];
}
