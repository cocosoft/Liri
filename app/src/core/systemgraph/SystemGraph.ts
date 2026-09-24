// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
/**
 * SystemGraph —— 运行时系统图内核（P0-1 基础期）
 *
 * 纯内存、无 IO、无可变全局：便于单测、便于后续由 workflow / agent 两侧**调用**
 * （而非 core 反向依赖），符合 R00-001 分层。
 *
 * 本期为**零侵入**落地：没有任何生产调用点，故不改变既有执行路径。
 */

import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

import type {
  AgentLike,
  RootCauseCandidate,
  SystemEdge,
  SystemEdgeKind,
  SystemGraphSnapshot,
  SystemNode,
  SystemNodeKind,
  TaskStepLike,
} from './types';

/**
 * 边类型的**因果权重**（P0-2 根因排序用）：越"硬"的依赖关系越可能是根因。
 * - `dependsOn` 1.0：前提未满足/产物有误 ⇒ 最直接的上游原因
 * - `blockedBy` 0.8：显式阻塞关系
 * - `producedBy` 0.6：产物由上游产生（可能是上游数据问题）
 * - `assignedTo` 0.2：指派关系，弱因果（执行者存在不代表结论有误）
 */
export const EDGE_CAUSAL_WEIGHT: Readonly<Record<SystemEdgeKind, number>> = {
  dependsOn: 1.0,
  blockedBy: 0.8,
  producedBy: 0.6,
  assignedTo: 0.2,
};

/** 根因检索默认最大回溯跳数（防大图无界遍历） */
export const DEFAULT_ROOT_CAUSE_MAX_DEPTH = 5;
/** 根因候选默认上限（按得分截断） */
export const DEFAULT_ROOT_CAUSE_LIMIT = 20;

/** 得分公式：`max(路径边权重) / distance` —— 优先"边更强且更近"的上游 */
function scoreOf(path: readonly SystemEdge[], distance: number): number {
  const maxWeight = path.reduce(
    (acc, e) => Math.max(acc, EDGE_CAUSAL_WEIGHT[e.kind]),
    0
  );
  return maxWeight / distance;
}

export class SystemGraph {
  private readonly nodes = new Map<string, SystemNode>();
  private readonly edges: SystemEdge[] = [];
  /** 反向邻接索引：nodeId → 指向它的边（根因回溯恒沿 in 边） */
  private readonly inIndex = new Map<string, SystemEdge[]>();

  constructor(snapshot?: SystemGraphSnapshot) {
    if (!snapshot) return;
    for (const node of snapshot.nodes) this.addNode(node);
    for (const edge of snapshot.edges) this.addEdge(edge);
  }

  /** 新增节点；id 重复即抛错（单一事实源不允许同 id 两义） */
  addNode(node: SystemNode): this {
    if (this.nodes.has(node.id)) {
      throw new AppError(
        `系统图节点 id 重复：${node.id}（kind=${node.kind}）`,
        ErrorCategory.VALIDATION,
        ErrorSeverity.HIGH,
        'SYSTEM_GRAPH_DUPLICATE_NODE'
      );
    }
    this.nodes.set(node.id, { ...node });
    return this;
  }

  /** 新增边；端点缺失（悬空边）或自环即抛错 */
  addEdge(edge: SystemEdge): this {
    if (edge.from === edge.to) {
      throw new AppError(
        `系统图自环边非法：${edge.from} -[${edge.kind}]-> ${edge.to}`,
        ErrorCategory.VALIDATION,
        ErrorSeverity.HIGH,
        'SYSTEM_GRAPH_SELF_LOOP'
      );
    }
    if (!this.nodes.has(edge.from) || !this.nodes.has(edge.to)) {
      throw new AppError(
        `系统图悬空边：${edge.from} -[${edge.kind}]-> ${edge.to}（端点未注册）`,
        ErrorCategory.VALIDATION,
        ErrorSeverity.HIGH,
        'SYSTEM_GRAPH_DANGLING_EDGE'
      );
    }
    this.edges.push({ ...edge });
    const list = this.inIndex.get(edge.to);
    if (list) list.push(edge);
    else this.inIndex.set(edge.to, [edge]);
    return this;
  }

  hasNode(id: string): boolean {
    return this.nodes.has(id);
  }

  getNode(id: string): SystemNode | undefined {
    return this.nodes.get(id);
  }

  /** 全部节点（按 id 升序，保证确定性） */
  listNodes(kind?: SystemNodeKind): SystemNode[] {
    const all = [...this.nodes.values()].filter(
      (n) => kind === undefined || n.kind === kind
    );
    return all.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  /** 全部边（按 from/kind/to 升序，保证确定性） */
  listEdges(): SystemEdge[] {
    return [...this.edges].sort(compareEdges);
  }

  /** `from` 的出边（下游） */
  outEdges(from: string): SystemEdge[] {
    return this.edges.filter((e) => e.from === from).sort(compareEdges);
  }

  /** `to` 的入边（**上游**，根因回溯方向） */
  inEdges(to: string): SystemEdge[] {
    return [...(this.inIndex.get(to) ?? [])].sort(compareEdges);
  }

  /**
   * 同类型节点间的**拓扑序**（前提在前）。
   *
   * 只考虑两端**同为 `kind`** 的边（跨类型边不参与该类型内部排序）。
   * **并列打破规则：节点插入序**（投影时即"声明序"）——这样"无依赖声明的步骤保持原顺序"
   * 与既有 `WorkflowEngine.orderSteps()` 语义一致；按 id 重排会让独立步骤无谓换序。
   * 拓扑序不能覆盖全部节点时**抛错**（与 `WorkflowEngine.orderSteps()` 的"回退原序"不同：
   * 内核不做静默兜底，调用方若需回退请显式处理——避免"看起来成功"的错序）。
   */
  topologicalOrder(kind: SystemNodeKind = 'task'): SystemNode[] {
    const inScope = this.listNodes(kind);
    const ids = new Set(inScope.map((n) => n.id));
    /** 插入序（Map 保持插入顺序）；仅用于并列打破，不参与正确性判定 */
    const seq = new Map<string, number>();
    let next = 0;
    for (const id of this.nodes.keys()) seq.set(id, next++);
    const bySeq = (a: string, b: string): number =>
      (seq.get(a) ?? 0) - (seq.get(b) ?? 0);

    const indegree = new Map<string, number>();
    const out = new Map<string, string[]>();
    for (const id of ids) {
      indegree.set(id, 0);
      out.set(id, []);
    }
    for (const e of this.edges) {
      if (!ids.has(e.from) || !ids.has(e.to)) continue;
      indegree.set(e.to, (indegree.get(e.to) ?? 0) + 1);
      out.get(e.from)!.push(e.to);
    }

    // 稳定 Kahn：每次从"已就绪"中取插入序最靠前者
    const ready = [...ids].filter((id) => indegree.get(id) === 0).sort(bySeq);
    const ordered: string[] = [];
    while (ready.length > 0) {
      const id = ready.shift()!;
      ordered.push(id);
      for (const downstream of out.get(id)!.sort(bySeq)) {
        const left = (indegree.get(downstream) ?? 0) - 1;
        indegree.set(downstream, left);
        if (left === 0) {
          ready.push(downstream);
          ready.sort(bySeq);
        }
      }
    }

    if (ordered.length !== ids.size) {
      throw new AppError(
        `系统图存在环，无法给出拓扑序（kind=${kind}，已排序 ${ordered.length}/${ids.size}）`,
        ErrorCategory.VALIDATION,
        ErrorSeverity.HIGH,
        'SYSTEM_GRAPH_CYCLE'
      );
    }
    return ordered.map((id) => this.nodes.get(id)!);
  }

  /**
   * P0-2 核心：沿**反向边**做有界 BFS，给出"根因候选集"。
   *
   * 返回按 `score` 降序（同分按 distance 升序、再按 nodeId 升序，**确定性**）。
   * 失败点自身不入候选（只给上游）。
   */
  findRootCauseCandidates(
    failedNodeId: string,
    opts: { maxDepth?: number; limit?: number } = {}
  ): RootCauseCandidate[] {
    const maxDepth = opts.maxDepth ?? DEFAULT_ROOT_CAUSE_MAX_DEPTH;
    const limit = opts.limit ?? DEFAULT_ROOT_CAUSE_LIMIT;
    if (!this.nodes.has(failedNodeId)) {
      throw new AppError(
        `根因检索的起点不在图中：${failedNodeId}`,
        ErrorCategory.VALIDATION,
        ErrorSeverity.HIGH,
        'SYSTEM_GRAPH_UNKNOWN_START'
      );
    }

    const candidates: RootCauseCandidate[] = [];
    // 记录已访问（nodeId → 最短距离），避免重复入队导致指数膨胀
    const visited = new Map<string, number>([[failedNodeId, 0]]);
    let frontier: Array<{ id: string; path: SystemEdge[] }> = [
      { id: failedNodeId, path: [] },
    ];

    for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth++) {
      const next: Array<{ id: string; path: SystemEdge[] }> = [];
      for (const { id, path } of frontier) {
        for (const edge of this.inEdges(id)) {
          const seenAt = visited.get(edge.from);
          if (seenAt !== undefined && seenAt <= depth) continue;
          visited.set(edge.from, depth);
          const nextPath = [...path, edge];
          const node = this.nodes.get(edge.from)!;
          candidates.push({
            nodeId: node.id,
            kind: node.kind,
            distance: depth,
            path: nextPath,
            pathEvidenceRefs: collectEvidence(nextPath),
            score: scoreOf(nextPath, depth),
          });
          next.push({ id: edge.from, path: nextPath });
        }
      }
      frontier = next;
    }

    return candidates
      .sort(
        (a, b) =>
          b.score - a.score ||
          a.distance - b.distance ||
          (a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : 0)
      )
      .slice(0, limit);
  }

  /** 快照（可序列化，供落盘 / 断言 / 跨进程传递） */
  snapshot(): SystemGraphSnapshot {
    return { nodes: this.listNodes(), edges: this.listEdges() };
  }
}

function compareEdges(a: SystemEdge, b: SystemEdge): number {
  if (a.from !== b.from) return a.from < b.from ? -1 : 1;
  if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
  if (a.to !== b.to) return a.to < b.to ? -1 : 1;
  return 0;
}

/** 沿路径收集证据引用（去重、保序；仅取有值项） */
function collectEvidence(path: readonly SystemEdge[]): string[] {
  const out: string[] = [];
  for (const e of path) {
    if (e.evidenceRef && !out.includes(e.evidenceRef)) out.push(e.evidenceRef);
  }
  return out;
}

// ─── 只读投影（结构化入参：core 不 import 业务类型） ────────────────────────

/**
 * 由任务步骤投影出**任务子图**（`dependsOn` 边：from=前提 → to=依赖者）。
 *
 * `TaskStepLike` 与 `modules/workflow` 的 `WorkflowStepSpec` 结构兼容 ⇒ 接线期①
 * 可直接把既有 `WorkflowDefinition.steps` 传入，无需 core 依赖业务模块。
 *
 * `opts.evidence`（可选，P0-2）：为每条依赖边生成**证据引用**（如 `run:<id>#step:<id>`），
 * 供根因候选集给出可回溯依据；返回 `undefined` 则不带证据（默认）。
 */
export function projectTaskGraph(
  steps: readonly TaskStepLike[],
  opts?: {
    evidence?: (fromStepId: string, toStepId: string) => string | undefined;
  }
): SystemGraph {
  const graph = new SystemGraph();
  for (const step of steps) {
    graph.addNode({
      id: step.id,
      kind: 'task',
      ...(step.description ? { label: step.description } : {}),
      ...(step.tool ? { attrs: { tool: step.tool } } : {}),
    });
  }
  for (const step of steps) {
    for (const dep of step.dependsOn ?? []) {
      if (!graph.hasNode(dep)) {
        throw new AppError(
          `任务子图依赖缺失：步骤 ${step.id} 依赖未声明的 ${dep}`,
          ErrorCategory.VALIDATION,
          ErrorSeverity.HIGH,
          'SYSTEM_GRAPH_DEPENDENCY_MISSING'
        );
      }
      const evidenceRef = opts?.evidence?.(dep, step.id);
      graph.addEdge({
        from: dep,
        to: step.id,
        kind: 'dependsOn',
        ...(evidenceRef ? { evidenceRef } : {}),
      });
    }
  }
  return graph;
}

/**
 * 由智能体定义投影出**智能体子图**（无边的节点集合；`assignedTo` 边在接线期由
 * 任务-智能体分配关系补入，因其属于**运行期事实**而非静态定义）。
 */
export function projectAgentGraph(agents: readonly AgentLike[]): SystemGraph {
  const graph = new SystemGraph();
  for (const agent of agents) {
    graph.addNode({
      id: agent.id,
      kind: 'agent',
      ...(agent.role ? { label: agent.role } : {}),
      attrs: {
        ...(agent.capabilities
          ? { capabilities: [...agent.capabilities] }
          : {}),
        ...(agent.expertise ? { expertise: [...agent.expertise] } : {}),
      },
    });
  }
  return graph;
}
