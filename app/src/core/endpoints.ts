/**
 * 端点 / 本地 host 的**唯一事实源**（硬编码治理 HD-P0-2；方案 §4.1 A1·A3·A4·A6）
 *
 * 覆盖的「事实源」与收编前后的定义点数：
 *   - A1 Ollama 本地地址 `http://localhost:11434`（含 `/v1` 兼容形式）：收编前 9 处 → 1 处
 *   - A3 微信 bot 地址 `http://localhost:7600`：收编前 5 处 → 1 处
 *   - A4 本地 OAuth 地址 `http://localhost:8080`：收编前 2 处 → 1 处
 *   - A6 本机回环 host `127.0.0.1`：收编前 18 处（14 文件） → 1 处
 *
 * **分层硬约束（R00-001；方案 §7.3.1）**：本模块属 `core`，只允许依赖 `core`。因此这里
 * **只提供静态默认常量**：**不读取任何配置、无副作用、无启动期依赖**。配置值（env / 持久化）
 * 的读取与注入由 **app / service 层**在就绪后完成；调用方在 T0/T1 等早期阶段**不传配置**时
 * 天然回落到本文件的常量 —— 这就是「启动期安全」，且**不引入就绪判据 API**、不越层。
 *
 * **与 `core/ports.ts` 的分工（不同事实源，勿合并）**：`core/ports.ts` 负责服务**监听端口**
 * （`DEFAULT_HTTP_PORT` 及端口优先级口径）；本文件负责**端点 URL** 与**本机 host** 默认值。
 *
 * **语义边界（防未来错误合并）**：
 *   1. `LOCAL_HTTP_HOST` 当前同时承担「默认**绑定** host」与「连接/探测**本机**服务的默认目标」
 *      两个**当前等价**的角色。若将来引入「对外绑定策略」（例如绑定 `0.0.0.0`），**必须另立常量**，
 *      **不得**复用本常量 —— 否则会把"对外暴露"与"本机自连"绑死成一处错误耦合。
 *   2. `DEFAULT_OAUTH_LOCAL_BASE_URL` 与本地推理服务（llama.cpp / LocalAI）预设里的 `localhost:8080`
 *      是**数值相同、事实不同**（OAuth 回调服务 vs 本地 LLM 服务）⇒ 按方案 §5 N7 口径**不合并**。
 */

/** 本机回环地址（IPv4）。默认绑定 host；亦用于连接/探测本机服务的默认目标。 */
export const LOCAL_HTTP_HOST = '127.0.0.1';

/**
 * 本机服务的**名称形式** host（`localhost`）—— 用于对用户展示/健康探测的地址。
 *
 * 与 `LOCAL_HTTP_HOST` 指向同一台机器，但字符串形式不同（用户可读、与文档一致），
 * 故按域分立（U-20/B5-2-91）。
 */
export const LOCAL_SERVICE_HOST = 'localhost';

/** Ollama 本地服务默认地址（A1） */
export const DEFAULT_OLLAMA_ENDPOINT = 'http://localhost:11434';

/**
 * Ollama 的 OpenAI 兼容端点（A1）。
 * 由 `DEFAULT_OLLAMA_ENDPOINT` 派生 ⇒ 改端口只需改上面一处。
 */
export const DEFAULT_OLLAMA_OPENAI_ENDPOINT = `${DEFAULT_OLLAMA_ENDPOINT}/v1`;

/** 微信 bot（weixin-cli HTTP Bridge）默认地址（A3） */
export const DEFAULT_WECHAT_BOT_ENDPOINT = 'http://localhost:7600';

/** 本地 OAuth 服务默认地址（A4；本地开发 / 自建部署用） */
export const DEFAULT_OAUTH_LOCAL_BASE_URL = 'http://localhost:8080';

/** 本地 SD WebUI 默认地址（默认绑定回环；U-20/B5-2-91） */
export const DEFAULT_SD_WEBUI_ENDPOINT = `http://${LOCAL_HTTP_HOST}:7860`;

/** 本地 Chrome / Edge 的 CDP 调试端点（浏览器截图用；U-20/B5-2-91） */
export const DEFAULT_CDP_ENDPOINT = `http://${LOCAL_HTTP_HOST}:9222`;

/** 本地 ComfyUI 默认地址（U-20/B5-2-92） */
export const DEFAULT_COMFYUI_ENDPOINT = `http://${LOCAL_HTTP_HOST}:8188`;

/**
 * 解析相对请求 URL 用的**占位基址**（`new URL(req.url, …)`）。
 *
 * 仅用于补全 `req.url` 的 origin，**不是**真实连接目标（U-20/B5-2-93）。
 */
export const LOCAL_REQUEST_BASE_URL = `http://${LOCAL_SERVICE_HOST}`;

/** 本机 MCP 代理地址（OAuth 侧的 `MCP_PROXY_URL`；U-20/B5-2-93） */
export const DEFAULT_MCP_PROXY_URL = `http://${LOCAL_SERVICE_HOST}:8205`;

/** 本地 OAuth 开发服务的 API 面默认地址（U-20/B5-2-93） */
export const DEFAULT_LOCAL_OAUTH_API_BASE = `http://${LOCAL_SERVICE_HOST}:8000`;

/** 本地 OAuth 开发服务的应用面默认地址（U-20/B5-2-93） */
export const DEFAULT_LOCAL_OAUTH_APPS_BASE = `http://${LOCAL_SERVICE_HOST}:4000`;

/**
 * 对外**绑定**的通配 host（`0.0.0.0`）。
 *
 * ⚠️ 仅用于「监听/绑定」语义（例如 webhook 通道的 `listenHost`），**不得**用于连接目标 ——
 * 否则会把"对外暴露"与"本机自连"绑死（见本文件 §语义边界 1；U-20/B5-2-94）。
 */
export const WILDCARD_BIND_HOST = '0.0.0.0';

/** BlueBubbles 服务默认地址（本机默认端口 1234；U-20/B5-2-94） */
export const DEFAULT_BLUEBUBBLES_SERVER_URL = `http://${LOCAL_SERVICE_HOST}:1234`;

/**
 * 供应商引导记录里 llama.cpp 的默认 baseUrl（历史值为 8080）。
 *
 * 与 `LOCAL_INFERENCE_ENDPOINTS.llamacpp`（11435）**数值不同、来源不同**（引导记录 vs
 * 运行时预设）⇒ 按方案 §5 N7 口径**不合并**，仅按域命名（U-20/B5-2-94）。
 */
export const DEFAULT_BOOTSTRAP_LLAMACPP_BASE_URL = `http://${LOCAL_SERVICE_HOST}:8080`;

/**
 * 本地推理服务的 OpenAI 兼容端点（供供应商预设的候选清单使用；U-20/B5-2-92）。
 *
 * 每个服务保留 `hostname`（本机名形式）与 `loopback`（`127.0.0.1`）两种候选，
 * 与前端 `client/src/services/endpoints.ts` 的 `LOCAL_PROVIDER_ENDPOINTS` **同值**；
 * 两个部署单元无法共享模块，同值由契约测试钉住。
 * 注意：`localAI` 的 8080 与本地 OAuth 回调服务数值相同、事实不同（不复用）。
 */
export const LOCAL_INFERENCE_ENDPOINTS = {
  ollama: {
    hostname: DEFAULT_OLLAMA_OPENAI_ENDPOINT,
    loopback: `http://${LOCAL_HTTP_HOST}:11434/v1`,
  },
  llamacpp: {
    hostname: `http://${LOCAL_SERVICE_HOST}:11435/v1`,
    loopback: `http://${LOCAL_HTTP_HOST}:11435/v1`,
  },
  lmStudio: {
    hostname: `http://${LOCAL_SERVICE_HOST}:1234/v1`,
    loopback: `http://${LOCAL_HTTP_HOST}:1234/v1`,
  },
  localAI: {
    hostname: `http://${LOCAL_SERVICE_HOST}:8080/v1`,
    loopback: `http://${LOCAL_HTTP_HOST}:8080/v1`,
  },
} as const;
