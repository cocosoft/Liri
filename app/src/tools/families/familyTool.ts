/**
 * familyTool — 「同资源族」合并工具的通用装配器（P1，2026-10-30）
 *
 * 背景：`dev_docs/20261030/Liri-工具与命令治理方案-20261030.md` §4.1 —— 把同一资源的
 * 不同操作（如 `read_vfs` / `write_vfs` / `list_vfs` / `stat_vfs`）合并为**一个带判别字段
 * 分派**的工具，旧名保留为 **alias**（wire 层继续可解析，模型/旧提示词无感）。
 *
 * 设计约束（刻意保守）：
 * - **不重写实现**：成员仍由原工具类/工厂构造，本层只做 `op` → 成员分派（实现唯一性）。
 * - **成员实例按需缓存**：与注册期"一次构造"等价（`SkillTool` 构造有副作用，不可每次调用新建）。
 * - **判别字段必填**，其余参数一律 `required: false`（各 op 的必填项在 `execute` 前按成员校验）
 *   —— 否则"联合参数表"里任一 op 的必填项会卡死其它 op。
 * - **旧名调用**：由各执行入口的 `applyAliasInputDefaults()` 在参数校验前补
 *   `{[判别字段]: 该旧名对应的 op}`；同时本层再做一次**形态推断**兜底（见 `inferKey`）。
 * - **风险按 op 分档**：`riskClassFor()` / `isReadOnly()` / `isDestructive()` 均读成员声明
 *   （权限与审批面与合并前等价；见 `toolRiskClass.ts`）。
 */

import { BaseTool } from '../BaseTool';
import type {
  Tool,
  ToolParam,
  ToolUseContext,
  ToolResult,
  ToolCallProgress,
  ValidationResult,
} from '../types';
import type { ToolRiskClass } from '../../utils/toolContract/Tool';

/** 判别字段名（目前只有 `op` / `mode` 两种形态，见各族声明） */
export type FamilyDiscriminator = 'op' | 'mode';

/** 一个成员 = 一个旧工具（其名字同时作为 alias） */
export interface FamilyMember {
  /** 判别字段取值（如 `read`） */
  key: string;
  /** 旧工具名（同时作为 alias；旧实现按它构造） */
  legacyName: string;
  /** 额外保留的旧别名（可选） */
  legacyAliases?: readonly string[];
  /** 该 op 的入参必填项（**不含**判别字段；在分派前校验） */
  required?: readonly string[];
  /** 是否只读（决定 riskClass / isReadOnly / 并发安全） */
  readOnly: boolean;
  /** 是否破坏性（不可逆；如 `cron delete` / `worktree exit --remove`） */
  destructive?: boolean;
  /** 构造旧实现（惰性；同族内按 `key` 缓存一次） */
  create: () => Tool;
}

export interface FamilyToolOptions {
  name: string;
  description: string;
  discriminator: FamilyDiscriminator;
  /** 判别字段的可选值（用于参数 schema 与错误提示） */
  members: readonly FamilyMember[];
  /** 联合参数表（判别字段由本层自动补为 required 的第 0 项） */
  params: readonly ToolParam[];
  /** 判别字段本身的描述 */
  discriminatorDescription: string;
  /** 搜索提示（`searchTips`） */
  searchTips?: readonly string[];
  /** 统一延迟加载标记（worktree 族沿用旧行为 `shouldDefer=true`） */
  shouldDefer?: boolean;
  /** 统一启用判定（默认恒启用；worktree 族沿用旧行为 `isInsideGitRepo()`） */
  isEnabled?: () => boolean;
  /**
   * 形态推断兜底：当判别字段缺失时，按旧入参形态猜 op（只做**无歧义**的推断；
   * 有歧义返回 `undefined` ⇒ 由调用方报"缺少判别字段"）。
   */
  inferKey?: (input: Record<string, unknown>) => string | undefined;
  /**
   * 判别字段缺失时的**默认分支**（仅用于"历史上就一直这么调"的入口）：
   * - `skill` ⇒ `run`（旧调用 `skill{name,arguments}` 不带 op）；
   * - `cron` ⇒ `list`（只读，安全兜底）；
   * - `task_list` ⇒ `get`（只读，安全兜底）。
   * ⚠️ 不得把**写**分支设为默认（否则缺参调用会变成意外副作用）。
   */
  defaultKey?: string;
  /** 判别字段是否在 schema 里标记 required（默认 false：允许旧调用省略，由上面两种兜底解析） */
  discriminatorRequired?: boolean;
}

/**
 * 「同资源族」合并工具（`op`/`mode` 分派器）。
 *
 * 不对外导出单例：各族在自身文件里 `new FamilyTool({...})`。
 */
export class FamilyTool extends BaseTool {
  name: string;
  description: string;
  params: ToolParam[];
  override searchHint?: string;
  override shouldDefer: boolean;

  private readonly discriminator: FamilyDiscriminator;
  private readonly members: ReadonlyMap<string, FamilyMember>;
  private readonly inferKey?: (
    input: Record<string, unknown>
  ) => string | undefined;
  private readonly defaultKey?: string;
  private readonly enabledCheck: () => boolean;
  private readonly instances = new Map<string, Tool>();

  constructor(options: FamilyToolOptions) {
    super();
    this.name = options.name;
    this.description = options.description;
    this.discriminator = options.discriminator;
    this.inferKey = options.inferKey;
    this.defaultKey = options.defaultKey;
    this.enabledCheck = options.isEnabled ?? (() => true);
    this.shouldDefer = options.shouldDefer ?? false;
    this.searchHint = options.searchTips?.join(', ');

    const members = new Map<string, FamilyMember>();
    const aliases: string[] = [];
    const aliasInputDefaults: Record<string, Record<string, unknown>> = {};
    for (const member of options.members) {
      members.set(member.key, member);
      // 成员旧名与合并后的真名同名（如 `sleep` 族的 duration 分支）⇒ 不登记为 alias
      //（注册表的别名守卫会以"别名撞真实名"跳过并告警，这里提前排除）
      if (member.legacyName !== options.name) {
        aliasInputDefaults[member.legacyName] = {
          [options.discriminator]: member.key,
        };
        aliases.push(member.legacyName);
      }
      for (const extra of member.legacyAliases ?? []) {
        if (extra === options.name) continue;
        aliases.push(extra);
        aliasInputDefaults[extra] = { [options.discriminator]: member.key };
      }
    }
    this.members = members;
    this.aliases = aliases;
    this.aliasInputDefaults = aliasInputDefaults;

    this.params = [
      {
        name: options.discriminator,
        type: 'string',
        description: options.discriminatorDescription,
        required: options.discriminatorRequired ?? false,
        enum: options.members.map((m) => m.key),
      },
      ...options.params,
    ];
  }

  /** 当前入参对应的成员（判别字段缺失时做形态推断 / 默认分支） */
  private resolveMember(
    input: Record<string, unknown>
  ): FamilyMember | undefined {
    const raw = input[this.discriminator];
    const key =
      typeof raw === 'string' && raw.length > 0
        ? raw
        : (this.inferKey?.(input) ?? this.defaultKey);
    return key === undefined ? undefined : this.members.get(key);
  }

  private memberTool(member: FamilyMember): Tool {
    const cached = this.instances.get(member.key);
    if (cached) return cached;
    const created = member.create();
    // 防御：成员构造出的名字必须与登记的旧名一致（否则 alias 解析与日志会错位）
    if (created.name !== member.legacyName) {
      throw new Error(
        `${this.name}: 成员 ${member.key} 的实现名为 ${created.name}，与登记的旧名 ${member.legacyName} 不一致`
      );
    }
    this.instances.set(member.key, created);
    return created;
  }

  override isEnabled(): boolean {
    return this.enabledCheck();
  }

  override isReadOnly(input?: Record<string, unknown>): boolean {
    return this.resolveMember(input ?? {})?.readOnly ?? false;
  }

  override isDestructive(input?: Record<string, unknown>): boolean {
    return this.resolveMember(input ?? {})?.destructive ?? false;
  }

  override isConcurrencySafe(input?: Record<string, unknown>): boolean {
    // 与旧实现口径一致：只读成员并发安全，写成员按"非并发安全"保守处理
    return this.resolveMember(input ?? {})?.readOnly ?? false;
  }

  override riskClassFor(input: Record<string, unknown>): ToolRiskClass {
    return this.isReadOnly(input) ? 'read' : 'write';
  }

  override validateInput(input: unknown): ValidationResult {
    const raw = (input ?? {}) as Record<string, unknown>;
    const member = this.resolveMember(raw);
    if (!member) {
      return {
        result: false,
        message:
          `缺少或非法的 ${this.discriminator}；可选值：` +
          [...this.members.keys()].join('、'),
      };
    }
    const missing = (member.required ?? []).filter((key) => {
      const value = raw[key];
      return value === undefined || value === null || value === '';
    });
    if (missing.length > 0) {
      return {
        result: false,
        message: `${this.discriminator}=${member.key} 需要参数：${missing.join('、')}`,
      };
    }
    return { result: true };
  }

  override async execute(
    input: unknown,
    context: ToolUseContext,
    onProgress?: ToolCallProgress
  ): Promise<ToolResult> {
    const raw = (input ?? {}) as Record<string, unknown>;
    const member = this.resolveMember(raw);
    if (!member) {
      return {
        success: false,
        error:
          `${this.name} 缺少或非法的 ${this.discriminator}；可选值：` +
          [...this.members.keys()].join('、'),
      };
    }
    const missing = (member.required ?? []).filter((key) => {
      const value = raw[key];
      return value === undefined || value === null || value === '';
    });
    if (missing.length > 0) {
      return {
        success: false,
        error: `${this.discriminator}=${member.key} 需要参数：${missing.join('、')}`,
      };
    }
    // 判别字段对旧实现无意义（旧实现只读自己的参数），原样透传不影响其行为
    return this.memberTool(member).execute(raw, context, onProgress);
  }
}
