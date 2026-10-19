/**
 * 通用常量
 *
 * `@kind` 四分类（清单 §5 D-1）：
 * - **A** 协议 / 结构 / 键名 / 目录名 / 版本 / UA（不可调）
 * - **B** 超时 / 并发 / 上限 / 阈值 / 大小（默认值在 `./defaults.ts`，`LIRI_*` env 覆盖）
 * - **C** 模型 window / 价格 / 能力（**禁止**出现在常量文件）
 * - **D** 提示词 / 文案（走工作流 C 资源体系）
 */

import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { getRuntimeDefaults } from './defaults';

/** B 类默认值快照（模块加载时读一次 env ⇒「启动前设置生效」） */
const B = getRuntimeDefaults();

/** @kind A */
export const APP_NAME = 'Liri';

/**
 * 版本号唯一事实来源：app/package.json
 * 模块加载时直接解析，不依赖启动 env 注入时序（.env 中已删除 APP_VERSION 假值）
 */
function resolveAppVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url)); // app/src/constants
    const pkgPath = join(here, '..', '..', 'package.json'); // app/package.json
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
        version?: string;
      };
      if (pkg.version) return pkg.version;
    }
  } catch {
    // 解析失败回退 env / 默认值
  }
  return process.env.APP_VERSION || '0.0.0';
}

/** @kind A */
export const APP_VERSION = resolveAppVersion();

/** @kind B */
export const DEFAULT_SESSION_TIMEOUT = B.sessionTimeoutMs;
/** @kind B */
export const COMMON_HEARTBEAT_INTERVAL = B.heartbeatIntervalMs;
/** @kind B */
export const CONNECTION_TIMEOUT = B.connectionTimeoutMs;
/** @kind B */
export const REQUEST_TIMEOUT = B.requestTimeoutMs;
/** @kind B */
export const MAX_CACHE_SIZE_BYTES = B.maxCacheSizeBytes;

/**
 * 交互等待单槽 TTL（毫秒）—— 与 ChatManagerTAORAdapter 的等待上限同口径。
 *
 * 用途：`pendingInteractions` 条目的 `expiresAt`（S4 自愈），到点未释放即视为无挂起。
 *
 * @kind A
 */
export const PENDING_INTERACTION_TTL_MS = 5 * 60 * 1000;

/** 时间换算：1 分钟（毫秒） @kind A */
export const MS_PER_MINUTE = 60 * 1000;
/** 时间换算：1 小时（毫秒） @kind A */
export const MS_PER_HOUR = 60 * MS_PER_MINUTE;
/** 时间换算：1 天（分钟，用于免打扰窗口跨午夜计算） @kind A */
export const MINUTES_PER_DAY = 24 * 60;

/**
 * G-10（2026-10-19）：主动消息**默认冷却**（毫秒）。
 *
 * 仅在用户未配置 `proactive.cooldownMs[kind]` 时生效（配置优先）；不写进判定逻辑的隐藏默认。
 *
 * @kind A
 */
export const PROACTIVE_TASK_RESULT_COOLDOWN_MS = MS_PER_MINUTE;
/** @kind A */
export const PROACTIVE_RISK_ALERT_COOLDOWN_MS = 5 * MS_PER_MINUTE;
/** 提醒默认无冷却（0 毫秒；避免 `_MS` 后缀被单位量级规则误判） @kind A */
export const PROACTIVE_REMINDER_NO_COOLDOWN = 0;
/** @kind A */
export const PROACTIVE_SUGGESTION_COOLDOWN_MS = 30 * MS_PER_MINUTE;

/**
 * 产品默认语言 / 时区（**唯一真源**）。
 *
 * 口径（`dev_docs/20261013/硬编码统一治理方案-20261013.md` §11 `Q-H2`，2026-10-13 裁定）：
 * 统一为 **`zh-CN` / `Asia/Shanghai`** —— 依据：① 仓内渠道以国内为主（企微/钉钉/飞书/微信/QQ/元宝）；
 * ② 前端 i18n 回退即 `zh`（`client/src/i18n/index.ts:33`）；③ 语音链路默认 `zh-CN`
 * （`services/voice/services/ttsConfigOverlay.ts`、`voice/WakeWordEngine.ts`）。
 *
 * ⚠️ **历史漂移已消除**：本常量原为 `en-US`/`UTC`，与 i18n/语音链路的 `zh-CN` **口径相反**
 * 且**零消费者**（grep 仅命中定义处）——本轮改值并**接上消费者**（真源必须被引用，否则是"假真源"）。
 * ⚠️ **`core` 层不得引用本文件**（`constants` = infra，而 `core` 仅可依赖 `core`，R00-001）⇒
 * 需要同值的 core 侧常量只能"**同值自持 + 由测试锁同值**"（不跨层引用）。
 *
 * @kind A
 */
export const DEFAULT_LOCALE = 'zh-CN';
/** @kind A */
export const DEFAULT_TIMEZONE = 'Asia/Shanghai';

/** @kind B */
export const MAX_FILE_SIZE = B.maxFileSizeBytes;
/** @kind B */
export const MAX_FILENAME_LENGTH = B.maxFilenameLength;

/** @kind A */
export const DEFAULT_MODEL = '';

/**
 * 哨兵值：表示"未选择具体模型，由 SmartRouter 自动决策"。
 * 前端传此值时，后端 resolveSmartModel() 通过 SmartRouter 动态选择模型。
 * 客户端同步定义在 client/src/services/chatService.ts，Rust 侧同步定义在 client/src-tauri/src/commands/chat.rs。
 *
 * @kind A
 */
export const DEFAULT_MODEL_SENTINEL = 'pyapp-default';

/**
 * 凭据「已存盘」哨兵值：DB `ai_providers.api_key` 列写入它表示**真实密钥存于
 * `~/.pyapp/credentials.json`**（见 `CredentialStore`），而非明文。
 *
 * **唯一真源**（硬编码治理「同名常量」B3-4）：原于 `ai/credentials/CredentialStore.ts`（app 层）
 * 与 `chronos/maintenance/ChronosBackgroundHousekeeping.ts`（infra 层）**各写一份** —— 后者注释
 * 自述「本地复刻**避免跨层引用**」（D-146）⇒ 本片把真源**上提到 infra**（本文件），
 * 使 `chronos`=infra 与 `ai`=app **都能合法引用**（app→infra / infra→infra 均合 R00-001）。
 *
 * @kind A
 */
export const CRED_STORED_MARKER = '__stored__';

/** @kind B */
export const DEFAULT_MAX_TOKENS = B.defaultMaxTokens;

/**
 * 产品 **User-Agent 标识**（**唯一真源**）：`Liri/<APP_VERSION>`。
 *
 * 版本号**只此一处**（`APP_VERSION` 读 `app/package.json`）。
 *
 * ⚠️ **为什么需要它**（硬编码治理 `HD-P1-1`）：原先 14 个文件各自写死 UA，且版本号互不一致
 * （`Liri/1.0.0` · `Liri/1.0` · `Liri/2.0` · `Liri-Updater/1.0.0` · `Liri-MCPMarketplace/1.0`
 * · 甚至**旧品牌名** `PY_APP-Knowledge/1.0`）⇒ 第三方按 UA 限流/风控/统计时口径混乱。
 *
 * ⚠️ **不适用**（协议要求，见治理方案 §5）：抓 HTML 反爬用的 **Chrome 伪装 UA**
 * （`tools/WebSearchTool/providers.ts`）与 edge-tts 的 **Chromium UA**（`edgeTTSProvider`）——
 * 它们不是"产品标识"，**不可**合并到本常量。
 *
 * @kind A
 */
export const USER_AGENT = `${APP_NAME}/${APP_VERSION}`;

/**
 * 按用途派生产品 UA：`Liri/<版本> (<用途>)`。
 *
 * 用途后缀供第三方按**来源**归因/限流（如 `WebFetch` 与 `Updater` 可分别限速），
 * 而**版本号仍只来自** `USER_AGENT`（一处改、处处生效）。
 *
 * @param purpose 用途标识（如 `'WebFetch'` / `'Updater'` / `'MCPMarketplace'`）
 */
export function buildUserAgent(purpose: string): string {
  return `${USER_AGENT} (${purpose})`;
}

/** @kind A */
export const CLIENT_ID = 'liri_client';
