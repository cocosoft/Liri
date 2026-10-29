/**
 * knowledge/domain 桶导出（S1，2026-10-29，issue #9）
 *
 * 收敛 `knowledge/index.ts` 对 `./domain/DomainManager` 的**深导入**：域内以后新增模块
 * （如域判定 / 域迁移）只需在此追加一行，调用方不必知道具体文件名。
 * **对外导出面不变** —— 仍是 `DomainManager` + 其 5 个类型，消费方无需改动。
 */
export { DomainManager } from './DomainManager';
export type {
  DomainInfo,
  DomainQueryHints,
  CompileRules,
  DomainConfig,
  DomainSummary,
} from './DomainManager';
