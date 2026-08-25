//
/**
 * 插件依赖图分析器
 * 提供拓扑排序、循环检测等功能
 * 参考CC源码 cc_code/backend/utils/plugins/dependencyResolver.ts 实现
 */

import type { LoadedPlugin } from '../types/index.js';
import {
  parsePluginIdentifier,
  validatePluginIdentifier,
} from './pluginIdentifier.js';
import type { PluginId } from './schemas.js';
import { PluginError } from '@modules/error';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('plugins:utils:dependencyResolver');

/**
 * 依赖查找结果
 */
export interface DependencyLookupResult {
  dependencies?: string[];
}

/**
 * 解析结果类型
 */
export type ResolutionResult =
  | { ok: true; closure: PluginId[] }
  | { ok: false; reason: 'cycle'; chain: PluginId[] }
  | { ok: false; reason: 'not-found'; missing: PluginId; requiredBy: PluginId }
  | {
      ok: false;
      reason: 'cross-marketplace';
      dependency: PluginId;
      requiredBy: PluginId;
    };

/**
 * 验证和降级结果
 */
export interface DemoteResult {
  demoted: Set<string>;
  errors: PluginDependencyError[];
}

/**
 * 插件错误类型
 */
export interface PluginDependencyError {
  type: 'dependency-unsatisfied';
  source: string;
  plugin: string;
  dependency: string;
  reason: 'not-enabled' | 'not-found';
}

/**
 * 内联市场哨兵（用于--plugin-dir加载的插件）
 */
const INLINE_MARKETPLACE = 'inline';

/**
 * 标准化依赖引用为完全限定的"name@marketplace"形式
 */
export function qualifyDependency(
  dep: string,
  declaringPluginId: string
): string {
  const parsed = parsePluginIdentifier(dep);
  if (parsed.marketplace) return dep;

  const mkt = parsePluginIdentifier(declaringPluginId).marketplace;
  if (!mkt || mkt === INLINE_MARKETPLACE) return dep;

  return `${dep}@${mkt}`;
}

/**
 * 解析依赖闭包 - 安装时DFS遍历，带循环检测
 * 评审修订 v4：适配层注入式闭包（异步 lookup），与内核 computeClosure（同步纯图）为同语义
 * 的两种形态——resolveDependencyClosure 保持注入式（安装期唯一消费点，短路错误返回），
 * 不直接委托 computeClosure（委托需全量预查询，会改变短路语义与错误时机，违背「不动语义」）。
 *
 * @param rootId 根插件ID（格式："name@marketplace"）
 * @param lookup 异步查找函数
 * @param alreadyEnabled 已启用的插件ID集合
 * @param allowedCrossMarketplaces 根插件信任的市场集合
 * @returns 要安装的闭包，或循环/未找到/跨市场错误
 */
export async function resolveDependencyClosure(
  rootId: PluginId,
  lookup: (id: PluginId) => Promise<DependencyLookupResult | null>,
  alreadyEnabled: ReadonlySet<PluginId>,
  allowedCrossMarketplaces: ReadonlySet<string> = new Set()
): Promise<ResolutionResult> {
  const rootMarketplace = parsePluginIdentifier(rootId).marketplace;
  const closure: PluginId[] = [];
  const visited = new Set<PluginId>();
  const stack: PluginId[] = [];

  async function walk(
    id: PluginId,
    requiredBy: PluginId
  ): Promise<ResolutionResult | null> {
    if (id !== rootId && alreadyEnabled.has(id)) return null;

    const idMarketplace = parsePluginIdentifier(id).marketplace;
    if (
      idMarketplace !== rootMarketplace &&
      !(idMarketplace && allowedCrossMarketplaces.has(idMarketplace))
    ) {
      return {
        ok: false,
        reason: 'cross-marketplace',
        dependency: id,
        requiredBy,
      };
    }

    if (stack.includes(id)) {
      return { ok: false, reason: 'cycle', chain: [...stack, id] };
    }

    if (visited.has(id)) return null;
    visited.add(id);

    const entry = await lookup(id);
    if (!entry) {
      return { ok: false, reason: 'not-found', missing: id, requiredBy };
    }

    stack.push(id);
    for (const rawDep of entry.dependencies ?? []) {
      const dep = qualifyDependency(rawDep, id);
      const err = await walk(dep, id);
      if (err) return err;
    }
    stack.pop();

    closure.push(id);
    return null;
  }

  const err = await walk(rootId, rootId);
  if (err) return err;
  return { ok: true, closure };
}

/**
 * 加载时安全检查 - 验证所有已启用插件的依赖是否满足
 *
 * @param plugins 所有加载的插件（已启用+已禁用）
 * @returns 要降级的插件ID集合和错误列表
 */
export function verifyAndDemote(
  plugins: readonly LoadedPlugin[]
): DemoteResult {
  const known = new Set(plugins.map((p) => p.source));
  const enabled = new Set(
    plugins.filter((p) => p.enabled).map((p) => p.source)
  );

  const knownByName = new Set(
    plugins.map((p) => parsePluginIdentifier(p.source).name ?? '')
  );
  const enabledByName = new Map<string, number>();
  const enabledArray = Array.from(enabled);
  for (const id of enabledArray) {
    const n = parsePluginIdentifier(id).name ?? '';
    enabledByName.set(n, (enabledByName.get(n) ?? 0) + 1);
  }

  const errors: PluginDependencyError[] = [];
  let changed = true;

  while (changed) {
    changed = false;
    for (const p of plugins) {
      if (!enabled.has(p.source)) continue;

      for (const rawDep of p.manifest?.dependencies ?? []) {
        const dep = qualifyDependency(rawDep, p.source);
        const isBare = !parsePluginIdentifier(dep).marketplace;
        const satisfied = isBare
          ? (enabledByName.get(dep) ?? 0) > 0
          : enabled.has(dep);

        if (!satisfied) {
          enabled.delete(p.source);
          const count = enabledByName.get(p.name) ?? 0;
          if (count <= 1) enabledByName.delete(p.name);
          else enabledByName.set(p.name, count - 1);

          errors.push({
            type: 'dependency-unsatisfied',
            source: p.source,
            plugin: p.name,
            dependency: dep,
            reason: isBare
              ? knownByName.has(dep)
                ? 'not-enabled'
                : 'not-found'
              : known.has(dep)
                ? 'not-enabled'
                : 'not-found',
          });
          changed = true;
          break;
        }
      }
    }
  }

  const demoted = new Set(
    plugins
      .filter((p) => p.enabled && !enabled.has(p.source))
      .map((p) => p.source)
  );

  return { demoted, errors };
}

// ==================== 依赖图内核（评审修订 v4：统一依赖图算法） ====================

/** 归一化依赖（消除 PluginDependency[] 与 string[] 两种声明格式差异） */
export interface NormalizedDependency {
  name: string;
  version?: string;
  marketplace?: string;
}

/** 依赖边（kind='service' 仅作中间表示，不直接进 detectCycles/topoSort） */
export interface DependencyEdge {
  from: string;
  to: string;
  kind: 'plugin' | 'service';
}

/** 依赖解析错误（结构化返回，不抛裸异常） */
export interface DependencyError {
  code:
    | 'INVALID_IDENTIFIER'
    | 'DEPENDENCY_NOT_FOUND'
    | 'CYCLE_DETECTED'
    | 'CROSS_MARKETPLACE';
  plugin: string;
  dependency?: string;
  chain?: string[];
}

/**
 * 归一化依赖（消除声明格式差异）
 * 输入先过 validatePluginIdentifier，拒绝 name@version 歧义（评审修订 v4 P2-9）。
 * @param input 字符串声明（name 或 name@marketplace）或对象声明（name+version）
 * @param declaringPluginId 声明方插件 ID（用于市场限定补全）
 */
export function normalizeDependency(
  input: string | { name: string; version?: string },
  declaringPluginId?: string
): NormalizedDependency | DependencyError {
  if (typeof input === 'object' && input !== null) {
    return { name: input.name, version: input.version ?? '*' };
  }

  if (!validatePluginIdentifier(input)) {
    return { code: 'INVALID_IDENTIFIER', plugin: input };
  }

  const parsed = parsePluginIdentifier(input);
  const qualified = qualifyDependency(input, declaringPluginId ?? input);
  const qualifiedParsed = parsePluginIdentifier(qualified);

  return {
    name: parsed.name ?? input,
    version: '*',
    marketplace: qualifiedParsed.marketplace ?? parsed.marketplace,
  };
}

/**
 * 归一化依赖列表（丢弃非法项）
 */
export function normalizeDependencies(
  deps: Array<string | { name: string; version?: string }>,
  declaringPluginId?: string
): NormalizedDependency[] {
  return deps
    .map((d) => normalizeDependency(d, declaringPluginId))
    .filter((d): d is NormalizedDependency => !('code' in d));
}

/**
 * 服务名 → 提供者插件名（单一函数，评审修订 v4 P1-4）
 * 非 kernel.* 服务名首段即提供者插件名；系统服务返回 undefined。
 * 注意：不包含自依赖排除——由调用方决定（checkServiceCircularDependencies 排除，validateProviderDependencies 不排除）。
 */
export function getServiceProviderPluginId(
  serviceId: string
): string | undefined {
  if (serviceId.startsWith('kernel.')) return undefined;
  const providerName = serviceId.split('.')[0];
  return providerName || undefined;
}

/**
 * 从插件依赖声明构建插件级依赖边（key 统一为裸插件名）
 */
export function buildPluginEdges(
  pluginDeps: Array<{
    name: string;
    dependencies?: Array<string | { name: string; version?: string }>;
  }>
): DependencyEdge[] {
  const edges: DependencyEdge[] = [];
  for (const p of pluginDeps) {
    for (const dep of p.dependencies ?? []) {
      const norm = normalizeDependency(dep, p.name);
      if ('code' in norm) continue;
      edges.push({ from: p.name, to: norm.name, kind: 'plugin' });
    }
  }
  return edges;
}

/**
 * 拓扑排序（加载序：依赖先）
 * 边语义：from 依赖 to（被依赖方先就绪）。
 * @param edges 依赖边（from 依赖 to）
 * @returns 加载序（被依赖方在前；热加载取 reverse 得卸载序）
 */
export function topoSort(edges: DependencyEdge[]): string[] {
  const nodes = new Set<string>();
  for (const e of edges) {
    if (e.kind !== 'plugin') continue;
    nodes.add(e.from);
    nodes.add(e.to);
  }

  // 被依赖方 → 依赖方（反图）；依赖方入度++
  const graph = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  for (const n of nodes) {
    graph.set(n, []);
    inDegree.set(n, 0);
  }
  for (const e of edges) {
    if (e.kind !== 'plugin') continue;
    graph.get(e.to)?.push(e.from);
    inDegree.set(e.from, (inDegree.get(e.from) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [n, d] of inDegree) {
    if (d === 0) queue.push(n); // 入度 0 = 被依赖方（底层），先出队
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    sorted.push(cur);
    for (const neighbor of graph.get(cur) ?? []) {
      const nd = (inDegree.get(neighbor) ?? 0) - 1;
      inDegree.set(neighbor, nd);
      if (nd === 0) queue.push(neighbor);
    }
  }

  return sorted;
}

/**
 * 环检测（仅消费插件级边）
 * @param edges 依赖边
 * @returns 环路径列表（每条为节点名序列）
 */
export function detectCycles(edges: DependencyEdge[]): string[][] {
  const graph = new Map<string, string[]>();
  const nodes = new Set<string>();
  for (const e of edges) {
    if (e.kind !== 'plugin') continue;
    if (!graph.has(e.from)) graph.set(e.from, []);
    graph.get(e.from)!.push(e.to);
    nodes.add(e.from);
    nodes.add(e.to);
  }

  const visited = new Set<string>();
  const recStack = new Set<string>();
  const path: string[] = [];
  const cycles: string[][] = [];

  const dfs = (name: string): void => {
    if (visited.has(name)) return;
    visited.add(name);
    recStack.add(name);
    path.push(name);

    for (const next of graph.get(name) ?? []) {
      if (!visited.has(next)) {
        dfs(next);
      } else if (recStack.has(next)) {
        const start = path.indexOf(next);
        if (start !== -1) cycles.push([...path.slice(start), next]);
      }
    }

    path.pop();
    recStack.delete(name);
  };

  for (const n of nodes) {
    if (!visited.has(n)) dfs(n);
  }

  return cycles;
}

/**
 * 反向依赖：依赖指定插件的插件列表
 */
export function findReverseDependents(
  target: string,
  edges: DependencyEdge[]
): string[] {
  const result = new Set<string>();
  for (const e of edges) {
    if (e.kind === 'plugin' && e.to === target) result.add(e.from);
  }
  return [...result];
}

/**
 * 依赖闭包（纯图，不含市场/跨市场策略）
 * @param root 根插件名
 * @param edges 依赖边
 * @returns 闭包（依赖先序）或 DependencyError
 */
export function computeClosure(
  root: string,
  edges: DependencyEdge[]
): { closure: string[] } | DependencyError {
  const graph = new Map<string, string[]>();
  for (const e of edges) {
    if (e.kind !== 'plugin') continue;
    if (!graph.has(e.from)) graph.set(e.from, []);
    graph.get(e.from)!.push(e.to);
  }

  const closure: string[] = [];
  const visited = new Set<string>();
  const stack: string[] = [];

  const walk = (id: string): DependencyError | null => {
    if (stack.includes(id)) {
      return { code: 'CYCLE_DETECTED', plugin: id, chain: [...stack, id] };
    }
    if (visited.has(id)) return null;
    visited.add(id);
    stack.push(id);

    for (const next of graph.get(id) ?? []) {
      const err = walk(next);
      if (err) return err;
    }

    stack.pop();
    closure.push(id);
    return null;
  };

  const err = walk(root);
  if (err) return err;
  return { closure };
}

/**
 * 服务级环检测（从 PluginDependencyManager 迁入内核，评审修订 v4 P0-1）
 * 输入保持「插件 → inject 服务名列表」；内部先经 getServiceProviderPluginId 转插件级边
 * （排除 kernel.* 与自依赖），再走 detectCycles——环输出恒为插件名序列（与迁移前等价）。
 * @param pluginInjectMap 插件 ID → inject 声明服务名列表
 * @returns 服务级依赖环列表（插件名序列），无环返回空数组
 */
export function checkServiceCircularDependencies(
  pluginInjectMap: Map<string, string[]>
): string[][] {
  const edges: DependencyEdge[] = [];
  for (const [pluginId, services] of pluginInjectMap) {
    for (const serviceId of services) {
      const providerName = getServiceProviderPluginId(serviceId);
      if (providerName && providerName !== pluginId) {
        edges.push({ from: pluginId, to: providerName, kind: 'plugin' });
      }
    }
  }
  return detectCycles(edges);
}
