//
/**
 * 插件依赖图分析器
 * 提供拓扑排序、循环检测等功能
 * 参考CC源码 cc_code/backend/utils/plugins/dependencyResolver.ts 实现
 */

import type { LoadedPlugin } from '../types/index.js';
import { parsePluginIdentifier } from './pluginIdentifier.js';
import type { PluginId } from './schemas.js';

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
  | { ok: false; reason: 'cross-marketplace'; dependency: PluginId; requiredBy: PluginId };

/**
 * 验证和降级结果
 */
export interface DemoteResult {
  demoted: Set<string>;
  errors: PluginError[];
}

/**
 * 插件错误类型
 */
export interface PluginError {
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
export function qualifyDependency(dep: string, declaringPluginId: string): string {
  const parsed = parsePluginIdentifier(dep);
  if (parsed.marketplace) return dep;

  const mkt = parsePluginIdentifier(declaringPluginId).marketplace;
  if (!mkt || mkt === INLINE_MARKETPLACE) return dep;

  return `${dep}@${mkt}`;
}

/**
 * 解析依赖闭包 - 安装时DFS遍历，带循环检测
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
  allowedCrossMarketplaces: ReadonlySet<string> = new Set(),
): Promise<ResolutionResult> {
  const rootMarketplace = parsePluginIdentifier(rootId).marketplace;
  const closure: PluginId[] = [];
  const visited = new Set<PluginId>();
  const stack: PluginId[] = [];

  async function walk(id: PluginId, requiredBy: PluginId): Promise<ResolutionResult | null> {
    if (id !== rootId && alreadyEnabled.has(id)) return null;

    const idMarketplace = parsePluginIdentifier(id).marketplace;
    if (
      idMarketplace !== rootMarketplace &&
      !(idMarketplace && allowedCrossMarketplaces.has(idMarketplace))
    ) {
      return { ok: false, reason: 'cross-marketplace', dependency: id, requiredBy };
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
export function verifyAndDemote(plugins: readonly LoadedPlugin[]): DemoteResult {
  const known = new Set(plugins.map(p => p.source));
  const enabled = new Set(plugins.filter(p => p.enabled).map(p => p.source));

  const knownByName = new Set(plugins.map(p => parsePluginIdentifier(p.source).name ?? ''));
  const enabledByName = new Map<string, number>();
  const enabledArray = Array.from(enabled);
  for (const id of enabledArray) {
    const n = parsePluginIdentifier(id).name ?? '';
    enabledByName.set(n, (enabledByName.get(n) ?? 0) + 1);
  }

  const errors: PluginError[] = [];
  let changed = true;

  while (changed) {
    changed = false;
    for (const p of plugins) {
      if (!enabled.has(p.source)) continue;

      for (const rawDep of p.manifest.dependencies ?? []) {
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
            reason: isBare ? (knownByName.has(dep) ? 'not-enabled' : 'not-found') : (known.has(dep) ? 'not-enabled' : 'not-found'),
          });
          changed = true;
          break;
        }
      }
    }
  }

  const demoted = new Set(
    plugins.filter(p => p.enabled && !enabled.has(p.source)).map(p => p.source),
  );

  return { demoted, errors };
}

/**
 * 查找依赖于指定插件的所有插件
 *
 * @param pluginId 要查询的插件ID
 * @param plugins 所有加载的插件
 * @returns 依赖该插件的插件名称列表
 */
export function findReverseDependents(
  pluginId: PluginId,
  plugins: readonly LoadedPlugin[],
): string[] {
  const { name: targetName } = parsePluginIdentifier(pluginId);
  return plugins
    .filter(p =>
      p.enabled &&
      (p.manifest.dependencies ?? []).some((dep: string) => {
        const { name } = parsePluginIdentifier(dep);
        return name === targetName;
      })
    )
    .map(p => p.name);
}

/**
 * 拓扑排序 - 对插件列表进行排序
 *
 * @param plugins 要排序的插件列表
 * @returns 排序后的插件列表
 */
export function topologicalSort(plugins: LoadedPlugin[]): LoadedPlugin[] {
  const graph = new Map<string, LoadedPlugin[]>();
  const inDegree = new Map<string, number>();
  const pluginMap = new Map<string, LoadedPlugin>();

  for (const plugin of plugins) {
    const key = plugin.source;
    pluginMap.set(key, plugin);
    graph.set(key, []);
    inDegree.set(key, 0);
  }

  for (const plugin of plugins) {
    for (const dep of plugin.manifest.dependencies ?? []) {
      const depKey = qualifyDependency(dep, plugin.source);
      const existingDep = plugins.find(p => p.source === depKey || p.name === dep);
      if (existingDep) {
        graph.get(existingDep.source)?.push(plugin);
        inDegree.set(plugin.source, (inDegree.get(plugin.source) ?? 0) + 1);
      }
    }
  }

  const queue: string[] = [];
  const inDegreeArray = Array.from(inDegree.entries());
  for (const [key, degree] of inDegreeArray) {
    if (degree === 0) queue.push(key);
  }

  const sorted: LoadedPlugin[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const plugin = pluginMap.get(current);
    if (plugin) sorted.push(plugin);

    for (const neighbor of graph.get(current) ?? []) {
      const newDegree = (inDegree.get(neighbor.source) ?? 0) - 1;
      inDegree.set(neighbor.source, newDegree);
      if (newDegree === 0) queue.push(neighbor.source);
    }
  }

  return sorted;
}

/**
 * 检测依赖循环
 *
 * @param plugins 要检测的插件列表
 * @returns 如果存在循环，返回循环链；否则返回null
 */
export function detectCycle(plugins: LoadedPlugin[]): PluginId[] | null {
  const visited = new Set<PluginId>();
  const recStack = new Set<PluginId>();
  const path: PluginId[] = [];

  function dfs(pluginId: PluginId): PluginId[] | null {
    visited.add(pluginId);
    recStack.add(pluginId);
    path.push(pluginId);

    const plugin = plugins.find(p => p.source === pluginId);
    if (plugin) {
      for (const dep of plugin.manifest.dependencies ?? []) {
        const depKey = qualifyDependency(dep, pluginId);
        if (!visited.has(depKey)) {
          const cycle = dfs(depKey);
          if (cycle) return cycle;
        } else if (recStack.has(depKey)) {
          const cycleStart = path.indexOf(depKey);
          return [...path.slice(cycleStart), depKey];
        }
      }
    }

    path.pop();
    recStack.delete(pluginId);
    return null;
  }

  for (const plugin of plugins) {
    if (!visited.has(plugin.source)) {
      const cycle = dfs(plugin.source);
      if (cycle) return cycle;
    }
  }

  return null;
}
