/**
 * ToolLazyWrapper — 工具懒加载包装器
 *
 * 存储工具元信息，工具实例在首次 execute() 时才加载。
 * getInfo() 直接返回元信息，不触发加载。
 */

import { LazyModuleLoader } from '@openliri/kernel';
import type { Tool, ToolInfo, ToolParam, ToolRiskClass } from '../types/Tool';
import type { ToolUseContext } from '../types/ToolUseContext';
import type { ToolResult } from '../types/ToolResult';
import type { PermissionResult } from '../types/PermissionResult';
import type { ValidationResult } from '../types/Tool';
import type { ToolCallProgress } from '../types/Tool';
import { deriveToolRiskClass } from '../toolRiskClass';

export class ToolLazyWrapper implements Tool {
  readonly name: string;
  readonly description: string;
  readonly params: ToolParam[];
  readonly aliases?: string[];
  readonly aliasInputDefaults?: Readonly<
    Record<string, Record<string, unknown>>
  >;
  readonly searchHint?: string;
  readonly searchTips?: string[];
  readonly shouldDefer?: boolean;
  readonly alwaysLoad?: boolean;
  readonly maxResultSizeChars?: number;

  private loader: LazyModuleLoader<Tool>;
  private metadata: ToolInfo;
  private _requiresUserInteraction: boolean;

  constructor(
    metadata: ToolInfo,
    loader: LazyModuleLoader<Tool>,
    requiresUserInteraction?: boolean
  ) {
    this.metadata = metadata;
    this.loader = loader;
    this._requiresUserInteraction = requiresUserInteraction ?? false;

    this.name = metadata.name;
    this.description = metadata.description;
    this.params = metadata.params;
    this.aliases = metadata.aliases;
    // P1（2026-10-30）：旧名入参默认值必须在**未解包**时也可见（执行入口在参数校验前用它）
    this.aliasInputDefaults = metadata.aliasInputDefaults;
    this.searchHint = metadata.searchHint;
    this.searchTips = metadata.searchTips;
    this.shouldDefer = metadata.deferred;
    this.alwaysLoad = metadata.alwaysLoad;
    this.maxResultSizeChars = metadata.maxResultSizeChars;
  }

  /**
   * U-03（2026-10-19）：沙箱级别（**能力位**）。
   *
   * 优先取注册时快照（未解包也能判定执行类）；快照缺失时（2026-10-23 补充：对象字面量工具的
   * `getInfo()` 未必枚举新增能力位）委托真实实例 —— 否则 `file-io` / `execution` 声明
   * 到不了权限层与 `modeHint`，与真实实例的判定不一致。
   */
  get sandboxLevel(): Tool['sandboxLevel'] {
    if (this.metadata.sandboxLevel !== undefined) {
      return this.metadata.sandboxLevel;
    }
    try {
      return this.unwrap()?.sandboxLevel;
    } catch {
      // @ignore-catch — 取不到真身 ⇒ 视为未声明（保守）
      return undefined;
    }
  }

  requiresUserInteraction?(): boolean {
    return this._requiresUserInteraction;
  }

  getInfo(): ToolInfo {
    // T3a（2026-08-30）：已加载工具委托真实实例的 getInfo()（动态最新，如 SkillTool 的
    // 技能清单），未加载仍返回注册时快照（不破坏懒加载语义、不触发加载）。
    // 对齐 validateInput 的 BUG-4 修复模式（isLoaded 时委托真实逻辑）。
    if (this.loader.isLoaded()) {
      try {
        return this.loader.getSync().getInfo();
      } catch {
        // 加载异常回退快照
      }
    }
    return this.metadata;
  }

  isEnabled(): boolean {
    return this.metadata.enabled;
  }

  isReadOnly(input?: Record<string, unknown>): boolean {
    return this.metadata.readOnly;
  }

  /**
   * PR-0 补充（2026-10-23）：**风险声明透传**。
   *
   * 注册表里存的本类实例（`ToolManager.registerBuiltinToolsFromLoaders`）就是权限层拿到的
   * 工具对象 ⇒ 若这里不转发，`resolveRiskClass()` 只看得到包装器自身字段（`riskClass` /
   * `riskClassFor` / `getRiskClass` 均为空）⇒ **所有**写/执行/外部类工具在运行期被判
   * `undeclared`，与 `lint:tool-risk`（对真实实例做 `deriveToolRiskClass`）不一致，
   * 沙箱豁免与会话 `auto-local` 因此永不生效。
   *
   * 语义：委托真实实现（`BaseTool.getRiskClass()` 已实现同一口径）；对象字面量工具没有该方法
   * ⇒ 由本类按**同一唯一口径** `deriveToolRiskClass()` 派生。取不到真身 ⇒ `undeclared`
   * （保守：仍询问，不静默放行）。
   */
  getRiskClass(input: Record<string, unknown> = {}): ToolRiskClass {
    const real = this.unwrap();
    if (!real) return 'undeclared';
    try {
      if (typeof real.getRiskClass === 'function') {
        return real.getRiskClass(input);
      }
      return deriveToolRiskClass(real, input);
    } catch {
      // @ignore-catch — 派生异常 ⇒ 保守按"未声明"处理（CS03：不掩盖，仍询问）
      return 'undeclared';
    }
  }

  /**
   * §12.15 补充（2026-10-23）：**文件落点根透传**（沙箱豁免 S4b 的输入）。
   *
   * 不透传 ⇒ 生产链路永远拿不到 `targetRoot`，S4b（"落点根已挂载"）形同虚设
   * （只有直接传真实工具的测试能看到它）。取不到真身 ⇒ `undefined`（不编造落点根）。
   */
  resolveFileIoRoot(input: Record<string, unknown>): string | undefined {
    try {
      return this.unwrap()?.resolveFileIoRoot?.(input);
    } catch {
      // @ignore-catch — 加载异常 ⇒ 不给落点根（与"未声明"同义）
      return undefined;
    }
  }

  isDestructive(input?: Record<string, unknown>): boolean {
    return this.metadata.destructive;
  }

  isConcurrencySafe(input?: Record<string, unknown>): boolean {
    return this.metadata.concurrencySafe;
  }

  interruptBehavior(): 'cancel' | 'block' {
    return this.metadata.interruptBehavior || 'block';
  }

  async execute(
    input: any,
    context: ToolUseContext,
    onProgress?: ToolCallProgress
  ): Promise<ToolResult<any>> {
    const realTool = await this.loader.get();
    return realTool.execute(input, context, onProgress);
  }

  async call?(
    args: any,
    context: ToolUseContext,
    onProgress?: ToolCallProgress
  ): Promise<ToolResult<any>> {
    const realTool = await this.loader.get();
    if (typeof realTool.call === 'function') {
      return realTool.call(args, context, onProgress);
    }
    return realTool.execute(args, context, onProgress);
  }

  async checkPermissions?(
    input: any,
    context: ToolUseContext
  ): Promise<PermissionResult> {
    const realTool = await this.loader.get();
    if (typeof realTool.checkPermissions === 'function') {
      return realTool.checkPermissions(input, context);
    }
    return { behavior: 'allow' };
  }

  validateInput?(input: any): ValidationResult {
    // BUG 4 修复（2026-08-27）：已加载工具委托真实校验，不再恒放行——
    // 原实现使权限/调度前置拦截层永远拿到"通过"（AgentTool 的必填校验被绕过）。
    // 懒加载未加载时仍由 execute 内部校验兜底（保持懒加载语义）。
    if (this.loader.isLoaded()) {
      try {
        const realTool = this.loader.getSync();
        if (typeof realTool.validateInput === 'function') {
          return realTool.validateInput(input);
        }
      } catch {
        // 忽略：加载异常按放行处理
      }
    }
    return { result: true };
  }

  async validateInputWithContext?(
    input: any,
    context: ToolUseContext
  ): Promise<ValidationResult> {
    const realTool = await this.loader.get();
    if (typeof realTool.validateInputWithContext === 'function') {
      return realTool.validateInputWithContext(input, context);
    }
    return { result: true };
  }

  getPath?(input: Record<string, unknown>): string {
    return '';
  }

  isLoaded(): boolean {
    return this.loader.isLoaded();
  }

  /**
   * U-03（2026-10-19）：出参 schema 透传（`validateToolOutputShape` 的输入）。
   *
   * 未加载 ⇒ `undefined`（**不解包**，保持懒加载语义 ⇒ 按"未声明"跳过校验）；
   * 已加载 ⇒ 委托真实实例（与 `getInfo()` 同一委托策略）。此前包装器无该字段，
   * 延迟加载工具的出参校验被静默跳过。
   */
  get outputSchema(): Tool['outputSchema'] {
    if (!this.loader.isLoaded()) return undefined;
    try {
      return this.loader.getSync().outputSchema;
    } catch {
      // @ignore-catch — 加载异常按"未声明"处理（不阻断执行）
      return undefined;
    }
  }

  /** U-03（2026-10-19）：模型可见出参结构同样转发（未加载 ⇒ 视为未声明） */
  get outputJsonSchema(): Tool['outputJsonSchema'] {
    if (!this.loader.isLoaded()) return undefined;
    try {
      return this.loader.getSync().outputJsonSchema;
    } catch {
      // @ignore-catch — 加载异常按"未声明"处理（不阻断 schema 生成）
      return undefined;
    }
  }

  /**
   * R6（2026-09-22）：**解包为真实工具实例**。
   *
   * 背景：本类是 `implements Tool`（**非 extends**），因此
   * `getToolManager().getTool('agent') instanceof AgentTool` **恒为 false** ⇒
   * 控制面/命令层三处入口全部落空（`GET /v1/agents/control`、
   * `POST /v1/agents/:id/stop|pause` 恒 503），"批次停止"的修复代码一行都不会被执行。
   *
   * 语义：未加载时**同步加载**（工具 creator 是同步工厂，见 `ToolManager#registerBuiltinToolsFromLoaders`）；
   * 加载失败 / factory 异步 / 异步加载进行中 ⇒ 返回 `null`（**明确信号**，不返回 `this` ——
   * 那会让调用方误判"已解包"，正是本次要修的病根）。
   *
   * 注意：`null` 只代表"这一版拿不到真身"，调用方仍应做**能力判定**（鸭子类型）而非继承判定。
   */
  unwrap(): Tool | null {
    try {
      return this.loader.isLoaded()
        ? this.loader.getSync()
        : this.loader.loadSync();
    } catch {
      // @ignore-catch — 拿不到真身是预期分支（未加载/异步工厂/加载异常），由调用方判定
      return null;
    }
  }

  reset(): void {
    this.loader.reset();
  }
}
