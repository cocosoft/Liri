/**
 * Playwright 浏览器驱动
 * 为 BrowserTool 提供浏览器自动化能力
 * 对齐 OpenClaw browser tools
 *
 * 注意: playwright 是可选依赖，仅在运行时动态加载。
 * 使用 unknown 类型避免编译时对 playwright 包的依赖。
 */

import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

export interface BrowserAction {
  action:
    | 'navigate'
    | 'click'
    | 'type'
    | 'fill'
    | 'screenshot'
    | 'pdf'
    | 'get_content'
    | 'evaluate'
    | 'back'
    | 'reload'
    | 'close';
  url?: string;
  selector?: string;
  value?: string;
  script?: string;
  options?: Record<string, unknown>;
}

export interface BrowserResult {
  success: boolean;
  action: string;
  content?: string;
  screenshot?: Buffer;
  pdf?: Buffer;
  url?: string;
  title?: string;
  error?: string;
  durationMs: number;
}

export interface PlaywrightDriverConfig {
  headless: boolean;
  timeoutMs: number;
  viewport: { width: number; height: number };
  userAgent?: string;
  sandboxMode: 'host' | 'docker';
  allowedDomains: string[];
}

const DEFAULT_PW_CONFIG: PlaywrightDriverConfig = {
  headless: true,
  timeoutMs: 30000,
  viewport: { width: 1280, height: 800 },
  sandboxMode: 'docker',
  allowedDomains: [],
};

export class PlaywrightBrowserDriver {
  private config: PlaywrightDriverConfig;
  private browser: Record<string, unknown> | null = null;
  private initialized = false;

  constructor(config: Partial<PlaywrightDriverConfig> = {}) {
    this.config = { ...DEFAULT_PW_CONFIG, ...config };
  }

  async execute(action: BrowserAction): Promise<BrowserResult> {
    const startTime = Date.now();

    try {
      const page = await this.ensurePage();
      this.validateAction(action);
      const result = await this.doExecute(page, action);
      result.durationMs = Date.now() - startTime;
      return result;
    } catch (error) {
      return {
        success: false,
        action: action.action,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startTime,
      };
    }
  }

  private async ensurePage(): Promise<Record<string, unknown>> {
    if (this.initialized && this.browser) {
      const ctxObj = this.browser['_context'] as
        | Record<string, unknown>
        | undefined;
      const pageObj = this.browser['_page'] as
        | Record<string, unknown>
        | undefined;
      if (pageObj) return pageObj;
      if (ctxObj) {
        const newPage = ctxObj['newPage'] as () => Promise<unknown>;
        const p = await newPage();
        this.browser!['_page'] = p;
        return p as Record<string, unknown>;
      }
    }

    try {
      const pw = await this.loadPlaywright();
      const browserObj = await this.launchBrowser(pw);
      const ctxResult = await (
        browserObj['newContext'] as (
          opts: Record<string, unknown>
        ) => Promise<unknown>
      )({
        viewport: this.config.viewport,
        userAgent: this.config.userAgent,
      });
      const ctxObj = ctxResult as Record<string, unknown>;
      const p = await (ctxObj['newPage'] as () => Promise<unknown>)();
      (p as Record<string, unknown>)['setDefaultTimeout'] = (
        t: number
      ): void => {
        this.config.timeoutMs = t;
      };

      (
        (p as Record<string, unknown>)['setDefaultTimeout'] as
          | ((n: number) => void)
          | undefined
      )?.(this.config.timeoutMs);

      this.browser = { _browser: browserObj, _context: ctxObj, _page: p };
      this.initialized = true;
      logger.info('Playwright 浏览器已启动');
      return p as Record<string, unknown>;
    } catch (error) {
      throw new Error(
        `Playwright 启动失败: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async loadPlaywright(): Promise<Record<string, unknown>> {
    try {
      const importFn = new Function(
        'specifier',
        'return import(specifier)'
      ) as (s: string) => Promise<Record<string, unknown>>;
      return await importFn('playwright');
    } catch {
      throw new Error(
        'playwright 未安装。运行: bun add playwright && npx playwright install chromium'
      );
    }
  }

  private async launchBrowser(
    pw: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const chromium = pw['chromium'] as Record<string, unknown>;
    const launch = chromium['launch'] as (
      opts: Record<string, unknown>
    ) => Promise<unknown>;
    return (await launch({
      headless: this.config.headless,
      timeout: this.config.timeoutMs,
    })) as Record<string, unknown>;
  }

  private validateAction(action: BrowserAction): void {
    if (action.url && this.config.allowedDomains.length > 0) {
      try {
        const hostname = new URL(action.url).hostname;
        const ok = this.config.allowedDomains.some(
          (d) => hostname === d || hostname.endsWith('.' + d)
        );
        if (!ok) throw new Error(`域名 ${hostname} 不在白名单中`);
      } catch {
        // 相对路径，忽略
      }
    }
  }

  private async doExecute(
    page: Record<string, unknown>,
    action: BrowserAction
  ): Promise<BrowserResult> {
    switch (action.action) {
      case 'navigate': {
        if (!action.url) throw new Error('navigate 需要 url 参数');
        const goto = page['goto'] as (
          u: string,
          o: Record<string, unknown>
        ) => Promise<unknown>;
        await goto(action.url, {
          waitUntil: 'domcontentloaded',
          timeout: this.config.timeoutMs,
        });
        const title = await (page['title'] as () => Promise<string>)();
        return {
          success: true,
          action: 'navigate',
          url: action.url,
          title,
          durationMs: 0,
        };
      }
      case 'click': {
        if (!action.selector) throw new Error('click 需要 selector 参数');
        const click = page['click'] as (s: string) => Promise<void>;
        await click(action.selector);
        return {
          success: true,
          action: 'click',
          url: (page['url'] as () => string)(),
          durationMs: 0,
        };
      }
      case 'type': {
        if (!action.selector || !action.value)
          throw new Error('type 需要 selector 和 value');
        const type = page['type'] as (s: string, v: string) => Promise<void>;
        await type(action.selector, action.value);
        return { success: true, action: 'type', durationMs: 0 };
      }
      case 'fill': {
        if (!action.selector || !action.value)
          throw new Error('fill 需要 selector 和 value');
        const fill = page['fill'] as (s: string, v: string) => Promise<void>;
        await fill(action.selector, action.value);
        return { success: true, action: 'fill', durationMs: 0 };
      }
      case 'screenshot': {
        const shot = page['screenshot'] as (
          o: Record<string, unknown>
        ) => Promise<Buffer>;
        const data = await shot({
          fullPage: action.options?.['fullPage'] || false,
          type: action.options?.['type'] || 'png',
        });
        return {
          success: true,
          action: 'screenshot',
          screenshot: data,
          url: (page['url'] as () => string)(),
          durationMs: 0,
        };
      }
      case 'pdf': {
        const gen = page['pdf'] as (
          o: Record<string, unknown>
        ) => Promise<Buffer>;
        const data = await gen({ format: action.options?.['format'] || 'A4' });
        return {
          success: true,
          action: 'pdf',
          pdf: data,
          url: (page['url'] as () => string)(),
          durationMs: 0,
        };
      }
      case 'get_content': {
        const content = await (page['content'] as () => Promise<string>)();
        const title = await (page['title'] as () => Promise<string>)();
        return {
          success: true,
          action: 'get_content',
          content,
          title,
          url: (page['url'] as () => string)(),
          durationMs: 0,
        };
      }
      case 'evaluate': {
        if (!action.script) throw new Error('evaluate 需要 script 参数');
        const evalFn = page['evaluate'] as (s: string) => Promise<unknown>;
        const val = await evalFn(action.script);
        return {
          success: true,
          action: 'evaluate',
          content: typeof val === 'string' ? val : JSON.stringify(val),
          durationMs: 0,
        };
      }
      case 'back': {
        const back = page['goBack'] as (
          o: Record<string, unknown>
        ) => Promise<void>;
        await back({ waitUntil: 'domcontentloaded' });
        return {
          success: true,
          action: 'back',
          url: (page['url'] as () => string)(),
          durationMs: 0,
        };
      }
      case 'reload': {
        const reload = page['reload'] as (
          o: Record<string, unknown>
        ) => Promise<void>;
        await reload({ waitUntil: 'domcontentloaded' });
        return {
          success: true,
          action: 'reload',
          url: (page['url'] as () => string)(),
          durationMs: 0,
        };
      }
      case 'close': {
        await this.dispose();
        return { success: true, action: 'close', durationMs: 0 };
      }
      default:
        throw new Error(`未知浏览器动作: ${action.action}`);
    }
  }

  async dispose(): Promise<void> {
    if (this.browser) {
      try {
        const p = this.browser['_page'] as Record<string, unknown> | undefined;
        if (p && typeof p['close'] === 'function') {
          await (p['close'] as () => Promise<void>)();
        }
        const ctx = this.browser['_context'] as
          | Record<string, unknown>
          | undefined;
        if (ctx && typeof ctx['close'] === 'function') {
          await (ctx['close'] as () => Promise<void>)();
        }
        const b = this.browser['_browser'] as
          | Record<string, unknown>
          | undefined;
        if (b && typeof b['close'] === 'function') {
          await (b['close'] as () => Promise<void>)();
        }
      } catch {
        /* ignore */
      }
      this.browser = null;
      this.initialized = false;
      logger.info('Playwright 浏览器已关闭');
    }
  }
}
