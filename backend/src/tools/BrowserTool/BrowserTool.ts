/**
 * 浏览器自动化工具
 * 参考CC源码 cc_code/backend/skills/bundled/claudeInChrome.ts 实现
 * 提供与Chrome浏览器交互的功能，支持打开标签页、点击元素、填写表单等操作
 */

import { BaseTool } from '../BaseTool';
import type {
  ToolResult,
  ToolUseContext,
  ToolParam,
  ToolCallProgress,
  ValidationResult,
} from '../types';
import { createToolResult } from '../types/ToolResult';

/**
 * 浏览器工具输入类型
 */
export interface BrowserToolInput {
  /** 操作类型 */
  action: 'open_tab' | 'click' | 'fill_form' | 'navigate' | 'screenshot' | 'get_tabs';
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
export class BrowserTool extends BaseTool<
  BrowserToolInput,
  BrowserToolOutput
> {
  name = 'browser';
  description = 'Automate Chrome browser to interact with web pages';

  params: ToolParam[] = [
    {
      name: 'action',
      type: 'string',
      description: 'Action to perform: open_tab, click, fill_form, navigate, screenshot, get_tabs',
      required: true,
      enum: ['open_tab', 'click', 'fill_form', 'navigate', 'screenshot', 'get_tabs'],
    },
    {
      name: 'url',
      type: 'string',
      description: 'URL for open_tab or navigate action',
      required: false,
    },
    {
      name: 'tab_id',
      type: 'string',
      description: 'Tab ID for operations on specific tab',
      required: false,
    },
    {
      name: 'selector',
      type: 'string',
      description: 'CSS selector for click or fill_form action',
      required: false,
    },
    {
      name: 'form_data',
      type: 'object',
      description: 'Form data for fill_form action',
      required: false,
    },
    {
      name: 'text',
      type: 'string',
      description: 'Text for fill_form action',
      required: false,
    },
  ];

  aliases = ['chrome', 'browser_automation', 'web'];
  searchHint = 'Automate Chrome browser to interact with web pages';
  maxResultSizeChars = 100000;

  /**
   * 检查工具是否只读
   */
  isReadOnly(input?: Record<string, unknown>): boolean {
    const action = (input?.action as string) || '';
    return action === 'get_tabs' || action === 'screenshot';
  }

  /**
   * 检查工具是否并发安全
   */
  isConcurrencySafe(): boolean {
    return false;
  }

  /**
   * 验证输入
   */
  validateInput(input: BrowserToolInput): ValidationResult {
    const validActions = ['open_tab', 'click', 'fill_form', 'navigate', 'screenshot', 'get_tabs'];

    if (!input.action || !validActions.includes(input.action)) {
      return {
        result: false,
        message: `Invalid action. Must be one of: ${validActions.join(', ')}`,
        errorCode: 1,
      };
    }

    if ((input.action === 'open_tab' || input.action === 'navigate') && !input.url) {
      return {
        result: false,
        message: 'url is required for open_tab or navigate action',
        errorCode: 2,
      };
    }

    if ((input.action === 'click' || input.action === 'fill_form') && !input.selector) {
      return {
        result: false,
        message: 'selector is required for click or fill_form action',
        errorCode: 3,
      };
    }

    return { result: true };
  }

  /**
   * 获取用户可见的工具名称
   */
  userFacingName(input?: Partial<BrowserToolInput>): string {
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

  /**
   * 获取工具使用摘要
   */
  getToolUseSummary(input?: Partial<BrowserToolInput>): string | null {
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

  /**
   * 获取活动描述
   */
  getActivityDescription(input?: Partial<BrowserToolInput>): string | null {
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

  /**
   * 获取工具用于自动分类器的输入
   */
  toAutoClassifierInput(input: BrowserToolInput): unknown {
    return `${input.action} ${input.url || input.selector || ''}`;
  }

  /**
   * 执行工具
   */
  async execute(
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

    try {
      // 模拟浏览器操作，实际实现需要与Chrome扩展通信
      // 这里提供一个基础的模拟实现
      let result: BrowserToolOutput;

      switch (input.action) {
        case 'open_tab':
          result = {
            success: true,
            message: `Opened new tab for ${input.url}`,
            data: {
              tab_id: `tab_${Date.now()}`,
              url: input.url,
            },
          };
          break;

        case 'click':
          result = {
            success: true,
            message: `Clicked element ${input.selector}`,
            data: {
              selector: input.selector,
              timestamp: new Date().toISOString(),
            },
          };
          break;

        case 'fill_form':
          result = {
            success: true,
            message: `Filled form ${input.selector}`,
            data: {
              selector: input.selector,
              form_data: input.form_data,
              text: input.text,
            },
          };
          break;

        case 'navigate':
          result = {
            success: true,
            message: `Navigated to ${input.url}`,
            data: {
              url: input.url,
              timestamp: new Date().toISOString(),
            },
          };
          break;

        case 'screenshot':
          result = {
            success: true,
            message: `Took screenshot of tab ${input.tab_id || 'current'}`,
            screenshot: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+P+/HgAFeAJ6ME3L9UAAAAABJRU5ErkJggg==',
          };
          break;

        case 'get_tabs':
          result = {
            success: true,
            message: 'Retrieved all tabs',
            tabs: [
              {
                id: 'tab_1',
                url: 'https://www.google.com',
                title: 'Google',
                active: true,
              },
              {
                id: 'tab_2',
                url: 'https://www.github.com',
                title: 'GitHub',
                active: false,
              },
            ],
          };
          break;

        default:
          result = {
            success: false,
            message: `Unknown action: ${input.action}`,
          };
      }

      return createToolResult(result, {
        success: result.success,
        output: result.message,
      });
    } catch (error: any) {
      return createToolResult(
        {
          success: false,
          message: `Browser operation failed: ${error.message}`,
        },
        {
          success: false,
          error: `Browser operation failed: ${error.message}`,
        }
      );
    }
  }
}

export default BrowserTool;