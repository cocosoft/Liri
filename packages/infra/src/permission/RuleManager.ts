/**
 * 规则管理器
 * 负责管理权限规则的加载、保存、添加、删除等操作
 */
import { join, dirname } from 'path';
import { tmpdir } from 'node:os';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
// C1（2026-10-09）：规则 id 熵源改用 crypto
import { randomIdSuffix } from '@openliri/infra/utils/common';
import { createHash } from 'crypto';
import { resolvePermissionsDir } from '@openliri/infra/environment';
import {
  PermissionRule,
  PermissionBehavior,
  PermissionRuleSource,
  type RuleMatchOptions,
  createPermissionRule,
  permissionRuleValueFromString,
  permissionRuleValueToString,
  isRuleMatch,
  isToolNameMatch,
  isApprovalOriginatedRule,
} from './types/PermissionRule';
import { getLogger } from '@openliri/infra/monitoring';
import { handleError } from '@openliri/infra/error';

import {
  filterPausedApprovalRules,
  type ApprovalPauseScope,
} from './approvalPause';

const logger = getLogger('permission:ruleManager');

/**
 * 同一匹配键、**不同行为**的冲突（R0 健康视图）。
 *
 * 键与 `addRule` 的 `sameKey` 同口径（`source + toolName + contentPattern +
 * inputFingerprint + workspaceRoot`）：同键不同 behavior 时判定结果由顺序隐式决定，
 * 用户不可见 ⇒ 必须显式暴露。运行期 `addRule` 已互斥，这里主要抓**手工编辑文件**。
 */
export interface RuleKeyConflict {
  /** 冲突键（`|` 拼接的可读形式） */
  key: string;
  /** 该键上出现过的行为（去重，保持首见顺序） */
  behaviors: string[];
  /** 该键上的规则 id（含历史手工条目，可能为空串 id） */
  ids: string[];
}

/**
 * 规则文件健康快照（R0，纯只读；`GET /v1/permissions/rules/health` 的数据源）。
 */
export interface RuleFileHealth {
  /** 规则文件绝对路径 */
  path: string;
  /** 文件是否存在 */
  exists: boolean;
  /** 文件字节数（读不到 ⇒ null，不编造） */
  sizeBytes: number | null;
  /** 文件最后修改时间 ISO（读不到 ⇒ null） */
  lastModified: string | null;
  /** 当前**磁盘**内容 hash（文件不存在 / 不可读 ⇒ null） */
  fileHash: string | null;
  /** 内存已加载内容的 hash（上次 load/save 时记录） */
  loadedHash: string | null;
  /** 磁盘与内存 hash 不一致 ⇒ 有外部修改尚未按 30s 轮询重载 */
  externalChangeDetected: boolean;
  /** 文件 JSON 解析/形状错误（无错 ⇒ null） */
  parseError: string | null;
  /** 文件里的规则条数（解析失败 ⇒ null） */
  fileRuleCount: number | null;
  /** 内存里生效的规则条数 */
  memoryRuleCount: number;
  /** 重复条目数（同键同行为，会被加载/保存时去重） */
  duplicateCount: number;
  /** 同键不同行为的冲突（优先按文件内容判定；文件不可解析时按内存规则） */
  conflicts: RuleKeyConflict[];
}

/**
 * 规则上下文接口
 */
export interface RuleContext {
  /**
   * 总是允许的规则（按来源分组）
   */
  alwaysAllowRules: Partial<Record<PermissionRuleSource, string[]>>;
  /**
   * 总是拒绝的规则（按来源分组）
   */
  alwaysDenyRules: Partial<Record<PermissionRuleSource, string[]>>;
  /**
   * 总是询问的规则（按来源分组）
   */
  alwaysAskRules: Partial<Record<PermissionRuleSource, string[]>>;
  /**
   * F2（2026-11-17）：本次判定的暂停上下文（会话 / 工作区根）。
   *
   * 由 `decisionPipeline` / `simulate` 从 `PermissionContext` 取下并挂在这里，
   * `getRulesByBehavior` 据此过滤审批生成规则 ⇒ **真实判定链**的会话级 / 工作区级
   * 「暂停持久化放行」才能生效（缺省 ⇒ 只按全局暂停）。
   */
  pauseScope?: ApprovalPauseScope;
}

/**
 * P1-1: 按 (source + toolName + contentPattern + inputFingerprint + behavior) 幂等去重，保留最旧规则。
 * 供 saveRules/loadRules/addRule 复用，防止重复规则累积（历史曾出现 5 条重复 bash 规则）。
 *
 * LRO-D2（2026-10-26）：**键补 `inputFingerprint`**。原键只看 `contentPattern`，而指纹规则的
 * `contentPattern` 恒为空 ⇒ 同工具的两条**不同指纹** allow 被判重复、后写被静默丢弃
 * （「始终允许」对第二个命令永久无效）；指纹 allow 与工具级 allow 也会互相顶掉。
 */
export function deduplicateRules(rules: PermissionRule[]): PermissionRule[] {
  const seen = new Map<string, PermissionRule>();
  for (const rule of rules) {
    const key = [
      rule.source,
      rule.behavior,
      rule.toolName,
      rule.contentPattern ?? '',
      rule.inputFingerprint ?? '',
      rule.workspaceRoot ?? '',
    ].join('|');
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, rule);
      continue;
    }
    // 保留更早创建的规则；若同批 createdAt 相等则保留现有（first-wins）
    const ruleTs =
      rule.createdAt instanceof Date ? rule.createdAt.getTime() : 0;
    const existingTs =
      existing.createdAt instanceof Date ? existing.createdAt.getTime() : 0;
    if (ruleTs < existingTs) {
      seen.set(key, rule);
    }
  }
  return Array.from(seen.values());
}

/**
 * 冲突检测键（R1.5，2026-11-17；对外评审 P0-3）。
 *
 * 与运行期的两套键**刻意不同**（三者各司其职，见治理方案 §11.2）：
 * - `addRule#sameKey`（含 `source`）：运行期同键互斥，"改用户规则不静默删审批规则"；
 * - `deduplicateRules`（含 `source` + `behavior`）：文件级去重；
 * - **本函数**（不含 `source` / `behavior`，含 `workspaceRoot`）：**只报告冲突** ——
 *   同一次调用上「用户 allow + 审批 deny」也会互相遮蔽，只按来源分组会漏报。
 */
export function buildRuleConflictKey(rule: {
  toolName: string;
  contentPattern?: string;
  inputFingerprint?: string;
  workspaceRoot?: string;
}): string {
  return [
    rule.toolName,
    rule.contentPattern ?? '',
    rule.inputFingerprint ?? '',
    rule.workspaceRoot ?? '',
  ].join('|');
}

/**
 * 收集"同一匹配键、不同行为"的冲突（R0 健康视图；键口径见 `buildRuleConflictKey`，纯函数）。
 *
 * 运行期 `addRule` 已按 `(source + 匹配条件)` 互斥，本函数主要抓：
 * ① **手工编辑 `tool_rules.json`** 产生的 allow/deny 并存；
 * ② **跨来源**（用户规则 vs 审批生成）同键异行为 —— 判定结果由顺序隐式决定，用户完全不可见。
 */
export function collectRuleKeyConflicts(
  rules: PermissionRule[]
): RuleKeyConflict[] {
  const byKey = new Map<string, { behaviors: string[]; ids: string[] }>();
  for (const rule of rules) {
    const key = buildRuleConflictKey(rule);
    const entry = byKey.get(key) ?? { behaviors: [], ids: [] };
    const behavior = String(rule.behavior);
    if (!entry.behaviors.includes(behavior)) entry.behaviors.push(behavior);
    entry.ids.push(rule.id ?? '');
    byKey.set(key, entry);
  }
  return Array.from(byKey.entries())
    .filter(([, entry]) => entry.behaviors.length > 1)
    .map(([key, entry]) => ({ key, ...entry }));
}

/**
 * 找出**同键不同行为**的既有规则（R2 写入口校验，纯函数）。
 *
 * `force` 覆盖前必须先用它判断"被覆盖的是不是审批生成规则"（那种规则只可撤销、不可编辑）。
 */
export function findConflictingRules(
  rules: PermissionRule[],
  candidate: {
    toolName: string;
    contentPattern?: string;
    inputFingerprint?: string;
    workspaceRoot?: string;
    behavior: PermissionBehavior;
  },
  options: { excludeId?: string } = {}
): PermissionRule[] {
  const key = buildRuleConflictKey(candidate);
  return rules.filter(
    (rule) =>
      rule.id !== options.excludeId &&
      String(rule.behavior) !== String(candidate.behavior) &&
      buildRuleConflictKey(rule) === key
  );
}

/** 找出**同键同行为**的重复规则（R2 写入口校验；saveRules 也会去重，这里提前报错更可解释） */
export function findDuplicateRules(
  rules: PermissionRule[],
  candidate: {
    toolName: string;
    contentPattern?: string;
    inputFingerprint?: string;
    workspaceRoot?: string;
    behavior: PermissionBehavior;
  },
  options: { excludeId?: string } = {}
): PermissionRule[] {
  const key = buildRuleConflictKey(candidate);
  return rules.filter(
    (rule) =>
      rule.id !== options.excludeId &&
      String(rule.behavior) === String(candidate.behavior) &&
      buildRuleConflictKey(rule) === key
  );
}

/**
 * 规则管理器类
 */
export class RuleManager {
  /**
   * R5（2026-11-17）：用给定规则集构造**内存态**实例（不读盘、不写盘）。
   *
   * 用途：保存前「规则影响预演」（`PermissionManager#previewRuleImpact`）——
   * 在候选规则生效**之前**跑基准命令对比判定，绝不触碰生产实例与规则文件。
   * 因为 `ruleSource` 指向一个不存在的临时路径 ⇒ 后续 `checkExternalChanges` 不会重载覆盖。
   */
  static createInMemory(rules: PermissionRule[]): RuleManager {
    const manager = new RuleManager();
    manager.ruleSource = join(
      tmpdir(),
      `liri-rule-preview-${randomIdSuffix(8)}.json`
    );
    manager.rules = rules.map((rule) => ({ ...rule }));
    manager.rulesFileHash = null;
    return manager;
  }

  /**
   * 权限规则数组
   */
  private rules: PermissionRule[] = [];

  /**
   * 规则存储路径（P1-6：统一至权限数据目录 permissions/，与细粒度存储同目录）
   */
  private ruleSource: string = join(resolvePermissionsDir(), 'tool_rules.json');

  /**
   * P2-5: 规则文件 Hash（检测外部修改，语义同 ConfigManager）。
   * loadRules/saveRules 后同步更新；checkExternalChanges 周期性比对。
   */
  private rulesFileHash: string | null = null;

  /**
   * 当前内存快照是否已从 `ruleSource` 加载过（2026-11-26 fail-safe 依据）。
   *
   * 为什么必须记：`saveRules()` 是**整份覆盖写**。未加载过该文件的实例（旧影子实例 /
   * 脚本里的 `new RuleManager()`）一旦触发 `addRule` / `removeRule` / `clearRules`，
   * 就会把自己那份（常为空）快照整份写回，**把他人的规则全部抹掉**（2026-11-26 真机事故：
   * `tool_rules.json` 被写成 `[]`）。⇒ 写前先按文件同步快照。
   */
  private sourceLoaded = false;

  /** P2-5: 上次 Hash 校验时间戳 */
  private lastHashCheckTime = 0;

  /** P2-5: Hash 校验间隔（毫秒），与 ConfigManager 一致 */
  private static readonly HASH_CHECK_INTERVAL_MS = 30_000;

  /**
   * 所有规则来源的优先级（数值越大优先级越高）
   */
  private static readonly SOURCE_PRIORITIES: Record<
    PermissionRuleSource,
    number
  > = {
    [PermissionRuleSource.SYSTEM]: 9,
    [PermissionRuleSource.SESSION]: 8,
    [PermissionRuleSource.COMMAND]: 7,
    [PermissionRuleSource.CLI_ARG]: 6,
    [PermissionRuleSource.POLICY_SETTINGS]: 5,
    [PermissionRuleSource.FLAG_SETTINGS]: 4,
    [PermissionRuleSource.LOCAL_SETTINGS]: 3,
    [PermissionRuleSource.PROJECT_SETTINGS]: 2,
    [PermissionRuleSource.USER_SETTINGS]: 1,
    // LRO-07（2026-10-26）：规则库文件与用户设置同级（两者都是"本机显式规则"）
    [PermissionRuleSource.RULE_STORE]: 1,
  };

  /**
   * 所有规则来源列表
   */
  private static readonly ALL_SOURCES: PermissionRuleSource[] =
    Object.values(PermissionRuleSource);

  /**
   * 加载权限规则
   * @returns 权限规则数组
   */
  loadRules(): PermissionRule[] {
    try {
      // 确保数据目录存在
      const dataDir = dirname(this.ruleSource);
      if (!existsSync(dataDir)) {
        mkdirSync(dataDir, { recursive: true });
      }

      // 读取规则文件
      if (existsSync(this.ruleSource)) {
        const rulesData = readFileSync(this.ruleSource, 'utf8');
        this.rules = JSON.parse(rulesData);
        // P2-5: 记录文件 hash，供外部修改检测比对
        this.rulesFileHash = this.computeHash(rulesData);
        // 2026-11-26：读成功即视为"快照来自该文件" —— 必须在下方的迁移/去重回写之前置位，
        // 否则 `saveRules` 的写前守卫会再次触发 `loadRules`（递归）。
        this.sourceLoaded = true;

        // 转换日期字符串为Date对象
        this.rules.forEach((rule) => {
          if (typeof rule.createdAt === 'string') {
            rule.createdAt = new Date(rule.createdAt);
          }
          if (typeof rule.updatedAt === 'string') {
            rule.updatedAt = new Date(rule.updatedAt);
          }
          // R3：审批时间同样按 Date 还原（缺失 ⇒ 保持 undefined，UI 回落 createdAt）
          if (typeof rule.approvedAt === 'string') {
            rule.approvedAt = new Date(rule.approvedAt);
          }
        });

        // LRO-07（2026-10-26）：来源标签迁移 —— 本文件里的规则**都来自规则库**，
        // 历史数据却标成 `userSettings`（磁盘上没有 settings.json）⇒ 统一改为 `ruleStore`，
        // 使 deny 文案/面板显示与真实来源一致（不伪造来源）。
        let relabeled = 0;
        for (const rule of this.rules) {
          if (rule.source === PermissionRuleSource.USER_SETTINGS) {
            rule.source = PermissionRuleSource.RULE_STORE;
            relabeled++;
          }
        }
        if (relabeled > 0) {
          logger.info('ruleSourceRelabeled: 规则库来源标签迁移', {
            count: relabeled,
            to: PermissionRuleSource.RULE_STORE,
          });
          this.saveRules(this.rules);
        }

        // P1-1: 加载时清理历史重复规则（启动迁移），并回写文件
        const deduped = deduplicateRules(this.rules);
        if (deduped.length !== this.rules.length) {
          logger.info('ruleDeduped: 加载时清理重复规则', {
            before: this.rules.length,
            after: deduped.length,
          });
          this.rules = deduped;
          this.saveRules(this.rules);
        }
      } else {
        // 文件不存在：重置 hash（外部删除后重新创建需重新校验）
        this.rulesFileHash = null;
        // "文件不存在 ⇒ 空规则"是合法的已加载状态（首次写盘必须允许）
        this.sourceLoaded = true;
      }
    } catch (error) {
      void handleError(error, {
        module: 'permission:rules',
        action: 'load_rules',
      });
    }
    return this.rules;
  }

  /**
   * 写前保证内存快照来自 `ruleSource`（2026-11-26 fail-safe）。
   *
   * 未加载过 ⇒ 先按文件重建快照，再让调用方在其上做**单条**增删；
   * 文件读不出来（不存在以外，如 JSON 损坏）⇒ 返回 `false`，调用方**不得覆盖写**。
   */
  private ensureSnapshotBeforeWrite(operation: string): boolean {
    if (this.sourceLoaded) return true;
    logger.warn('规则写前发现快照未加载，先按文件同步（避免整份覆盖）', {
      operation,
      ruleSource: this.ruleSource,
    });
    this.loadRules();
    return this.sourceLoaded;
  }

  /**
   * 保存权限规则
   * @param rules 权限规则数组
   */
  saveRules(rules: PermissionRule[]): void {
    try {
      // fail-safe（2026-11-26）：整份覆盖写之前，必须确认内存快照确实来自该文件；
      // 否则跳过写入（宁可这次没落盘，也不能把他人的规则抹成空）。
      if (!this.ensureSnapshotBeforeWrite('saveRules') && existsSync(this.ruleSource)) {
        logger.error('规则文件无法读取，拒绝整份覆盖写（保留磁盘现状）', {
          ruleSource: this.ruleSource,
          attempted: rules.length,
        });
        return;
      }
      // 确保数据目录存在
      const dataDir = dirname(this.ruleSource);
      if (!existsSync(dataDir)) {
        mkdirSync(dataDir, { recursive: true });
      }

      // P1-1: 防御性去重（文件级，防止历史/并发累积的重复项）
      const deduped = deduplicateRules(rules);
      if (deduped.length !== rules.length) {
        logger.info('ruleDeduped: 保存时清理重复规则', {
          before: rules.length,
          after: deduped.length,
        });
      }

      // 保存规则文件
      const rulesData = JSON.stringify(deduped, null, 2);
      writeFileSync(this.ruleSource, rulesData);
      this.rules = deduped;
      // P2-5: 自写后同步 hash，避免下次校验误判为外部修改
      this.rulesFileHash = this.computeHash(rulesData);
    } catch (error) {
      void handleError(error, {
        module: 'permission:rules',
        action: 'save_rules',
      });
    }
  }

  /**
   * 添加规则（幂等去重 + **同键互斥**）
   *
   * 键 = `(source, toolName, contentPattern, inputFingerprint)`：
   * - 同键同 behavior ⇒ 复用旧规则（仅刷新 `updatedAt`），避免重复累积；
   * - 同键**不同 behavior** ⇒ **替换**旧规则（后写为准）并留日志。
   *
   * 为什么"同键不同 behavior 必须互斥"（LRO-08 / LRO-D2，2026-10-26）：
   * 事故实测里 `tool_rules.json` 同一 `(file_write, 指纹)` 上同时存在 allow 与 deny（相隔 1ms），
   * 两者都生效、由判定顺序隐式决定谁赢；且旧去重键含 behavior ⇒ **永远不会**把这对冲突清掉。
   * 用户对"同一次调用"的最新表态应当生效，旧规则留着只会变成 100% 无效的影子规则。
   * @param rule 权限规则
   */
  addRule(rule: PermissionRule): void {
    // fail-safe（2026-11-26）：先按文件同步快照，再在**其**上追加 —— 否则本次追加会被
    // 随后的"整份覆盖写"抹掉，或反过来把他人的规则抹掉。
    if (!this.ensureSnapshotBeforeWrite('addRule')) {
      logger.error('规则文件无法读取，跳过添加（保留磁盘现状）', {
        ruleSource: this.ruleSource,
        toolName: rule.toolName,
      });
      return;
    }
    const sameKey = (r: PermissionRule): boolean =>
      r.source === rule.source &&
      r.toolName === rule.toolName &&
      (r.contentPattern ?? null) === (rule.contentPattern ?? null) &&
      (r.inputFingerprint ?? null) === (rule.inputFingerprint ?? null) &&
      (r.workspaceRoot ?? null) === (rule.workspaceRoot ?? null);

    const existingIdx = this.rules.findIndex(
      (r) => sameKey(r) && r.behavior === rule.behavior
    );
    if (existingIdx !== -1) {
      // 保留最旧规则，仅刷新 updatedAt，避免重复累积
      const existing = this.rules[existingIdx];
      existing.updatedAt = new Date();
      this.saveRules(this.rules);
      logger.info('ruleDeduped', {
        id: existing.id,
        rule: this.stringifyRule(existing),
      });
      return;
    }

    // 同键不同 behavior ⇒ 替换（后写为准）
    const conflicting = this.rules.find(
      (r) => sameKey(r) && r.behavior !== rule.behavior
    );
    if (conflicting) {
      this.rules = this.rules.filter((r) => r.id !== conflicting.id);
      logger.info('ruleReplaced', {
        replacedId: conflicting.id,
        replacedBehavior: conflicting.behavior,
        newId: rule.id,
        newBehavior: rule.behavior,
        toolName: rule.toolName,
        inputFingerprint: rule.inputFingerprint,
      });
    }

    this.rules.push(rule);
    this.saveRules(this.rules);
    logger.info('ruleAdded', {
      id: rule.id,
      rule: this.stringifyRule(rule),
    });
  }

  /**
   * 删除规则
   * @param rule 权限规则
   */
  removeRule(rule: PermissionRule): void {
    // fail-safe（2026-11-26）：未同步过文件 ⇒ 先同步，避免用自有快照整份覆盖他人规则
    if (!this.ensureSnapshotBeforeWrite('removeRule')) {
      logger.error('规则文件无法读取，跳过删除（保留磁盘现状）', {
        ruleSource: this.ruleSource,
        ruleId: rule.id,
      });
      return;
    }
    this.rules = this.rules.filter((r) => r.id !== rule.id);
    this.saveRules(this.rules);
  }

  /**
   * 清空所有规则
   */
  clearRules(): void {
    // fail-safe（2026-11-26）：`clearRules` 会写出 `[]`，必须先确认快照来自该文件，
    // 否则一次"清空内存"就会把磁盘上的全部规则抹掉。
    if (!this.ensureSnapshotBeforeWrite('clearRules')) {
      logger.error('规则文件无法读取，跳过清空（保留磁盘现状）', {
        ruleSource: this.ruleSource,
      });
      return;
    }
    this.rules = [];
    this.saveRules(this.rules);
  }

  /**
   * 获取规则
   * @param source 规则来源（可选）
   * @param behavior 权限行为（可选）
   * @returns 权限规则数组
   */
  getRules(
    source?: PermissionRuleSource,
    behavior?: PermissionBehavior
  ): PermissionRule[] {
    // P2-5: 读取前检测外部文件修改（30s 惰性轮询），保证决策/列表使用最新规则
    this.checkExternalChanges();

    let filteredRules = [...this.rules];

    if (source) {
      filteredRules = filteredRules.filter((rule) => rule.source === source);
    }

    if (behavior) {
      filteredRules = filteredRules.filter(
        (rule) => rule.behavior === behavior
      );
    }

    // 按优先级排序，优先级高的在前
    return filteredRules.sort((a, b) => b.priority - a.priority);
  }

  /**
   * P2-5: 检测规则文件外部修改（30s 惰性轮询，语义同 ConfigManager）。
   * 文件 hash 变化时自动重载规则；由 getRules 等读取入口触发，决策/列表读取始终使用最新规则。
   */
  checkExternalChanges(): void {
    if (!this.shouldVerifyHash()) return;
    this.lastHashCheckTime = Date.now();
    try {
      const content = this.readRulesFileSnapshot();
      if (content === null) {
        // 文件被删除：若内存仍有规则，视为外部清空，重载为空
        if (this.rulesFileHash !== null && this.rules.length > 0) {
          logger.info('tool_rules.json 已删除，清空内存规则', {
            before: this.rules.length,
          });
          this.rulesFileHash = null;
          this.loadRules();
        }
        return;
      }
      const hash = this.computeHash(content);
      if (this.rulesFileHash !== null && hash !== this.rulesFileHash) {
        logger.info('tool_rules.json 外部修改检测，自动重载规则', {
          before: this.rules.length,
        });
        this.loadRules();
      }
    } catch (error) {
      logger.warn('tool_rules.json hash 校验失败，跳过本次校验', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** P2-5: 是否到达 Hash 校验间隔 */
  private shouldVerifyHash(): boolean {
    return (
      Date.now() - this.lastHashCheckTime >= RuleManager.HASH_CHECK_INTERVAL_MS
    );
  }

  /** P2-5: 无锁读取规则文件内容（用于 Hash 比对） */
  private readRulesFileSnapshot(): string | null {
    try {
      if (!existsSync(this.ruleSource)) return null;
      return readFileSync(this.ruleSource, 'utf8');
    } catch {
      return null;
    }
  }

  /** P2-5: 计算规则文件内容 Hash */
  private computeHash(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  /**
   * 解析规则字符串
   * @param ruleString 规则字符串
   * @returns 权限规则
   */
  parseRuleString(ruleString: string): PermissionRule {
    // 解析规则字符串，例如："allow:Bash" 或 "deny:Bash:rm -rf"
    const parts = ruleString.split(':');
    const behavior = parts[0] as PermissionBehavior;
    const toolName = parts[1];
    const contentPattern = parts.slice(2).join(':');

    return {
      id: `rule_${Date.now()}_${randomIdSuffix(9)}`,
      behavior,
      toolName,
      contentPattern: contentPattern || undefined,
      source: PermissionRuleSource.USER_SETTINGS,
      priority: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  /**
   * 规则字符串化
   * @param rule 权限规则
   * @returns 规则字符串
   */
  stringifyRule(rule: PermissionRule): string {
    let ruleString = `${rule.behavior}:${rule.toolName}`;
    if (rule.contentPattern) {
      ruleString += `:${rule.contentPattern}`;
    }
    return ruleString;
  }

  /**
   * 更新规则
   * @param rule 权限规则
   */
  updateRule(rule: PermissionRule): void {
    const index = this.rules.findIndex((r) => r.id === rule.id);
    if (index !== -1) {
      rule.updatedAt = new Date();
      this.rules[index] = rule;
      this.saveRules(this.rules);
    }
  }

  /**
   * 根据ID获取规则
   * @param ruleId 规则ID
   * @returns 权限规则或undefined
   */
  getRuleById(ruleId: string): PermissionRule | undefined {
    return this.rules.find((rule) => rule.id === ruleId);
  }

  /**
   * 设置规则存储路径
   * @param ruleSource 规则存储路径
   */
  setRuleSource(ruleSource: string): void {
    this.ruleSource = ruleSource;
    // P2-5: 切换源后重置 hash，新文件需重新加载与校验
    this.rulesFileHash = null;
    this.lastHashCheckTime = 0;
    // 2026-11-26：换源后"是否已加载"同样作废 —— 下一次写盘前必须重新按新源同步
    this.sourceLoaded = false;
  }

  /**
   * 获取规则存储路径
   * @returns 规则存储路径
   */
  getRuleSource(): string {
    return this.ruleSource;
  }

  /**
   * R0（2026-11-17）：规则文件健康快照 —— **纯只读**，不触发重载、不写文件。
   *
   * 与 `checkExternalChanges()` 的分工：那个是"发现外部修改后自动重载"，本方法只**报告**
   * 当前事实（磁盘 hash / 内存 hash / 解析错误 / 同键冲突），供设置页与排障使用；
   * 若此处也顺手重载，健康视图就永远看不到"外部已改、内存未跟"的中间态。
   */
  getRuleFileHealth(): RuleFileHealth {
    const exists = existsSync(this.ruleSource);
    let sizeBytes: number | null = null;
    let lastModified: string | null = null;
    if (exists) {
      try {
        const stat = statSync(this.ruleSource);
        sizeBytes = stat.size;
        lastModified = stat.mtime.toISOString();
      } catch {
        // @ignore-catch: 元数据不可读时保持 null（不编造大小/时间），文件内容另行判定
      }
    }

    const content = this.readRulesFileSnapshot();
    const fileHash = content === null ? null : this.computeHash(content);

    let parseError: string | null = null;
    let fileRules: PermissionRule[] | null = null;
    if (content !== null) {
      try {
        const parsed: unknown = JSON.parse(content);
        if (!Array.isArray(parsed)) {
          throw new Error('规则文件顶层必须是数组');
        }
        fileRules = parsed as PermissionRule[];
      } catch (error) {
        parseError = error instanceof Error ? error.message : String(error);
      }
    }

    // 冲突 / 重复以**文件内容**为准（手工改文件正是要抓的场景）；
    // 文件缺失或解析失败时回落到内存规则，避免"文件坏了 ⇒ 健康视图一片空白"。
    const inspected = fileRules ?? this.rules;

    return {
      path: this.ruleSource,
      exists,
      sizeBytes,
      lastModified,
      fileHash,
      loadedHash: this.rulesFileHash,
      externalChangeDetected:
        fileHash !== null &&
        this.rulesFileHash !== null &&
        fileHash !== this.rulesFileHash,
      parseError,
      fileRuleCount: fileRules ? fileRules.length : null,
      memoryRuleCount: this.rules.length,
      duplicateCount: inspected.length - deduplicateRules(inspected).length,
      conflicts: collectRuleKeyConflicts(inspected),
    };
  }

  /**
   * 从规则上下文加载规则
   * @param context 规则上下文
   */
  loadFromContext(context: RuleContext): void {
    const newRules: PermissionRule[] = [];

    // 加载 allow 规则
    for (const source of RuleManager.ALL_SOURCES) {
      const rules = context.alwaysAllowRules[source];
      if (rules) {
        for (const ruleString of rules) {
          const ruleValue = permissionRuleValueFromString(ruleString);
          newRules.push(
            createPermissionRule({
              behavior: PermissionBehavior.ALLOW,
              toolName: ruleValue.toolName,
              contentPattern: ruleValue.ruleContent,
              source,
              priority: RuleManager.SOURCE_PRIORITIES[source],
            })
          );
        }
      }
    }

    // 加载 deny 规则
    for (const source of RuleManager.ALL_SOURCES) {
      const rules = context.alwaysDenyRules[source];
      if (rules) {
        for (const ruleString of rules) {
          const ruleValue = permissionRuleValueFromString(ruleString);
          newRules.push(
            createPermissionRule({
              behavior: PermissionBehavior.DENY,
              toolName: ruleValue.toolName,
              contentPattern: ruleValue.ruleContent,
              source,
              priority: RuleManager.SOURCE_PRIORITIES[source],
            })
          );
        }
      }
    }

    // 加载 ask 规则
    for (const source of RuleManager.ALL_SOURCES) {
      const rules = context.alwaysAskRules[source];
      if (rules) {
        for (const ruleString of rules) {
          const ruleValue = permissionRuleValueFromString(ruleString);
          newRules.push(
            createPermissionRule({
              behavior: PermissionBehavior.ASK,
              toolName: ruleValue.toolName,
              contentPattern: ruleValue.ruleContent,
              source,
              priority: RuleManager.SOURCE_PRIORITIES[source],
            })
          );
        }
      }
    }

    // 合并现有规则和从上下文加载的规则
    this.rules = [...this.rules, ...newRules];
  }

  /**
   * 获取指定行为的规则
   * @param behavior 权限行为
   * @param context 规则上下文（可选）
   * @returns 权限规则数组
   */
  getRulesByBehavior(
    behavior: PermissionBehavior,
    context?: RuleContext
  ): PermissionRule[] {
    let rules = this.getRules(undefined, behavior);

    // 如果提供了上下文，添加从上下文中获取的规则
    if (context) {
      const contextRules: PermissionRule[] = [];
      let contextRulesSource: Partial<Record<PermissionRuleSource, string[]>> =
        {};

      switch (behavior) {
        case PermissionBehavior.ALLOW:
          contextRulesSource = context.alwaysAllowRules;
          break;
        case PermissionBehavior.DENY:
          contextRulesSource = context.alwaysDenyRules;
          break;
        case PermissionBehavior.ASK:
          contextRulesSource = context.alwaysAskRules;
          break;
      }

      for (const source of RuleManager.ALL_SOURCES) {
        const ruleStrings = contextRulesSource[source];
        if (ruleStrings) {
          for (const ruleString of ruleStrings) {
            const ruleValue = permissionRuleValueFromString(ruleString);
            contextRules.push(
              createPermissionRule({
                behavior,
                toolName: ruleValue.toolName,
                contentPattern: ruleValue.ruleContent,
                source,
                priority: RuleManager.SOURCE_PRIORITIES[source],
              })
            );
          }
        }
      }

      rules = [...rules, ...contextRules];
    }

    // R3（2026-11-17）：「暂停全部持久化放行」开启 ⇒ 审批生成规则**不参与判定**。
    // 只在**判定读取口**过滤（`getRules()` 不受影响）⇒ 列表/健康视图仍可见、可逐条撤销。
    // F2：按 `context.pauseScope`（会话 / 工作区根）过滤；缺省 ⇒ 只按**全局**暂停。
    rules = filterPausedApprovalRules(rules, context?.pauseScope);

    // 按优先级排序
    return rules.sort((a, b) => b.priority - a.priority);
  }

  /**
   * 获取 allow 规则
   * @param context 规则上下文（可选）
   * @returns 权限规则数组
   */
  getAllowRules(context?: RuleContext): PermissionRule[] {
    return this.getRulesByBehavior(PermissionBehavior.ALLOW, context);
  }

  /**
   * 获取 deny 规则
   * @param context 规则上下文（可选）
   * @returns 权限规则数组
   */
  getDenyRules(context?: RuleContext): PermissionRule[] {
    return this.getRulesByBehavior(PermissionBehavior.DENY, context);
  }

  /**
   * 获取 ask 规则
   * @param context 规则上下文（可选）
   * @returns 权限规则数组
   */
  getAskRules(context?: RuleContext): PermissionRule[] {
    return this.getRulesByBehavior(PermissionBehavior.ASK, context);
  }

  /**
   * 检查工具是否匹配规则（整体工具匹配）
   * @param toolName 工具名称
   * @param rule 权限规则
   * @returns 是否匹配
   */
  toolMatchesRule(toolName: string, rule: PermissionRule): boolean {
    // 如果规则有内容模式，则不匹配整体工具
    if (rule.contentPattern) {
      return false;
    }
    // LRO-D1（2026-10-26）：指纹规则（PR-2 的"始终允许此命令"）是**单次调用**粒度，
    // 不得参与"整体工具"匹配 —— 否则一条指纹 deny = 整工具封锁、一条指纹 allow = 整工具放行。
    if (rule.inputFingerprint) {
      return false;
    }
    return isToolNameMatch(toolName, rule.toolName);
  }

  /**
   * 检查工具是否总是被允许
   * @param toolName 工具名称
   * @param context 规则上下文（可选）
   * @returns 允许规则或 null
   */
  toolAlwaysAllowedRule(
    toolName: string,
    context?: RuleContext
  ): PermissionRule | null {
    const allowRules = this.getAllowRules(context);
    return (
      allowRules.find((rule) => this.toolMatchesRule(toolName, rule)) || null
    );
  }

  /**
   * 检查工具是否被拒绝
   * @param toolName 工具名称
   * @param context 规则上下文（可选）
   * @returns 拒绝规则或 null
   */
  getDenyRuleForTool(
    toolName: string,
    context?: RuleContext
  ): PermissionRule | null {
    const denyRules = this.getDenyRules(context);
    return (
      denyRules.find((rule) => this.toolMatchesRule(toolName, rule)) || null
    );
  }

  /**
   * 检查工具是否应该询问
   * @param toolName 工具名称
   * @param context 规则上下文（可选）
   * @returns 询问规则或 null
   */
  getAskRuleForTool(
    toolName: string,
    context?: RuleContext
  ): PermissionRule | null {
    const askRules = this.getAskRules(context);
    return (
      askRules.find((rule) => this.toolMatchesRule(toolName, rule)) || null
    );
  }

  /**
   * 检查工具输入是否匹配规则（包含内容模式）
   * @param toolName 工具名称
   * @param input 工具输入
   * @param behavior 权限行为
   * @param context 规则上下文（可选）
   * @returns 匹配的规则或 null
   */
  getMatchingRule(
    toolName: string,
    input: Record<string, unknown>,
    behavior: PermissionBehavior,
    context?: RuleContext,
    /**
     * LRO-D1（2026-10-26）：本次调用的审批指纹摘要。
     *
     * 指纹规则（`inputFingerprint`）已**不再**参与"整体工具"匹配（见 `toolMatchesRule`），
     * 只能在本层按指纹等值命中；调用方不传 ⇒ 指纹规则一律不匹配（fail-closed）。
     */
    options: RuleMatchOptions = {}
  ): PermissionRule | null {
    const rules = this.getRulesByBehavior(behavior, context);
    for (const rule of rules) {
      if (isRuleMatch(rule, toolName, input, options)) {
        return rule;
      }
    }
    return null;
  }

  /**
   * 获取规则内容映射（用于按内容匹配工具）
   * @param toolName 工具名称
   * @param behavior 权限行为
   * @param context 规则上下文（可选）
   * @returns 内容模式到规则的映射
   */
  getRuleByContentsForTool(
    toolName: string,
    behavior: PermissionBehavior,
    context?: RuleContext
  ): Map<string, PermissionRule> {
    const ruleByContents = new Map<string, PermissionRule>();
    const rules = this.getRulesByBehavior(behavior, context);

    for (const rule of rules) {
      if (isToolNameMatch(toolName, rule.toolName) && rule.contentPattern) {
        ruleByContents.set(rule.contentPattern, rule);
      }
    }

    return ruleByContents;
  }
}
