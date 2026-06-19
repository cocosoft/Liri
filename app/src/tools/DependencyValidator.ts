/**
 * 模块依赖关系验证器
 * 验证模块间的依赖关系，检测循环依赖和缺失依赖
 */

import { readFileSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { resolveProjectRoot, resolveDataSubDir } from '@modules/core';
import {
  MODULE_DEFINITIONS,
  MODULE_INITIALIZATION_ORDER,
  validateModuleDependencies,
} from '../modules/ModuleDefinitions';
import {
  getEssentialModuleIds,
  getDeferredModuleIds,
  getOnDemandModuleIds,
  ModuleLoadPriority,
} from '../modules/LazyModuleStrategy';
import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 依赖关系验证结果
 */
interface DependencyValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  circularDependencies: string[][];
  missingDependencies: string[];
  dependencyGraph: Record<string, string[]>;
  topologicalOrder: string[];
  initializationOrderIssues: string[];
  optionalDepIssues: string[];
  versionIssues: string[];
}

/**
 * 依赖关系验证器类
 */
export class DependencyValidator {
  /**
   * 验证所有模块的依赖关系
   */
  validateAllDependencies(): DependencyValidationResult {
    const result: DependencyValidationResult = {
      valid: true,
      errors: [],
      warnings: [],
      circularDependencies: [],
      missingDependencies: [],
      dependencyGraph: {},
      topologicalOrder: [],
      initializationOrderIssues: [],
      optionalDepIssues: [],
      versionIssues: [],
    };

    // 构建依赖图
    this.buildDependencyGraph(result);

    // 检查缺失依赖
    this.checkMissingDependencies(result);

    // 检查循环依赖
    this.checkCircularDependencies(result);

    // 检查初始化顺序完整性（所有已定义模块必须在初始化顺序中）
    this.checkInitializationOrderCompleteness(result);

    // 检查初始化顺序优先级对齐
    this.checkInitializationOrderAlignment(result);

    // 验证可选依赖引用
    this.checkOptionalDependencies(result);

    // 验证模块版本格式
    this.checkModuleVersions(result);

    // 计算拓扑排序
    this.calculateTopologicalOrder(result);

    // 设置最终验证状态
    result.valid =
      result.errors.length === 0 && result.circularDependencies.length === 0;

    return result;
  }

  /**
   * 构建依赖图
   */
  private buildDependencyGraph(result: DependencyValidationResult): void {
    for (const [moduleId, definition] of Object.entries(MODULE_DEFINITIONS)) {
      result.dependencyGraph[moduleId] = [...definition.dependencies];
    }
  }

  /**
   * 检查缺失依赖
   */
  private checkMissingDependencies(result: DependencyValidationResult): void {
    for (const [moduleId, dependencies] of Object.entries(
      result.dependencyGraph
    )) {
      for (const depId of dependencies) {
        if (!MODULE_DEFINITIONS[depId]) {
          result.errors.push(`模块 ${moduleId} 依赖的模块 ${depId} 不存在`);
          result.missingDependencies.push(depId);
        }
      }
    }
  }

  /**
   * 检查循环依赖
   */
  private checkCircularDependencies(result: DependencyValidationResult): void {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    for (const moduleId of Object.keys(result.dependencyGraph)) {
      if (!visited.has(moduleId)) {
        this.detectCycle(moduleId, visited, recursionStack, [], result);
      }
    }
  }

  /**
   * 检测循环依赖
   */
  private detectCycle(
    moduleId: string,
    visited: Set<string>,
    recursionStack: Set<string>,
    path: string[],
    result: DependencyValidationResult
  ): void {
    visited.add(moduleId);
    recursionStack.add(moduleId);

    const currentPath = [...path, moduleId];

    const dependencies = result.dependencyGraph[moduleId] || [];

    for (const depId of dependencies) {
      if (!visited.has(depId)) {
        this.detectCycle(depId, visited, recursionStack, currentPath, result);
      } else if (recursionStack.has(depId)) {
        // 发现循环依赖
        const cyclePath = this.extractCyclePath(currentPath, depId);
        result.circularDependencies.push(cyclePath);
        result.errors.push(`检测到循环依赖: ${cyclePath.join(' -> ')}`);
      }
    }

    recursionStack.delete(moduleId);
  }

  /**
   * 提取循环路径
   */
  private extractCyclePath(path: string[], cycleStart: string): string[] {
    const startIndex = path.indexOf(cycleStart);
    return path.slice(startIndex);
  }

  /**
   * 检查初始化顺序完整性
   * 确保所有 MODULE_DEFINITIONS 中定义的模块都出现在 MODULE_INITIALIZATION_ORDER 中
   */
  private checkInitializationOrderCompleteness(
    result: DependencyValidationResult
  ): void {
    const orderedSet = new Set(MODULE_INITIALIZATION_ORDER);
    const definedIds = Object.keys(MODULE_DEFINITIONS);

    for (const moduleId of definedIds) {
      if (!orderedSet.has(moduleId)) {
        result.initializationOrderIssues.push(
          `模块 "${moduleId}" 已定义但未出现在 MODULE_INITIALIZATION_ORDER 中`
        );
      }
    }
  }

  /**
   * 检查初始化顺序优先级对齐
   * CRITICAL 模块应集中在 Phase 1-4，DEFERRED/ON_DEMAND 模块应在 Phase 5-8
   */
  private checkInitializationOrderAlignment(
    result: DependencyValidationResult
  ): void {
    const essentialIds = new Set(
      getEssentialModuleIds(MODULE_INITIALIZATION_ORDER)
    );
    const deferredIds = new Set(
      getDeferredModuleIds(MODULE_INITIALIZATION_ORDER)
    );
    const onDemandIds = new Set(
      getOnDemandModuleIds(MODULE_INITIALIZATION_ORDER)
    );

    // 寻找 Phase 4 和 Phase 5 的分界点（从 CRITICAL 过渡到 DEFERRED）
    let phaseBoundary = 0;
    for (let i = 0; i < MODULE_INITIALIZATION_ORDER.length; i++) {
      const moduleId = MODULE_INITIALIZATION_ORDER[i];
      if (deferredIds.has(moduleId) || onDemandIds.has(moduleId)) {
        phaseBoundary = i;
        break;
      }
    }

    // 检查 Phase 1-4 的模块（分界点之前）是否都是 CRITICAL
    for (let i = 0; i < phaseBoundary; i++) {
      const moduleId = MODULE_INITIALIZATION_ORDER[i];
      if (!essentialIds.has(moduleId)) {
        result.initializationOrderIssues.push(
          `模块 "${moduleId}" 在初始化顺序中位于 Phase 1-4（索引 ${i}），` +
            `但未声明为 CRITICAL 优先级。若该模块由 init.ts 急切加载，` +
            `请在 LazyModuleStrategy.ts 中将其设置为 CRITICAL`
        );
      }
    }

    // 检查 Phase 5-8 的模块（分界点之后）是否都是 DEFERRED 或 ON_DEMAND
    for (let i = phaseBoundary; i < MODULE_INITIALIZATION_ORDER.length; i++) {
      const moduleId = MODULE_INITIALIZATION_ORDER[i];
      if (essentialIds.has(moduleId)) {
        result.initializationOrderIssues.push(
          `模块 "${moduleId}" 在初始化顺序中位于 Phase 5-8（索引 ${i}），` +
            `但声明为 CRITICAL 优先级。延迟模块不应在启动时急切加载，` +
            `请在 LazyModuleStrategy.ts 中将其调整为 DEFERRED 或 ON_DEMAND`
        );
      }
    }
  }

  /**
   * 验证可选依赖引用
   * 检查 optionalDependencies 引用的模块是否在 MODULE_DEFINITIONS 中存在
   */
  private checkOptionalDependencies(result: DependencyValidationResult): void {
    for (const [moduleId, definition] of Object.entries(MODULE_DEFINITIONS)) {
      for (const depId of definition.optionalDependencies) {
        if (!MODULE_DEFINITIONS[depId]) {
          result.optionalDepIssues.push(
            `模块 "${moduleId}" 的可选依赖 "${depId}" 不存在于 MODULE_DEFINITIONS 中`
          );
        }
      }
    }
  }

  /**
   * 验证模块版本格式
   * 检查版本号是否遵循 semver 格式（x.y.z）
   */
  private checkModuleVersions(result: DependencyValidationResult): void {
    const semverPattern = /^\d+\.\d+\.\d+$/;

    for (const [moduleId, definition] of Object.entries(MODULE_DEFINITIONS)) {
      if (!definition.version) {
        result.versionIssues.push(`模块 "${moduleId}" 缺少版本号`);
      } else if (!semverPattern.test(definition.version)) {
        result.versionIssues.push(
          `模块 "${moduleId}" 的版本号 "${definition.version}" 不符合 semver 格式（x.y.z）`
        );
      }
    }
  }

  /**
   * 计算拓扑排序
   */
  private calculateTopologicalOrder(result: DependencyValidationResult): void {
    if (result.circularDependencies.length > 0) {
      result.warnings.push('存在循环依赖，无法计算有效的拓扑排序');
      return;
    }

    const inDegree: Record<string, number> = {};
    const queue: string[] = [];

    // 初始化入度
    for (const moduleId of Object.keys(result.dependencyGraph)) {
      inDegree[moduleId] = 0;
    }

    // 计算入度
    for (const [moduleId, dependencies] of Object.entries(
      result.dependencyGraph
    )) {
      for (const depId of dependencies) {
        inDegree[depId] = (inDegree[depId] || 0) + 1;
      }
    }

    // 找到入度为0的节点
    for (const moduleId of Object.keys(inDegree)) {
      if (inDegree[moduleId] === 0) {
        queue.push(moduleId);
      }
    }

    // 执行拓扑排序
    while (queue.length > 0) {
      const moduleId = queue.shift()!;
      result.topologicalOrder.push(moduleId);

      const dependencies = result.dependencyGraph[moduleId] || [];

      for (const depId of dependencies) {
        inDegree[depId]--;
        if (inDegree[depId] === 0) {
          queue.push(depId);
        }
      }
    }

    // 检查是否所有节点都被处理
    if (
      result.topologicalOrder.length !==
      Object.keys(result.dependencyGraph).length
    ) {
      result.warnings.push('拓扑排序未包含所有模块，可能存在循环依赖');
    }
  }

  /**
   * 生成依赖关系报告
   */
  generateDependencyReport(validation: DependencyValidationResult): string {
    let report = '# 模块依赖关系验证报告\n\n';

    report += `## 验证结果\n`;
    report += `- **状态**: ${validation.valid ? '✅ 通过' : '❌ 失败'}\n`;
    report += `- **错误数量**: ${validation.errors.length}\n`;
    report += `- **警告数量**: ${validation.warnings.length}\n`;
    report += `- **循环依赖**: ${validation.circularDependencies.length}\n`;
    report += `- **缺失依赖**: ${validation.missingDependencies.length}\n\n`;

    // 错误详情
    if (validation.errors.length > 0) {
      report += `## 错误详情\n`;
      validation.errors.forEach((error) => {
        report += `- ❌ ${error}\n`;
      });
      report += `\n`;
    }

    // 警告详情
    if (validation.warnings.length > 0) {
      report += `## 警告详情\n`;
      validation.warnings.forEach((warning) => {
        report += `- ⚠️ ${warning}\n`;
      });
      report += `\n`;
    }

    // 循环依赖详情
    if (validation.circularDependencies.length > 0) {
      report += `## 循环依赖\n`;
      validation.circularDependencies.forEach((cycle) => {
        report += `- 🔄 ${cycle.join(' -> ')} -> ${cycle[0]}\n`;
      });
      report += `\n`;
    }

    // 缺失依赖详情
    if (validation.missingDependencies.length > 0) {
      report += `## 缺失依赖\n`;
      validation.missingDependencies.forEach((depId) => {
        report += `- ❓ ${depId}\n`;
      });
      report += `\n`;
    }

    // 依赖图
    report += `## 依赖关系图\n\n`;
    report += '```mermaid\n';
    report += 'graph TD\n';

    for (const [moduleId, dependencies] of Object.entries(
      validation.dependencyGraph
    )) {
      for (const depId of dependencies) {
        report += `  ${depId} --> ${moduleId}\n`;
      }
    }

    report += '```\n\n';

    // 拓扑排序
    if (validation.topologicalOrder.length > 0) {
      report += `## 拓扑排序（初始化顺序）\n`;
      report += validation.topologicalOrder.join(' → ');
      report += `\n\n`;
    }

    // 模块统计
    report += `## 模块统计\n`;
    report += `- **总模块数**: ${Object.keys(MODULE_DEFINITIONS).length}\n`;

    const categories: Record<string, number> = {};
    for (const definition of Object.values(MODULE_DEFINITIONS)) {
      categories[definition.category] =
        (categories[definition.category] || 0) + 1;
    }

    report += `- **模块分类**:\n`;
    for (const [category, count] of Object.entries(categories)) {
      report += `  - ${category}: ${count}\n`;
    }

    // 初始化顺序问题
    if (validation.initializationOrderIssues.length > 0) {
      report += `\n## 初始化顺序问题\n`;
      validation.initializationOrderIssues.forEach((issue: string) => {
        report += `- ⚠️ ${issue}\n`;
      });
    }

    // 可选依赖问题
    if (validation.optionalDepIssues.length > 0) {
      report += `\n## 可选依赖问题\n`;
      validation.optionalDepIssues.forEach((issue: string) => {
        report += `- ⚠️ ${issue}\n`;
      });
    }

    // 版本号问题
    if (validation.versionIssues.length > 0) {
      report += `\n## 版本号问题\n`;
      validation.versionIssues.forEach((issue: string) => {
        report += `- ⚠️ ${issue}\n`;
      });
    }

    return report;
  }

  /**
   * 可视化依赖关系
   */
  visualizeDependencies(validation: DependencyValidationResult): string {
    // 生成Mermaid图表
    let mermaid = '```mermaid\n';
    mermaid += 'graph TD\n';

    // 按分类分组
    const modulesByCategory: Record<string, string[]> = {};

    for (const moduleId of Object.keys(validation.dependencyGraph)) {
      const category = MODULE_DEFINITIONS[moduleId]?.category || 'other';
      if (!modulesByCategory[category]) {
        modulesByCategory[category] = [];
      }
      modulesByCategory[category].push(moduleId);
    }

    // 添加子图
    for (const [category, modules] of Object.entries(modulesByCategory)) {
      mermaid += `  subgraph ${category}\n`;
      for (const moduleId of modules) {
        mermaid += `    ${moduleId}[${MODULE_DEFINITIONS[moduleId]?.displayName || moduleId}]\n`;
      }
      mermaid += `  end\n`;
    }

    // 添加依赖关系
    for (const [moduleId, dependencies] of Object.entries(
      validation.dependencyGraph
    )) {
      for (const depId of dependencies) {
        mermaid += `  ${depId} --> ${moduleId}\n`;
      }
    }

    mermaid += '```';

    return mermaid;
  }

  /**
   * 导出依赖关系数据
   */
  exportDependencyData(validation: DependencyValidationResult): any {
    return {
      summary: {
        valid: validation.valid,
        totalModules: Object.keys(MODULE_DEFINITIONS).length,
        totalDependencies: Object.values(validation.dependencyGraph).reduce(
          (sum, deps) => sum + deps.length,
          0
        ),
        errors: validation.errors.length,
        warnings: validation.warnings.length,
        circularDependencies: validation.circularDependencies.length,
        missingDependencies: validation.missingDependencies.length,
      },
      dependencyGraph: validation.dependencyGraph,
      topologicalOrder: validation.topologicalOrder,
      modules: Object.fromEntries(
        Object.entries(MODULE_DEFINITIONS).map(([id, def]) => [
          id,
          {
            name: def.name,
            displayName: def.displayName,
            category: def.category,
            dependencies: def.dependencies,
            optionalDependencies: def.optionalDependencies,
          },
        ])
      ),
    };
  }
}

/**
 * 便捷验证函数
 */
export function validateDependencies(): DependencyValidationResult {
  const validator = new DependencyValidator();
  return validator.validateAllDependencies();
}

/**
 * 生成依赖关系报告
 */
export function generateDependencyReport(): string {
  const validator = new DependencyValidator();
  const validation = validator.validateAllDependencies();
  return validator.generateDependencyReport(validation);
}

/**
 * 可视化依赖关系
 */
export function visualizeDependencies(): string {
  const validator = new DependencyValidator();
  const validation = validator.validateAllDependencies();
  return validator.visualizeDependencies(validation);
}

/**
 * 导出依赖关系数据
 */
export function exportDependencyData(): any {
  const validator = new DependencyValidator();
  const validation = validator.validateAllDependencies();
  return validator.exportDependencyData(validation);
}

/**
 * 快照验证结果
 */
interface SnapshotValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * 定义核心模块集合（架构基石，依赖关系不可变更）
 */
const CORE_MODULES = new Set(['core', 'infrastructure', 'error']);

/**
 * 加载依赖图快照
 */
function loadSnapshot(): any | null {
  const snapshotPath = join(resolveProjectRoot(), 'dependency-snapshot.json');
  if (!existsSync(snapshotPath)) {
    return null;
  }
  return JSON.parse(readFileSync(snapshotPath, 'utf-8'));
}

/**
 * 验证依赖图与基准快照的一致性
 */
function validateSnapshotConsistency(): SnapshotValidationResult {
  const errors: string[] = [];
  const snapshot = loadSnapshot();

  if (!snapshot) {
    return { valid: true, errors: [] };
  }

  // 1. 检查快照中的模块仍然存在
  for (const moduleId of Object.keys(snapshot.modules)) {
    if (!MODULE_DEFINITIONS[moduleId]) {
      errors.push(`[快照] 模块 "${moduleId}" 已在快照中注册但当前代码中被删除`);
    }
  }

  // 2. 检查核心模块的依赖关系不变
  for (const moduleId of CORE_MODULES) {
    const snapshotModule = snapshot.modules[moduleId];
    const currentModule = MODULE_DEFINITIONS[moduleId];

    if (!snapshotModule || !currentModule) continue;

    const snapshotDeps = JSON.stringify(
      [...snapshotModule.dependencies].sort()
    );
    const currentDeps = JSON.stringify([...currentModule.dependencies].sort());

    if (snapshotDeps !== currentDeps) {
      errors.push(
        `[快照] 核心模块 "${moduleId}" 的依赖关系已变更: 基准=${snapshotDeps}, 当前=${currentDeps}`
      );
    }
  }

  // 3. 检查 MODULE_INITIALIZATION_ORDER 完整性
  const definedModuleIds = new Set(Object.keys(MODULE_DEFINITIONS));
  const orderedModuleIds = new Set(MODULE_INITIALIZATION_ORDER);

  for (const moduleId of definedModuleIds) {
    if (!orderedModuleIds.has(moduleId)) {
      errors.push(`[快照] 模块 "${moduleId}" 已定义但未出现在初始化顺序中`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * 运行依赖关系验证
 */
async function runDependencyValidation(): Promise<void> {
  logger.info('开始验证模块依赖关系...');
  let hasError = false;

  try {
    const validator = new DependencyValidator();
    const validation = validator.validateAllDependencies();

    logger.info('依赖关系验证完成:');
    logger.info(`- 状态: ${validation.valid ? '通过' : '失败'}`);
    logger.info(`- 错误: ${validation.errors.length}`);
    logger.info(`- 警告: ${validation.warnings.length}`);
    logger.info(`- 循环依赖: ${validation.circularDependencies.length}`);
    logger.info(`- 缺失依赖: ${validation.missingDependencies.length}`);

    if (!validation.valid) {
      hasError = true;
      logger.info('\n错误详情:');
      validation.errors.forEach((error) => logger.info(`  - ${error}`));
    }

    if (validation.warnings.length > 0) {
      logger.info('\n警告详情:');
      validation.warnings.forEach((warning) => logger.info(`  - ${warning}`));
    }

    logger.info('\n检查依赖图快照一致性...');
    const snapshotResult = validateSnapshotConsistency();

    if (snapshotResult.errors.length > 0) {
      hasError = true;
      logger.info('快照检查失败:');
      snapshotResult.errors.forEach((error) => logger.info(`  - ${error}`));
    } else {
      logger.info('快照检查通过');
    }

    const report = validator.generateDependencyReport(validation);

    const reportPath = join(
      resolveDataSubDir('reports'),
      'dependency_validation_report.md'
    );
    writeFileSync(reportPath, report);

    logger.info(`\n依赖关系报告已保存到: ${reportPath}`);

    if (hasError) {
      process.exit(1);
    }
  } catch (error) {
    logger.error('依赖关系验证失败:', { error });
    process.exit(1);
  }
}

// 导出运行函数
export { runDependencyValidation };

// 如果直接运行此文件，则执行验证
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  runDependencyValidation().catch((e) =>
    logger.error('依赖关系验证失败:', { error: e })
  );
}
