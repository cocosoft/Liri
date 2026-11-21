import { TOOL_NAME_CONSTANTS } from '@openliri/infra/constants';
/**
 * 浏览器自动化工具
 * 提供与Chrome浏览器交互的功能，支持打开标签页、点击元素、填写表单等操作
 */

import { BaseTool } from '@openliri/tool-base';
import { ToolTag } from '@openliri/infra/utils/toolContract/Tool';
import type {
  ToolResult,
  ToolUseContext,
  ToolParam,
  ToolCallProgress,
  ToolValidationResult,
} from '@openliri/infra/utils/toolContract/Tool';
import { createToolResult } from '@openliri/infra/utils/toolContract/ToolResult';

import { getLogger } from '@openliri/infra/monitoring';
// P4（2026-11-21）：驱动与 schema 同包；工具类本轮迁入，经相对路径引用
// P2（2026-11-21）：接真实现（Playwright + 系统 Chrome/Edge）；截图只回文件路径
import {
  BrowserToolOutputSchema,
  BrowserToolOutputJsonSchema,
} from './schemas';
import {
  getBrowserSessionDriver,
  type BrowserDriverResult,
  type BrowserSessionDriver,
} from './PlaywrightDriver';
import { saveScreenshotFile } from '@openliri/infra/utils/computerUse/screenshotStore';
import {
  describeToolGateDisabled,
  isToolEnabledByGate,
  analyzeImageBuffer,
} from '@openliri/tool-runtime';
const logger = getLogger('tools:BrowserTool:BrowserTool');

/**
 * 浏览器工具输入类型
 */
export interface BrowserToolInput {
  /** 操作类型 */
  action:
    | 'open_tab'
    | 'click'
    | 'fill_form'
    | 'navigate'
    | 'screenshot'
    | 'get_tabs'
    | 'get_content'
    | 'back'
    | 'reload'
    | 'close';
  /** URL地址 */
  url?: string;
  /** 标签页ID */
  tab_id?: string;
  /** 选择器 */
  selector?: string;
  /** 表单数据 */
  form_data?: Record<string, string>;
  /** 操作文本 */
  text?: string;
  /** screenshot 是否整页 */
  full_page?: boolean;
  /** get_content 截断上限 */
  max_chars?: number;
  /** screenshot 是否顺带视觉分析 */
  analyze?: boolean;
}

/**
 * 浏览器工具输出类型
 */
export interface BrowserToolOutput {
  /** 操作结果 */
  success: boolean;
  /** 消息 */
  message: string;
  /** 数据 */
  data?: any;
  /** 标签页信息 */
  tabs?: any[];
  /** 截图数据 */
  screenshot?: string;
}

/**
 * 浏览器自动化工具
 */
export class BrowserTool extends BaseTool<BrowserToolInput, BrowserToolOutput> {
  name = TOOL_NAME_CONSTANTS.browser;

  /**
   * 出参契约（P1-3 A 档；2026-09-29 **T6 批次 4b 接线**）。
   *
   * 该 schema **早已存在却零消费者**。实测成功出口 `data = result`（`BrowserToolOutput`，字段
   * `{success, message, data?, tabs?, screenshot?}`）⇒ 与 schema **逐字段相符**；
   * 2 个失败分支在 **ToolResult 层自带 `success: false`** ⇒ 命中豁免、不参与校验。
   */
  outputSchema = BrowserToolOutputSchema;
  /** U-03（2026-10-19）：模型可见出参结构 */
  override outputJsonSchema = BrowserToolOutputJsonSchema;
  description = '自动化 Chrome 浏览器与网页交互';

  override tags = [ToolTag.NETWORK];

  params: ToolParam[] = [
    {
      name: 'action',
      type: 'string',
      description:
        '要执行的操作：open_tab、click、fill_form、navigate、screenshot、get_tabs、get_content、back、reload、close',
      required: true,
      enum: [
        'open_tab',
        'click',
        'fill_form',
        'navigate',
        'screenshot',
        'get_tabs',
        'get_content',
        'back',
        'reload',
        'close',
      ],
    },
    {
      name: 'url',
      type: 'string',
      description: 'open_tab 或 navigate 操作的 URL',
      required: false,
    },
    {
      name: 'tab_id',
      type: 'string',
      description: '针对特定标签页操作的标签页 ID',
      required: false,
    },
    {
      name: 'selector',
      type: 'string',
      description: 'click 或 fill_form 操作的 CSS 选择器',
      required: false,
    },
    {
      name: 'form_data',
      type: 'object',
      description: 'fill_form 操作的表单数据',
      required: false,
    },
    {
      name: 'text',
      type: 'string',
      description: 'fill_form 操作的文本',
      required: false,
    },
    {
      name: 'full_page',
      type: 'boolean',
      description: 'screenshot 是否整页（默认 false）',
      required: false,
    },
    {
      name: 'max_chars',
      type: 'number',
      description: 'get_content 的正文截断上限（字符，默认 8000）',
      required: false,
    },
    {
      name: 'analyze',
      type: 'boolean',
      description:
        'screenshot 是否顺带做视觉分析（默认 false ⇒ 只返回截图文件路径，不返回 base64）',
      required: false,
    },
  ];

  /**
   * 会话级驱动提供者（默认按 sessionId 复用进程内浏览器上下文）。
   * 可注入是为了单测：无需真实浏览器即可覆盖动作映射 / 校验 / 错误分支。
   */
  constructor(
    private readonly driverProvider: (
      sessionId: string
    ) => Pick<BrowserSessionDriver, 'execute'> = getBrowserSessionDriver
  ) {
    super();
  }

  private getDriver(sessionId: string): Pick<BrowserSessionDriver, 'execute'> {
    return this.driverProvider(sessionId);
  }

  override aliases = ['chrome', 'browser_automation', 'web'];
  override searchHint = 'Automate Chrome browser to interact with web pages';
  override maxResultSizeChars = 100000;

  override isReadOnly(input?: Record<string, unknown>): boolean {
    const action = (input?.action as string) || '';
    return (
      action === 'get_tabs' ||
      action === 'screenshot' ||
      action === 'get_content'
    );
  }

  override isConcurrencySafe(): boolean {
    return false;
  }

  override validateInput(input: BrowserToolInput): ToolValidationResult {
    const validActions = [
      'open_tab',
      'click',
      'fill_form',
      'navigate',
      'screenshot',
      'get_tabs',
      'get_content',
      'back',
      'reload',
      'close',
    ];

    if (!input.action || !validActions.includes(input.action)) {
      return {
        result: false,
        message: `Invalid action. Must be one of: ${validActions.join(', ')}`,
        errorCode: 1,
      };
    }

    if (
      (input.action === 'open_tab' || input.action === 'navigate') &&
      !input.url
    ) {
      return {
        result: false,
        message: 'url is required for open_tab or navigate action',
        errorCode: 2,
      };
    }

    if (input.action === 'click' && !input.selector) {
      return {
        result: false,
        message: 'selector is required for click action',
        errorCode: 3,
      };
    }

    // 2026-11-21：fill_form 支持两种形态 —— 单个 selector + text，或 form_data 映射
    if (
      input.action === 'fill_form' &&
      !input.selector &&
      !(input.form_data && Object.keys(input.form_data).length > 0)
    ) {
      return {
        result: false,
        message: 'fill_form 需要 selector+text，或 form_data（{选择器: 值}）',
        errorCode: 3,
      };
    }

    return { result: true };
  }

  override userFacingName(input?: Partial<BrowserToolInput>): string {
    const action = input?.action || '';
    switch (action) {
      case 'open_tab':
        return 'Browser: Open Tab';
      case 'click':
        return 'Browser: Click Element';
      case 'fill_form':
        return 'Browser: Fill Form';
      case 'navigate':
        return 'Browser: Navigate';
      case 'screenshot':
        return 'Browser: Take Screenshot';
      case 'get_tabs':
        return 'Browser: Get Tabs';
      default:
        return this.name;
    }
  }

  override getToolUseSummary(input?: Partial<BrowserToolInput>): string | null {
    const action = input?.action || '';
    switch (action) {
      case 'open_tab':
        return `Open tab: ${input?.url || ''}`;
      case 'click':
        return `Click element: ${input?.selector || ''}`;
      case 'fill_form':
        return `Fill form: ${input?.selector || ''}`;
      case 'navigate':
        return `Navigate to: ${input?.url || ''}`;
      case 'screenshot':
        return `Take screenshot of tab: ${input?.tab_id || 'current'}`;
      case 'get_tabs':
        return 'Get all tabs';
      default:
        return null;
    }
  }

  override getActivityDescription(
    input?: Partial<BrowserToolInput>
  ): string | null {
    const action = input?.action || '';
    switch (action) {
      case 'open_tab':
        return `Opening tab for ${input?.url || ''}`;
      case 'click':
        return `Clicking element ${input?.selector || ''}`;
      case 'fill_form':
        return `Filling form ${input?.selector || ''}`;
      case 'navigate':
        return `Navigating to ${input?.url || ''}`;
      case 'screenshot':
        return `Taking screenshot of tab ${input?.tab_id || 'current'}`;
      case 'get_tabs':
        return 'Getting all tabs';
      default:
        return null;
    }
  }

  override toAutoClassifierInput(input: BrowserToolInput): unknown {
    return `${input.action} ${input.url || input.selector || ''}`;
  }

  /**
   * 执行工具
   */
  override async execute(
    input: BrowserToolInput,
    context: ToolUseContext,
    onProgress?: ToolCallProgress<any>
  ): Promise<ToolResult<BrowserToolOutput>> {
    const validation = this.validateInput(input);
    if (!validation.result) {
      return createToolResult(
        {
          success: false,
          message: validation.message || 'Validation failed',
        },
        {
          success: false,
          error: validation.message,
        }
      );
    }

    // P2（2026-11-21）：功能开关关闭 ⇒ 明确拒绝（可见性已在出站定义处裁剪，这里兜底）
    if (!isToolEnabledByGate(this.name)) {
      const reason = describeToolGateDisabled(this.name);
      return createToolResult(
        { success: false, message: reason },
        { success: false, error: reason }
      );
    }

    const sessionId = context.sessionId ?? 'default';
    try {
      const driver = this.getDriver(sessionId);
      const result =
        input.action === 'fill_form' && input.form_data
          ? await this.fillForm(driver, input)
          : await driver.execute(this.toDriverAction(input));

      if (!result.success) {
        const message = result.error ?? `浏览器操作失败：${input.action}`;
        logger.warn('BrowserTool 操作失败', {
          action: input.action,
          error: message,
        });
        return createToolResult(
          { success: false, message },
          { success: false, error: message }
        );
      }
      return await this.buildResult(input, result, sessionId);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return createToolResult(
        {
          success: false,
          message: `Browser operation failed: ${msg}`,
        },
        {
          success: false,
          error: `Browser operation failed: ${msg}`,
        }
      );
    }
  }

  /** 对外动作 → 驱动动作（`fill_form` 由 {@link fillForm} 拆分） */
  private toDriverAction(input: BrowserToolInput) {
    return {
      action:
        input.action === 'fill_form'
          ? ('fill' as const)
          : (input.action as Exclude<BrowserToolInput['action'], 'fill_form'>),
      url: input.url,
      selector: input.selector,
      value: input.text,
      fullPage: input.full_page === true,
      maxChars: input.max_chars,
    };
  }

  /** `fill_form`：按 `form_data` 逐选择器填充；失败即返回首个失败原因 */
  private async fillForm(
    driver: Pick<BrowserSessionDriver, 'execute'>,
    input: BrowserToolInput
  ): Promise<BrowserDriverResult> {
    const entries = Object.entries(input.form_data ?? {});
    if (entries.length === 0) {
      return {
        success: false,
        action: 'fill_form',
        error: 'fill_form 需要 form_data（{选择器: 值}）或改用 click',
        durationMs: 0,
      };
    }
    let last: BrowserDriverResult = {
      success: true,
      action: 'fill_form',
      durationMs: 0,
    };
    for (const [selector, value] of entries) {
      const res = await driver.execute({ action: 'fill', selector, value });
      if (!res.success) return res;
      last = res;
    }
    return { ...last, action: 'fill_form' };
  }

  /** 统一出口：截图落盘（不返回 base64）、正文截断、标签页列表 */
  private async buildResult(
    input: BrowserToolInput,
    result: BrowserDriverResult,
    sessionId: string
  ): Promise<ToolResult<BrowserToolOutput>> {
    if (input.action === 'screenshot' && result.screenshot) {
      const path = saveScreenshotFile(sessionId, result.screenshot, 'png');
      const size = result.screenshot.length;
      let message = `Screenshot saved: ${path} (${(size / 1024).toFixed(1)}KB)`;
      const data: Record<string, unknown> = {
        path,
        size,
        url: result.url,
        title: result.title,
      };
      if (input.analyze === true) {
        const analysis = await analyzeImageBuffer({
          imageBuffer: result.screenshot,
          prompt:
            '这是一张网页截图。请用中文简洁说明页面主体内容与当前状态（含关键文字/按钮/报错）。',
          mimeType: 'image/png',
        });
        data.analysis = analysis.text;
        data.analyzed = analysis.ok;
        message += `\n视觉分析${analysis.ok ? '' : '（失败）'}：${analysis.text}`;
      }
      return createToolResult(
        { success: true, message, data, screenshot: path },
        { success: true, output: message }
      );
    }

    if (input.action === 'get_content') {
      const content = result.content ?? '';
      const message = `Page content (${content.length} chars, ${result.url ?? ''})\n${content}`;
      return createToolResult(
        {
          success: true,
          message,
          data: { url: result.url, title: result.title, content },
        },
        { success: true, output: message }
      );
    }

    if (input.action === 'get_tabs') {
      const tabs = result.tabs ?? [];
      const message = `Tabs (${tabs.length}):\n${tabs
        .map(
          (t) => `  - [${t.index}]${t.active ? '*' : ' '} ${t.title} — ${t.url}`
        )
        .join('\n')}`;
      return createToolResult(
        { success: true, message, tabs },
        { success: true, output: message }
      );
    }

    const message =
      result.action === 'close'
        ? 'Browser session closed'
        : `${result.action} ok${result.title ? ` — ${result.title}` : ''}${
            result.url ? ` (${result.url})` : ''
          }`;
    return createToolResult(
      {
        success: true,
        message,
        data: { url: result.url, title: result.title },
      },
      { success: true, output: message }
    );
  }
}

export default BrowserTool;
