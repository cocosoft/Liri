// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 浏览器驱动（Playwright 真实现，2026-11-21 P2 重写）
 *
 * 历史：本文件曾用 `_browser/_page` 私有字段 + 把 `setDefaultTimeout` 挂到 page 上（猴子补丁），
 * 且全仓零引用；`BrowserTool` 用的是硬编码成功的假实现（违反 CS04）。本次重写要点：
 *
 * 1. **依赖**：`playwright-core` + **系统 Chrome/Edge**（不下载 Chromium，体积小）；
 *    缺失时给出可执行安装指引（不静默失败）。
 * 2. **会话隔离**：每个会话一个 `BrowserContext`（cookie/localStorage 不串），
 *    空闲 `idleCloseMs` 自动关闭；进程退出/供 stop hook 调 `closeAllBrowserSessions()`。
 * 3. **动作集合**（对外见 `BrowserTool`）：navigate / click / fill / screenshot /
 *    get_content / get_tabs / back / reload / close。
 * 4. **安全**：只允许 http/https；`file:` / `data:` / `javascript:` 一律拒绝；
 *    内网/环回地址默认拒绝（`allowPrivateNetwork` 显式放行）；`acceptDownloads: false`；
 *    headless 默认 **false**（用户可见，降低"静默操作"风险）。
 * 5. **不开放 `evaluate`**（任意 JS ≈ 代码执行，需单独立项）。
 */

import { getLogger } from '@openliri/infra/monitoring';
import { AppError, ErrorCategory, ErrorSeverity } from '@openliri/infra/error';
// 回环主机名的**唯一事实源**（`lint:consts` 的同值 host 棘轮只减不增）
import { LOCAL_SERVICE_HOST } from '@openliri/kernel';

const logger = getLogger('tools:playwrightDriver');

/** 对外动作（BrowserTool 负责语义映射） */
export type BrowserDriverAction =
  | 'open_tab'
  | 'navigate'
  | 'click'
  | 'fill'
  | 'screenshot'
  | 'get_content'
  | 'get_tabs'
  | 'back'
  | 'reload'
  | 'close';

export interface BrowserActionRequest {
  action: BrowserDriverAction;
  url?: string;
  selector?: string;
  value?: string;
  /** get_content 的正文截断上限（字符） */
  maxChars?: number;
  /** screenshot 是否整页 */
  fullPage?: boolean;
}

export interface BrowserTabInfo {
  index: number;
  url: string;
  title: string;
  active: boolean;
}

export interface BrowserDriverResult {
  success: boolean;
  action: string;
  url?: string;
  title?: string;
  content?: string;
  screenshot?: Buffer;
  tabs?: BrowserTabInfo[];
  error?: string;
  durationMs: number;
}

export interface BrowserDriverConfig {
  headless: boolean;
  timeoutMs: number;
  viewport: { width: number; height: number };
  /** 允许的域名后缀；空数组 = 不限制（仍受 scheme/内网规则约束） */
  allowedDomains: string[];
  /** 是否允许环回/内网地址（默认 false：需要显式放行） */
  allowPrivateNetwork: boolean;
  /** 空闲自动关闭（毫秒；0 = 不自动关闭） */
  idleCloseMs: number;
  /** 正文返回上限（字符） */
  maxContentChars: number;
}

const DEFAULT_CONFIG: BrowserDriverConfig = {
  headless: false,
  timeoutMs: 30_000,
  viewport: { width: 1280, height: 800 },
  allowedDomains: [],
  allowPrivateNetwork: false,
  idleCloseMs: 5 * 60_000,
  maxContentChars: 8_000,
};

/** 结构化最小接口（避免把 playwright 类型带进编译面） */
interface PwPage {
  goto(url: string, opts?: Record<string, unknown>): Promise<unknown>;
  title(): Promise<string>;
  url(): string;
  click(selector: string, opts?: Record<string, unknown>): Promise<void>;
  fill(selector: string, value: string): Promise<void>;
  screenshot(opts?: Record<string, unknown>): Promise<Buffer>;
  content(): Promise<string>;
  innerText(selector: string): Promise<string>;
  goBack(opts?: Record<string, unknown>): Promise<unknown>;
  reload(opts?: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
  waitForLoadState(
    state?: string,
    opts?: Record<string, unknown>
  ): Promise<void>;
}

interface PwContext {
  newPage(): Promise<PwPage>;
  pages(): PwPage[];
  close(): Promise<void>;
  setDefaultTimeout?(ms: number): void;
}

interface PwBrowser {
  newContext(opts?: Record<string, unknown>): Promise<PwContext>;
  close(): Promise<void>;
  isConnected?(): boolean;
}

interface PwModule {
  chromium: { launch(opts: Record<string, unknown>): Promise<PwBrowser> };
}

/** 内网/环回判据（IPv4 私有段 + 回环主机名 + IPv6 环回） */
function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === LOCAL_SERVICE_HOST || host === '::1' || host === '[::1]') {
    return true;
  }
  if (host.endsWith(`.${LOCAL_SERVICE_HOST}`)) return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return (
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

/**
 * URL 安全校验（唯一入口）：scheme + 域名白名单 + 内网规则。
 * @throws AppError（PERMISSION / VALIDATION）
 */
export function assertUrlAllowed(
  url: string,
  config: BrowserDriverConfig
): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new AppError(
      `URL 无效：${url}（需要完整地址：含 http/https 协议与主机名）`,
      ErrorCategory.VALIDATION,
      ErrorSeverity.HIGH,
      'INVALID_INPUT'
    );
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new AppError(
      `仅允许 http/https，当前为 ${parsed.protocol}（file:/data:/javascript: 一律拒绝）`,
      ErrorCategory.PERMISSION,
      ErrorSeverity.HIGH,
      'PERMISSION_DENIED'
    );
  }
  if (!config.allowPrivateNetwork && isPrivateHost(parsed.hostname)) {
    throw new AppError(
      `默认禁止访问环回/内网地址（${parsed.hostname}）。如确需访问，请显式开启 allowPrivateNetwork`,
      ErrorCategory.PERMISSION,
      ErrorSeverity.HIGH,
      'PERMISSION_DENIED'
    );
  }
  if (config.allowedDomains.length > 0) {
    const ok = config.allowedDomains.some(
      (d) => parsed.hostname === d || parsed.hostname.endsWith(`.${d}`)
    );
    if (!ok) {
      throw new AppError(
        `域名 ${parsed.hostname} 不在白名单中（allowedDomains=${config.allowedDomains.join(',')}）`,
        ErrorCategory.PERMISSION,
        ErrorSeverity.HIGH,
        'PERMISSION_DENIED'
      );
    }
  }
  return parsed;
}

/** 读取 env 覆盖（用户/运维可调；不新增配置中心依赖） */
export function resolveBrowserDriverConfig(
  overrides: Partial<BrowserDriverConfig> = {}
): BrowserDriverConfig {
  const env = process.env;
  const domains = (env.BROWSER_ALLOWED_DOMAINS ?? '')
    .split(',')
    .map((d) => d.trim())
    .filter(Boolean);
  return {
    ...DEFAULT_CONFIG,
    headless: env.BROWSER_HEADLESS === 'true',
    allowPrivateNetwork: env.BROWSER_ALLOW_PRIVATE === 'true',
    timeoutMs:
      Number(env.BROWSER_TIMEOUT_MS) > 0
        ? Number(env.BROWSER_TIMEOUT_MS)
        : DEFAULT_CONFIG.timeoutMs,
    ...(domains.length > 0 ? { allowedDomains: domains } : {}),
    ...overrides,
  };
}

/** 一个会话一个驱动实例（持有 context/page；**浏览器进程按进程共享**，避免每会话一个 Chrome） */
export class BrowserSessionDriver {
  private context: PwContext | null = null;
  private pages: PwPage[] = [];
  private activeIndex = 0;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(
    private readonly sessionId: string,
    private readonly config: BrowserDriverConfig
  ) {}

  /** 执行一个动作（统一捕获异常 → `{success:false, error}`） */
  async execute(action: BrowserActionRequest): Promise<BrowserDriverResult> {
    const startedAt = Date.now();
    try {
      if (action.action === 'close') {
        await this.close();
        return {
          success: true,
          action: 'close',
          durationMs: Date.now() - startedAt,
        };
      }
      // 执行期间暂停空闲计时：否则长动作（如等待缺失选择器）会被"空闲自动关闭"截断
      this.clearIdleTimer();
      const page = await this.ensurePage(action.url);
      const result = await this.run(page, action);
      this.touchIdle();
      return { ...result, durationMs: Date.now() - startedAt };
    } catch (err) {
      return {
        success: false,
        action: action.action,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - startedAt,
      };
    }
  }

  /** 关闭本会话的 context（幂等） */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.clearIdleTimer();
    try {
      await this.context?.close();
    } catch {
      // context 已失效 ⇒ 忽略
    }
    this.context = null;
    this.pages = [];
    logger.info('浏览器会话已关闭', { sessionId: this.sessionId });
  }

  /** 供管理器的"浏览器进程是否还活着"判定 */
  isBrowserConnected(): boolean {
    return sharedBrowser !== null && (sharedBrowser.isConnected?.() ?? true);
  }

  private async run(
    page: PwPage,
    action: BrowserActionRequest
  ): Promise<BrowserDriverResult> {
    switch (action.action) {
      case 'open_tab': {
        if (!action.url)
          throw new AppError(
            'open_tab 需要 url',
            ErrorCategory.VALIDATION,
            ErrorSeverity.HIGH,
            'INVALID_INPUT'
          );
        const u = assertUrlAllowed(action.url, this.config).toString();
        if (!this.context)
          throw new AppError(
            '浏览器上下文未就绪',
            ErrorCategory.EXECUTION,
            ErrorSeverity.HIGH,
            'NO_CONTEXT'
          );
        const newPage = await this.context.newPage();
        await newPage.goto(u, {
          waitUntil: 'domcontentloaded',
          timeout: this.config.timeoutMs,
        });
        this.pages.push(newPage);
        this.activeIndex = this.pages.length - 1;
        return {
          success: true,
          action: 'open_tab',
          url: newPage.url(),
          title: await newPage.title(),
          durationMs: 0,
        };
      }
      case 'navigate': {
        if (!action.url)
          throw new AppError(
            'navigate 需要 url',
            ErrorCategory.VALIDATION,
            ErrorSeverity.HIGH,
            'INVALID_INPUT'
          );
        const u = assertUrlAllowed(action.url, this.config).toString();
        await page.goto(u, {
          waitUntil: 'domcontentloaded',
          timeout: this.config.timeoutMs,
        });
        return {
          success: true,
          action: 'navigate',
          url: page.url(),
          title: await page.title(),
          durationMs: 0,
        };
      }
      case 'click': {
        if (!action.selector)
          throw new AppError(
            'click 需要 selector',
            ErrorCategory.VALIDATION,
            ErrorSeverity.HIGH,
            'INVALID_INPUT'
          );
        await page.click(action.selector, { timeout: this.config.timeoutMs });
        return {
          success: true,
          action: 'click',
          url: page.url(),
          title: await page.title(),
          durationMs: 0,
        };
      }
      case 'fill': {
        if (!action.selector)
          throw new AppError(
            'fill 需要 selector',
            ErrorCategory.VALIDATION,
            ErrorSeverity.HIGH,
            'INVALID_INPUT'
          );
        await page.fill(action.selector, action.value ?? '');
        return {
          success: true,
          action: 'fill',
          url: page.url(),
          durationMs: 0,
        };
      }
      case 'screenshot': {
        const shot = await page.screenshot({
          fullPage: action.fullPage === true,
          type: 'png',
        });
        return {
          success: true,
          action: 'screenshot',
          url: page.url(),
          title: await page.title(),
          screenshot: shot,
          durationMs: 0,
        };
      }
      case 'get_content': {
        const text = await page.innerText('body');
        const limit = action.maxChars ?? this.config.maxContentChars;
        return {
          success: true,
          action: 'get_content',
          url: page.url(),
          title: await page.title(),
          content:
            text.length > limit
              ? `${text.slice(0, limit)}\n…（已截断，原长 ${text.length} 字符）`
              : text,
          durationMs: 0,
        };
      }
      case 'get_tabs': {
        const tabs: BrowserTabInfo[] = [];
        for (let i = 0; i < this.pages.length; i++) {
          const p = this.pages[i];
          tabs.push({
            index: i,
            url: p.url(),
            title: await p.title(),
            active: i === this.activeIndex,
          });
        }
        return { success: true, action: 'get_tabs', tabs, durationMs: 0 };
      }
      case 'back': {
        await page.goBack({ timeout: this.config.timeoutMs });
        return {
          success: true,
          action: 'back',
          url: page.url(),
          title: await page.title(),
          durationMs: 0,
        };
      }
      case 'reload': {
        await page.reload({ timeout: this.config.timeoutMs });
        return {
          success: true,
          action: 'reload',
          url: page.url(),
          title: await page.title(),
          durationMs: 0,
        };
      }
      default:
        throw new AppError(
          `未知动作 ${String(action.action)}`,
          ErrorCategory.VALIDATION,
          ErrorSeverity.HIGH,
          'INVALID_INPUT'
        );
    }
  }

  /** 懒启动（进程级共享）浏览器 + 复用/新建页面 */
  private async ensurePage(url?: string): Promise<PwPage> {
    if (this.closed) this.closed = false;
    const browser = await getSharedBrowser(this.config);
    if (!this.context) {
      this.context = await browser.newContext({
        viewport: this.config.viewport,
        acceptDownloads: false,
      });
      this.context.setDefaultTimeout?.(this.config.timeoutMs);
    }
    if (this.pages.length === 0) {
      const page = await this.context.newPage();
      await page.waitForLoadState?.('domcontentloaded').catch(() => {});
      this.pages.push(page);
      this.activeIndex = 0;
    }
    const page = this.pages[this.activeIndex];
    if (url && this.pages.length === 0) {
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: this.config.timeoutMs,
      });
    }
    return page;
  }

  private touchIdle(): void {
    this.clearIdleTimer();
    if (this.config.idleCloseMs <= 0) return;
    this.idleTimer = setTimeout(() => {
      void this.close();
    }, this.config.idleCloseMs);
    this.idleTimer.unref?.();
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }
}

/** `playwright-core` 动态加载（不装依赖也能启动应用；调用时才报错） */
async function loadPlaywrightCore(): Promise<PwModule> {
  try {
    const importFn = new Function('specifier', 'return import(specifier)') as (
      s: string
    ) => Promise<PwModule>;
    return await importFn('playwright-core');
  } catch {
    throw new AppError(
      'playwright-core 未安装。运行：cd app && bun add playwright-core',
      ErrorCategory.EXECUTION,
      ErrorSeverity.HIGH,
      'DEPENDENCY_UNAVAILABLE'
    );
  }
}

// ─── 进程级共享浏览器 ─────────────────────────────────────────────────────

let sharedBrowser: PwBrowser | null = null;
let launching: Promise<PwBrowser> | null = null;

/** 取（或懒启动）进程级共享浏览器；启动失败给可执行指引 */
async function getSharedBrowser(
  config: BrowserDriverConfig
): Promise<PwBrowser> {
  if (sharedBrowser && (sharedBrowser.isConnected?.() ?? true))
    return sharedBrowser;
  if (launching) return launching;
  launching = (async () => {
    const pw = await loadPlaywrightCore();
    const attempts: Array<Record<string, unknown>> = [
      {
        channel: 'chrome',
        headless: config.headless,
        timeout: config.timeoutMs,
      },
      {
        channel: 'msedge',
        headless: config.headless,
        timeout: config.timeoutMs,
      },
      { headless: config.headless, timeout: config.timeoutMs },
    ];
    const errors: string[] = [];
    for (const opts of attempts) {
      try {
        const browser = await pw.chromium.launch(opts);
        logger.info('浏览器已启动', {
          channel: String(opts.channel ?? 'bundled'),
        });
        return browser;
      } catch (err) {
        errors.push(
          `${String(opts.channel ?? 'bundled')}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
    throw new AppError(
      `浏览器启动失败（已尝试系统 Chrome / Edge / 内置 Chromium）。` +
        `请安装 Chrome 或 Edge，或运行：cd app && bun add -d playwright && npx playwright install chromium。详情：${errors.join(' | ')}`,
      ErrorCategory.EXECUTION,
      ErrorSeverity.HIGH,
      'LAUNCH_FAILED'
    );
  })();
  try {
    sharedBrowser = await launching;
    return sharedBrowser;
  } finally {
    launching = null;
  }
}

/** 关闭进程级浏览器（幂等；进程退出 / stop hook 调用） */
export async function closeBrowserProcess(): Promise<void> {
  const browser = sharedBrowser;
  sharedBrowser = null;
  if (!browser) return;
  try {
    await browser.close();
  } catch {
    // 进程已退出 ⇒ 忽略
  }
}

// ─── 会话级管理（进程内单例） ───────────────────────────────────────────────

const sessions = new Map<string, BrowserSessionDriver>();

/** 取（或建）某会话的驱动 */
export function getBrowserSessionDriver(
  sessionId: string,
  config: BrowserDriverConfig = resolveBrowserDriverConfig()
): BrowserSessionDriver {
  let driver = sessions.get(sessionId);
  if (!driver) {
    driver = new BrowserSessionDriver(sessionId, config);
    sessions.set(sessionId, driver);
  }
  return driver;
}

/** 关闭某会话的浏览器上下文（幂等） */
export async function closeBrowserSession(sessionId: string): Promise<void> {
  const driver = sessions.get(sessionId);
  if (!driver) return;
  await driver.close();
  sessions.delete(sessionId);
}

/** 关闭全部会话（进程退出 / 供 stop hook 调用） */
export async function closeAllBrowserSessions(): Promise<void> {
  const all = [...sessions.values()];
  sessions.clear();
  await Promise.all(all.map((d) => d.close()));
  await closeBrowserProcess();
}
