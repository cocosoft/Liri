/**
 * 工具分类与按任务裁剪配置（Step 1 + Step 2）
 *
 * 背景：streamMessageFlow 当前把全部注册工具（约 50-60 个，~10K tokens）发给模型，
 * 小上下文（如 llama.cpp 8K）下工具定义放不进，preSendContextProtection 只能整体移除
 * → 模型无工具可用。本配置提供「工具 → 类别」与「任务 → 类别」两张静态映射，
 * 供裁剪注入点（streamMessageFlow）按任务只注入相关子集（Step 3）。
 *
 * 设计约束：
 *  - 映射以**工具名**为 key（ToolRegistry.getToolSchemas 的 schema.name），
 *    不改工具注册结构，纯静态常量，零侵入。
 *  - 未列出的工具默认归 `misc`；⚠️ `misc` **不在任何任务白名单 ⇒ 会被裁剪**
 *    （2026-10-05 订正：本行原写"保留在默认集"，与实现相悖，见 N-44/N-45）。
 *  - 类别为英文内部 key；任务类型对齐 modelRouter.ts 的 TaskType。
 */

import { toWireToolName } from './toolNameCodec';
import type { ToolNameConstant } from './toolNameConstants';
import { getLogger } from '@modules/monitoring';
import { feature } from '@openliri/kernel';
import type { FeatureFlag } from '@openliri/kernel';

const logger = getLogger('tools:categories');

// ============================================================
// Step 1: 工具类别定义
// ============================================================

export type ToolCategory =
  | 'file' // 文件写入/转换/项目文件写入
  | 'file_read' // 文件只读（读/glob/项目文件读）— 本地模型轻量集专用
  | 'shell' // 终端命令（bash/powershell）
  | 'code' // 代码/LSP/项目创建/git
  | 'search' // 代码搜索/Web 搜索/工具搜索
  | 'network' // 网络抓取
  | 'image' // 图像生成/分析/处理
  | 'video' // 视频生成/分析/处理
  | 'media' // 音频/PDF/二维码/媒体元数据
  | 'task' // 任务/todo/cron
  | 'session' // 会话保存/管理
  | 'agent' // SubAgent/团队协作
  | 'system' // 监控/追踪/时间/配置/通用
  | 'interaction' // 提问/简报
  | 'doc' // 文档生成/office 工作流
  | 'notify' // 消息/通知
  | 'channel' // 通道/广播
  | 'calendar' // 日历
  | 'mail' // 邮件
  | 'knowledge' // 知识库（保存/搜索/写入/导入导出）
  | 'mcp' // MCP 三方工具（动态名 `${server}__${tool}`，无法预先登记）
  | 'assist' // 通用协作助手（计划/剪贴板/画布 —— 任何对话都可用）
  | 'misc'; // 未分类；⚠️ **不在任何任务白名单** ⇒ 会被裁剪（新增工具必须显式登记类别，见 N-44）

/** 工具名 → 类别映射（覆盖运行时内置 + 模块注册工具；字面量键用于编译期完整性校验） */
const TOOL_CATEGORY_ENTRIES = {
  // ── file_read 文件只读（本地模型轻量集可用） ──
  file_read: 'file_read',
  glob: 'file_read',
  read_project_file: 'file_read',
  // 2026-10-08（AI-VFS 只读试点）：`read_vfs`/`list_vfs`/`stat_vfs` 为只读系统调用 ⇒ 归 file_read
  // （⚠️ N-44/N-45：不登记即落 misc ⇒ 不在任何任务白名单 ⇒ 被静默裁剪）。
  read_vfs: 'file_read',
  list_vfs: 'file_read',
  stat_vfs: 'file_read',
  // ── file 文件写入/转换 ──
  file_write: 'file',
  file_edit: 'file',
  file_convert: 'file',
  write_project_file: 'file',
  // 2026-10-08（AI-VFS 只读试点）：`write_vfs` 为写类系统调用 ⇒ 归 file（与 file_write 同档）
  write_vfs: 'file',

  // ── shell 终端 ──
  bash: 'shell',
  powershell: 'shell',
  // 2026-10-08（工具可见性全面排查，守卫实测抓出）：`tungsten`（TungstenTool，交互式终端会话管理，
  // aliases 含 terminal/session）此前**完全未登记** ⇒ 落 misc ⇒ 一旦其条件启用即被静默裁剪。
  tungsten: 'shell',

  // ── code 代码 ──
  lsp: 'code',
  create_project: 'code',
  // 2026-10-08（同上）：`code_run`（CodeRunnerTool，多语言代码执行）此前未登记 ⇒ 同风险。
  code_run: 'code',

  // ── search 搜索（含技能发现/加载：tool_search 同链） ──
  grep: 'search',
  web_search: 'search',
  tool_search: 'search',
  search_codebase: 'search',
  skill: 'search',
  skill_view: 'search',
  skills_list: 'search',

  // ── network 网络 ──
  web_fetch: 'network',

  // ── image 图像 ──
  image: 'image',
  image_analysis: 'image',
  image_generate: 'image',
  image_svg_generate: 'image',
  image_display: 'image',
  media_image_convert: 'image',
  media_image_resize: 'image',
  media_image_crop: 'image',
  media_image_rotate: 'image',
  media_image_watermark: 'image',
  media_image_adjust: 'image',

  // ── video 视频 ──
  video: 'video',
  video_analysis: 'video',
  video_generate: 'video',
  video_display: 'video',
  browser_vision: 'video',
  media_video_compress: 'video',
  // 2026-10-06 订正：原键写作连字符形态（`media_video_extract-audio` / `-thumbnail`），
  // 与工具**真名**（下划线，见 `VideoExtractAudioTool.ts:18`）不一致，且 `toWireToolName()`
  // 视 `-` 为 wire-safe ⇒ 不会归一 ⇒ 真名两路都查不到该类目 ⇒ 落 `misc` ⇒ 被任务裁剪
  // （同族 `media_video_compress` 正常）。现改为与 `tool.name` 一致的形态。
  media_video_extract_audio: 'video',
  media_video_extract_thumbnail: 'video',

  // ── media 其他媒体 ──
  audio_play: 'media',
  music: 'media',
  media_info: 'media',
  media_delete: 'media',
  media_deleteBatch: 'media',
  media_qr_generate: 'media',
  media_qr_decode: 'media',
  media_pdf_extract: 'media',

  // ── task 任务/todo/cron ──
  todo_write: 'task',
  task_stop: 'task',
  create_task_list: 'task',
  update_task_status: 'task',
  get_task_list: 'task',
  // P4b（2026-10-16，方案 `dev_docs/20261016/工具可见性治理-P4a-影子工具评估.md` §2.2(1)）：
  // `task_output` 原为「声明面有名、零 loader、零类别登记」的影子工具 ⇒ 即使注册也会落
  // `misc` 被裁。它读的是 `taskRegistry` 的任务输出（真实现），且 `AgentTool` 提示词已
  // 引导模型"通过 TaskOutput 工具获取后台任务结果" ⇒ 不登记即留悬空承诺。归 `task`
  // （与 `get_task_list` 同族；该类别属 coding/agent 白名单 ⇒ 与"后台任务"场景一致）。
  task_output: 'task',
  cron_create: 'task',
  cron_delete: 'task',
  cron_list: 'task',
  cron_stop: 'task',

  // ── session 会话 ──
  save_conversation: 'session',
  sessions: 'session',
  // N-44（2026-09-20，用户决策）：yield 让出工具补登记 —— 原先未登记 ⇒ 落 misc ⇒
  // 在任何任务下都被裁（实测 default 裁剪日志 removedNames 含 sessions_yield）。
  sessions_yield: 'session',

  // ── agent 代理 ──
  agent: 'agent',
  // D1 接线（2026-10-11）：coding 变体下 `team_create`/`team_delete` 成为**生效工具** ⇒ 必须显式
  // 登记类别（否则落 misc ⇒ 被裁剪，N-44 同族）。键名订正为**真工具名**（snake_case）；原
  // `TeamCreate`/`TeamDelete`（PascalCase）与真实注册名不符，属**死键**，一并订正。
  team_create: 'agent',
  team_delete: 'agent',

  // ── system 系统 ──
  monitor: 'system',
  trace_recording: 'system',
  time: 'system',
  sleep: 'system',
  // N-44 扩展（2026-09-20，用户决策）：自唤醒工具补登记 —— 与同族的阻塞式 `sleep`
  // 保持同一类别口径（'system'，在各通用任务集内均保留），避免"注册了却永久不可见"。
  sleep_for: 'system',
  sleep_until: 'system',
  config: 'system',
  repl: 'system',
  notebook: 'system',
  enter_worktree: 'system',
  exit_worktree: 'system',

  // ── interaction 交互 ──
  ask_user_question: 'interaction',
  brief: 'interaction',
  // 2026-10-16：`propose_plan` 已下线（审批入口合并到 `ask_user_question`）⇒ 移除其类别登记；
  // 曾于 P4b 归入本类别（`interaction`，与 `ask_user_question` 同档）。

  // ── doc 文档 ──
  doc_generate: 'doc',
  // P4b（2026-10-16，P4a 评估 §2.2(3)）：`pdf` 原为影子工具。它是**唯一** PDF 生成器
  // （`media_pdf_extract` 只做抽取、`file_convert` 做格式转换），且 prompt 的
  // 「交付物落点口径」（`builtinSections.ts:683`）已把 `pdf` 列为生成类工具 ⇒ 归 `doc`
  // （该类别在 chat/default/coding/agent 四个主任务白名单内 ⇒ 与"通用生成"语义一致）。
  // ⚠️ 接线同时收口了 `extract`/`info` 两个假成功分支（见 PDFTool.ts 内注释）。
  pdf: 'doc',

  // ── notify 消息/通知 ──
  send_message: 'notify',
  push_notification: 'notify',
  subscribe_pr: 'notify',

  // ── channel 通道 ──
  channel: 'channel',
  broadcast: 'channel',
  list_peers: 'channel',

  // ── knowledge 知识库（保存/搜索/管理） ──
  // 注：`knowledge_save` 在内置常量表；其余 `knowledge_*` 为运行期注册 ⇒ 见 RUNTIME_TOOL_CATEGORIES。
  knowledge_save: 'knowledge',

  // ── mcp 三方 MCP 工具 ──
  // N-44：静态名归入 'mcp'；**动态名**（`McpToolWrapper` 的 `${server}__${tool}`）由
  // `getToolCategory` 的双下划线判据兜住（见该函数注释）。
  mcp_tool: 'mcp',
  mcp_resource: 'mcp',

  // ── assist 通用协作助手 ──
  // N-44（2026-09-20，用户决策）：plan / clipboard / canvas 从 misc 迁出 ——
  // 三者均为"任何对话都可能用到"的协作能力，此前因 misc 不被任何白名单收录而全程不可见。
  plan: 'assist',
  clipboard: 'assist',
  canvas: 'assist',

  // ── 编译期完整性补齐（I-1，2026-10-18）──
  // 这些名字在 `TOOL_NAME_CONSTANTS` 中但此前未登记类别（落 misc ⇒ 被裁剪）。
  // 归类只影响「未来接线后的可见面」；当前它们均不在生成物 `TOOL_NAMES` ⇒
  // `conditional` 仍会使其不可见（零行为变更）。
  // 2026-10-23（Q-18）：原「下线类」6 个已摘除声明，故其类别登记一并移除。
  agents_list: 'agent',
  kanban: 'task',
  mcp_auth: 'mcp',
  music_generate: 'media',
  tts: 'media',

  // ── misc 其他（⚠️ 不会被任何任务白名单保留 —— 仅作"已知但不默认开放"的归档） ──
  browser: 'misc',
  computer_use: 'misc',
} as const satisfies Record<string, ToolCategory>;

/**
 * **运行期注册工具**的类别表（I-2，2026-10-18）。
 *
 * 与内置表分离的原因：`TOOL_NAME_CONSTANTS` 只收标识符安全的内置名；
 * 冒号命名空间 / 模块运行期注册的名字无法进入该常量表，故单独登记并由
 * `scripts/../tests/tools/runtimeToolCategories.test.ts` 断言「已知运行期名字均已登记」。
 *
 * ⚠️ N-44/N-45：**不登记 ⇒ 落 misc ⇒ 不在任何任务白名单 ⇒ 被静默裁剪**。
 * wire 形态（如 `workflow_run-template`）由 `WIRE_KEYED_CATEGORIES` 自动派生，无需另登记。
 */
const RUNTIME_TOOL_CATEGORIES = {
  'office:workflow': 'doc',
  // N-45（2026-10-05）：懒加载注册的编排工具此前**完全未登记** ⇒ misc ⇒ 被裁剪
  'office:doc-pipeline': 'doc',
  'calendar:add': 'calendar',
  'calendar:list': 'calendar',
  'calendar:update': 'calendar',
  'calendar:delete': 'calendar',
  'mail:send': 'mail',
  knowledge_search: 'knowledge',
  knowledge_write: 'knowledge',
  knowledge_delete: 'knowledge',
  knowledge_import: 'knowledge',
  knowledge_export: 'knowledge',
  knowledge_restore: 'knowledge',
  knowledge_snapshots: 'knowledge',
  // P0-2 续（2026-10-08）：用户工作流模板工具（运行期注册，tools 域外）。
  'workflow:run-template': 'assist',
} as const satisfies Record<string, ToolCategory>;

/**
 * 对外只读视图（保留 `Record<string, ...>` 索引签名，供按动态工具名查找）。
 *
 * I-1：真正的字面量键在 `TOOL_CATEGORY_ENTRIES`，下方 `ALL_BUILTIN_TOOLS_CATEGORIZED`
 * 在**编译期**强制「`TOOL_NAME_CONSTANTS` 的每个内置工具都必须登记类别」——
 * 漏登记会让该常量类型不再是 `true` ⇒ `tsc` 直接报错。
 */
export const TOOL_CATEGORIES: Record<string, ToolCategory> = {
  ...TOOL_CATEGORY_ENTRIES,
  ...RUNTIME_TOOL_CATEGORIES,
};

type MissingBuiltinToolCategory = Exclude<
  ToolNameConstant,
  keyof typeof TOOL_CATEGORY_ENTRIES
>;

/** 编译期断言：漏登记内置工具类别 ⇒ 本行类型错误（不是运行时告警）。 */
export const ALL_BUILTIN_TOOLS_CATEGORIZED: MissingBuiltinToolCategory extends never
  ? true
  : MissingBuiltinToolCategory = true;

/**
 * **有意归档**的工具（归类 `'misc'` ⇒ 不在任何任务白名单 ⇒ 对模型永久不可见）。
 *
 * 唯一事实源：`ARCHIVED_MISC_TOOLS`（守卫 `tests/tools/toolNameLists.test.ts` 据此断言
 * "misc 集合 == 本集合"，防止新工具被顺手扔进 `misc` 而静默消失）。
 * 新增到此集合必须有明确理由（如 `computer_use` 属高风险桌面自动化，暂不默认开放）。
 */
export const ARCHIVED_MISC_TOOLS: ReadonlySet<string> = new Set([
  'browser',
  'computer_use',
]);

/**
 * 未登记告警去重集（运行期兜底）。
 *
 * 为什么需要：**测试只能枚举"内置面"（`TOOL_NAMES`）**，而 `office:*` / `calendar:*` /
 * `knowledge_*` / `workflow:*` 等由**模块在运行期注册** ⇒ 测试看不见它们，漏登记**不会被 CI 发现**
 * （历史三次现场：`sessions_yield`、`office:doc-pipeline`、`workflow:run-template`）。
 * 故在裁剪点对"落 `misc` 且非归档"的工具**首次出现即 WARN**，让该缺陷当场可观测。
 */
const warnedUnregisteredTools = new Set<string>();

/**
 * **wire 名 → 类别** 索引（N-45，2026-10-05）。
 *
 * 为什么必需：**出站工具定义用 wire 安全名**（`ChatRequestPrep.buildToolDefinitions`
 * 经 `toWireToolName()`：`office:workflow` → `office_workflow`），而按任务裁剪
 * （`filterToolsByTask`）读的正是定义里的名字。若只按真名建表，**冒号命名空间工具
 * 会全部查不到类别** ⇒ 落 `'misc'` ⇒ 被裁剪 ⇒ 模型函数清单里根本没有该工具。
 *
 * 实测（2026-10-05，探针核对运行期 77 个工具）：`office:workflow` 真名判为 `doc`
 * （default/chat 白名单内），wire 名却判为 `misc` ⇒ **被静默裁剪**，
 * 与"模型称该工具不存在 / `tool_search` 返回空"的现场一致。
 * 同机制适用于 `calendar:*`（4 个）与 `mail:send`（未在本实例注册，故未实测）。
 */
const WIRE_KEYED_CATEGORIES: Record<string, ToolCategory> = {};
for (const [name, category] of Object.entries(TOOL_CATEGORIES)) {
  const wire = toWireToolName(name);
  // 真名优先（下方查找顺序）；此处仅补 wire 形态，冲突时首个登记者胜出
  if (WIRE_KEYED_CATEGORIES[wire] === undefined) {
    WIRE_KEYED_CATEGORIES[wire] = category;
  }
}

/**
 * 获取工具类别（真名与 wire 名两种形态均可解析）。
 *
 * N-44（2026-09-20）两处更正：
 * 1. **未命中 → `'misc'`，而 `'misc'` 不在任何任务白名单 ⇒ 会被裁剪** ——
 *    原注释写"保底保留"与实现相悖，已更正。⇒ **新增工具必须显式登记类别**，
 *    否则即便已注册进 toolRegistry，对模型仍**永久不可见**（N-27 / N-37 / N-41 同族）。
 * 2. **MCP 动态工具**：`McpToolWrapper` 将其命名为 `${server}__${tool}`，无法预先登记 ⇒
 *    按双下划线判据归类为 `'mcp'`（实测现有内置工具名**均不含 `__`** ⇒ 判据无碰撞）。
 *
 * N-45（2026-10-05）补第 3 点：
 * 3. **形态陷阱**：登记用真名、裁剪用 wire 名 ⇒ 冒号工具全部落 misc 被裁。
 *    现按"真名 → wire 名 → misc"三级解析（见 `WIRE_KEYED_CATEGORIES`）。
 *    ⚠️ 回归警示：原测试用**真名**断言 `filterToolsByTask`，与生产（wire 名）不一致，
 *    故该缺陷长期漏检；测试须用 `function.name`（wire 形态）覆盖。
 */
export function getToolCategory(toolName: string): ToolCategory {
  if (toolName.includes('__')) return 'mcp';
  return TOOL_CATEGORIES[toolName] ?? WIRE_KEYED_CATEGORIES[toolName] ?? 'misc';
}

// ============================================================
// Step 2: 任务 → 工具类别映射
// 任务类型对齐 modelRouter.ts 的 TaskType
// ============================================================

/**
 * 各任务的工具类别白名单。裁剪时只保留命中这些类别的工具。
 * 未列出的任务类型 → 回退 `default` 保底集。
 */
export const TASK_TOOL_CATEGORIES: Record<string, ToolCategory[]> = {
  // 日常对话：轻量只读为主（文件读、搜索、网络、交互、会话、知识库、系统）
  // N-44（2026-09-20，用户决策）：补入 doc / channel / calendar / mail / mcp / assist ——
  // 这四类此前不在任何白名单内 ⇒ 其工具（doc_generate / channel / broadcast /
  // calendar:* / mail:send 等）对模型全程不可见；mcp 见 getToolCategory 判据；
  // assist = plan / clipboard / canvas。
  // 2026-10-11（真机事故修复）：补入 `shell` —— 原 chat/default 集**不含 shell** ⇒
  // `bash`/`powershell` 对模型不可见（运行日志实证：`taskType:"default"` 裁剪
  // 79→40，removedNames 含 bash/powershell）⇒ **普通（非项目）会话里的执行类任务
  // 无法跑命令**（模型只好自述"环境无 shell 工具"）。shell 是通用执行能力，
  // 小上下文场景已由独立的 `local` 轻量集兜底 ⇒ 不应再从通用集里剔除。
  // ⚠️ 可见性 ≠ 授权：命令执行仍走审批放行（BashTool / ApprovedCommandRegistry）。
  chat: [
    'file',
    'file_read',
    'shell',
    'search',
    'network',
    'interaction',
    'session',
    'knowledge',
    'system',
    'doc',
    'channel',
    'calendar',
    'mail',
    'mcp',
    'assist',
  ],
  // 通用兜底（与 chat 一致，避免裁剪后无工具；含 shell，同 chat 的 2026-10-11 结论）
  default: [
    'file',
    'file_read',
    'shell',
    'search',
    'network',
    'interaction',
    'session',
    'knowledge',
    'system',
    'doc',
    'channel',
    'calendar',
    'mail',
    'mcp',
    'assist',
  ],
  // G-2（2026-10-18）：**远程 IM / Webhook 通道的最小工具面**（PoLP）。
  // 刻意**不含** `shell`（bash / powershell）与 `file`（file_write / file_edit / 写类）：
  // 远程消息来源不可信，执行命令 / 写盘必须由用户在本机会话内发起。
  // 保留只读与交互能力（读文件、搜索、网络、会话、知识库、系统、通道出站）。
  messaging: [
    'file_read',
    'search',
    'network',
    'interaction',
    'session',
    'knowledge',
    'system',
    'channel',
  ],
  // U-02（2026-10-20）：AlwaysOn **发现阶段**的最小工具面（只读 + 搜索）。
  // 刻意**不含**：`shell`（命令执行）、`file`（写/改）、`session`（派生/删除会话）、
  // `channel`（出站）、`network`（web_fetch / browser —— 可产生外部副作用）。
  // ⚠️ 生效恒集（`getMandatoryTools()`：能力开启时为 `todo_write` / `agent`）仍会被强制保留 ——
  //    这是全仓统一约定，本任务类型不单独例外；因此这里保证的是"**不含写盘/执行/会话/出站类**"，
  //    不是数学意义上的严格只读。
  alwayson_discovery: ['file_read', 'search'],
  // 简单问答/摘要：最轻量
  quick: ['search', 'network', 'system'],
  // 翻译润色：文件读 + 轻量
  translation: ['file', 'file_read', 'search', 'system'],
  // 编码：文件 + 终端 + 代码 + 搜索 + 网络 + 知识库 + 任务 + 系统 + MCP
  // N-44 扩展（2026-09-20，用户决策）：补 'mcp' —— 项目/编码会话是 MCP（GitHub/DB 等）
  // 最典型的使用场景，此前未加 ⇒ 该任务类型下 MCP 工具仍被裁。
  coding: [
    'file',
    'file_read',
    'shell',
    'code',
    'search',
    'network',
    'knowledge',
    'task',
    'system',
    'mcp',
    // 2026-10-08（用户裁定）：补 'assist' —— 用户工作流模板工具 `workflow:run-template`
    // 在**编码/代理**任务下同样适用（模板多为开发/运维流程），此前只在 chat/default 可见。
    // ⚠️ 副作用（如实）：同类的 plan / clipboard / canvas 也随之在这些任务下可见。
    'assist',
  ],
  // 自主代理：编码全集 + 代理 + 会话 + MCP
  agent: [
    'file',
    'file_read',
    'shell',
    'code',
    'search',
    'network',
    'knowledge',
    'task',
    'agent',
    'session',
    'system',
    'mcp',
    // 2026-10-08（用户裁定）：同 coding（见上）。
    'assist',
  ],
  // 定时任务：任务管理 + 通知 + 系统
  scheduled: ['task', 'notify', 'system'],
  // 图片生成/分析
  image: ['image', 'file', 'file_read', 'search', 'system'],
  vision: ['image', 'file', 'file_read', 'system'],
  ocr: ['image', 'file', 'file_read', 'system'],
  // 视频
  video: ['video', 'file', 'file_read', 'media', 'system'],
  text_to_video: ['video', 'file', 'file_read', 'media', 'system'],
  image_to_video: ['video', 'image', 'file', 'file_read', 'media', 'system'],
  // 语音
  tts: ['media', 'system'],
  stt: ['media', 'system'],
  // 本地模型（Ollama/llama.cpp）：工具能力弱 + 上下文小，只保留最小只读集 + 提问交互。
  // 9 个工具（file_read 3 + search 4 + interaction 2），工具定义 ~1.4K tokens，
  // 使 8K 窗口下工具定义能真正发送（此前 19 个 ~2.9K tokens 超预算被整体移除 → 模型无工具）。
  local: ['file_read', 'search', 'interaction'],
  // 向量化/知识库：无工具需求（非对话任务）
  embedding: [],
  reranking: [],
  knowledge_compile: [],
};

/** 任务类型裁剪时默认回退的任务 key（保底，避免裁剪后工具集为空） */
export const DEFAULT_TASK_KEY = 'default';

/**
 * P3 修复（2026-09-17）：恒保留工具，不受任务类别裁剪影响。
 * todo_write 类别为 'task'，而 chat/default 白名单不含 'task'
 * → 普通对话中 todo_write 被裁剪 → 模型永不调用 → TaskCard 永不出现。
 * 任务/进度卡是通用协作能力，任何对话都须可用，故列为 mandatory 恒保留。
 *
 * N-41（2026-09-20）：`agent` 同理恒保留。实测 `taskType:"default"` 裁剪日志
 * （`streamMessageFlow` 的「按任务裁剪工具集」，before:60 → after:26）中 `agent`
 * 与 `sessions_yield` 均在 `removedNames` 内 ⇒ 普通对话里模型**看不到** agent，
 * 只能靠"越清单直接调用"（provider 不校验工具名是否在清单内、后端按注册表解析）
 * 侥幸可用 —— 表现即"时好时坏 / 模型自述该工具不可用"。并行子代理是通用协作能力，
 * 故纳入 mandatory（模型当轮即可派发并拿到结果，不依赖 yield）。
 *
 * 注：`sessions_yield` **未**纳入（用户 2026-09-20 决策）—— 其唯一用途是"让出轮次
 * 等子代理结算"，属长流程；若模型登记了却无人结算，会话会停在 running 等待态。
 * 它仍留在全量注册表（`sessions_yield` 可被越清单调用，恢复通路已装配）。
 *
 * ⚠️ 本集是**名义集**（不区分变体）；实际过滤一律走 `getMandatoryTools()`（见下）。
 */
export const MANDATORY_TOOLS: ReadonlySet<string> = new Set([
  'todo_write',
  'agent',
]);

/**
 * mandatory 工具的**能力前置**（变体收敛，2026-10-20）：
 * 只有对应能力开关开启时，该工具才允许被"恒保留"。
 *
 * 背景：`core` 变体在 `excludeFeatures` 里排除了 `AGENT`，但恒集写死 `agent`
 * ⇒ "变体裁掉了 agent，mandatory 又把它强制可见"的自相矛盾；P1 计划移除
 * `todo_write` 时会再撞一次。故恒集改为**由能力开关过滤**，不再无条件生效。
 */
export const MANDATORY_TOOL_REQUIRES: Readonly<Record<string, FeatureFlag>> = {
  todo_write: 'TODO',
  agent: 'AGENT',
};

/**
 * 当前**生效**的恒集：能力开关关闭的工具被剔除。
 *
 * - `coding` / `personal` / `enterprise`（AGENT + TODO 皆开）⇒ `{ todo_write, agent }`（与旧行为一致）；
 * - `core`（AGENT 关）⇒ `{ todo_write }`；
 * - `core` 若再移除 `TODO` ⇒ `{}`。
 *
 * ⚠️ 判定口径只此一处；**禁止**再用 `MANDATORY_TOOLS.has()` 做过滤（那会绕开变体收敛）。
 */
export function getMandatoryTools(): ReadonlySet<string> {
  const enabled = Object.keys(MANDATORY_TOOL_REQUIRES).filter((name) =>
    feature(MANDATORY_TOOL_REQUIRES[name]!)
  );
  if (enabled.length === MANDATORY_TOOLS.size) return MANDATORY_TOOLS;
  return new Set(enabled);
}

/** 该工具在当前变体下是否为**生效**的恒保留工具 */
export function isMandatoryTool(toolName: string): boolean {
  return getMandatoryTools().has(toolName);
}

/**
 * **默认披露面白名单**（AC-16，P4，2026-10-28）—— 方案 §9「默认披露集 ≤12」的落地口径。
 *
 * ## 是什么 / 不是什么
 * - **是**：`default` / `chat`（以及未指定任务时的回退集）下，**下发给模型**的工具白名单；
 * - **不是**删除：注册面（82）、执行面、`tool_search` 检索面、`coding` / `agent` 等任务类型
 *   一律不受影响 —— 未列入者仍**注册可调用**，模型可经 `tool_search` 检索到名字后直接调用
 *   （provider 不校验工具名，后端按注册表解析）。
 *
 * ## 为什么这 12 个（取舍依据）
 * - `tool_search` **必须在列**：否则被隐藏的 38 个工具对模型**永久不可达**（检索入口本身被藏
 *   = 功能缺失，不是预算决策）；
 * - 编码/执行核心：`file_read` / `file_write` / `file_edit` / `bash` / `grep`；
 * - 协作与规划：`agent`（并行子代理）/ `todo_write`（任务卡）；
 * - 外部信息：`web_fetch` / `web_search`；
 * - 交互与扩展：`ask_user_question` / `mcp_tool`（MCP 三方工具入口）。
 *
 * ## 与"同族合并"的关系（实测结论，见方案附录 D.5）
 * 合族（`fs_query`/`fs_mutate`/…）会让**工具总数 82 → 88**（违反 AC-16「只减不增」），且
 * schema 参数面**并集不减少**（两族下界即 1,486 token，超整个 1.5k 预算）⇒ 本仓采用
 * **披露面收口**：不新增、不删除，只收窄默认可见面。
 *
 * ## 改动方式
 * 想让某个工具重新可见：把它加进本集合（会触发 `toolDisclosureBudget` 门禁的红灯，
 * 必须同步下调基线 —— 这正是"显式评审"的入口）。
 */
export const DEFAULT_DISCLOSURE_TOOLS: ReadonlySet<string> = new Set([
  'file_read',
  'file_write',
  'file_edit',
  'bash',
  'grep',
  'agent',
  'todo_write',
  'web_fetch',
  'web_search',
  'ask_user_question',
  'mcp_tool',
  'tool_search',
]);

/** 该任务类型是否套用**默认披露面白名单**（`default` / `chat` / 未指定） */
function usesDefaultDisclosure(taskType: string | undefined): boolean {
  return (
    taskType === undefined ||
    taskType === DEFAULT_TASK_KEY ||
    taskType === 'chat'
  );
}

/**
 * 该工具是否**因默认披露面白名单**而不可见（唯一判定；`filterToolsByTask` 与可见性报表同源）。
 *
 * `extraCategories` 是**显式能力声明**（带图消息的 `image`、会话 profile 的 `media`/`coding`…）
 * ⇒ 命中即**放开**白名单：否则 TG-4 / D7-L2 的"按需追加能力"会被白名单静默吃掉
 * （2026-10-28 实测：带图会话看不到 `image_analysis`、profile 声明 `coding` 也加不进 `code` 类）。
 */
export function isOutsideDefaultDisclosure(
  toolName: string,
  taskType: string | undefined,
  extraCategories: readonly ToolCategory[] = []
): boolean {
  if (!usesDefaultDisclosure(taskType)) return false;
  if (DEFAULT_DISCLOSURE_TOOLS.has(toolName)) return false;
  return !extraCategories.includes(getToolCategory(toolName));
}

// ============================================================
// 能力包（P0-2，2026-10-30）：可选能力**默认不披露**
//
// 背景：`DEFAULT_DISCLOSURE_TOOLS` 只收窄 `default`/`chat`；`coding`/`agent` 面按类别放行
// ⇒ 单轮仍下发 53/59 个工具。29 会话 32 127 次调用只用到 27/82 个工具 ⇒ 把"可选能力"
// 按包**默认关闭**（见治理方案 §4.3）。
//
// 与 AC-16 / P0-1 同口径：**只收窄下发面**，不是删除、不是注销 ——
//   · 工具仍注册、仍可执行；
//   · `tool_search` 的检索面是**全量已注册**（`ToolSearchTool`），故仍可检索到名字后按名调用；
//   · `settings.tools` 的 `on` 覆写切在 `filterToolsByTask` **之后**（`selectToolsForTurn`）
//     ⇒ 用户逐个放开优先于本层；
//   · `extraCategories`（带图消息的 `image`、会话 profile 的 `media` …）是**显式能力声明**
//     ⇒ 命中即放开（与 `isOutsideDefaultDisclosure` 同规则）。
//
// ⚠️ 只对**通用任务面**生效（`PACK_GATED_TASK_TYPES`）：`image` / `video` / `tts` 等任务类型的
// 类别白名单本身即"显式声明要这块能力"，若再被包裁掉就成了自相矛盾。
// ============================================================

/** 能力包 id（与 `FEATURE_FLAGS.TOOL_PACK_*` 一一对应） */
export type CapabilityPack =
  | 'media_image'
  | 'media_video'
  | 'media_audio'
  | 'doc_extra'
  | 'collab'
  | 'schedule'
  | 'workspace'
  | 'system_extra';

interface CapabilityPackSpec {
  /** 开关（`feature()`；默认 false ⇒ 包内工具不下发） */
  flag: FeatureFlag;
  /** 包内工具名（**真名**，非 wire 名；本包内均为无命名空间的内置名） */
  tools: readonly string[];
  /** 一句话说明（供日志 / 文档引用） */
  summary: string;
}

/**
 * 能力包 → 工具清单（**唯一映射表**）。
 *
 * 取舍依据（`dev_docs/20261030/Liri-工具与命令治理方案-20261030.md` §4.3 + 附录 B）：
 * 只收"0 调用 + 可选能力"者；**实测有调用**的工具**不入包**（`channel` `config` `monitor`
 * `pdf` `file_convert` `notebook` `trace_recording` `stat_vfs` …）—— 样本只有 1 个用户，
 * 0 调用 ≠ 无需求，故"入包"只用于**默认不可见、可一键开**者。
 */
export const CAPABILITY_PACKS: Readonly<
  Record<CapabilityPack, CapabilityPackSpec>
> = {
  media_image: {
    flag: 'TOOL_PACK_MEDIA_IMAGE',
    summary: '图像生成/分析/展示/SVG',
    tools: [
      'image',
      'image_analysis',
      'image_display',
      'image_generate',
      'image_svg_generate',
    ],
  },
  media_video: {
    flag: 'TOOL_PACK_MEDIA_VIDEO',
    summary: '视频生成/分析/展示 + 浏览器视觉',
    tools: [
      'video',
      'video_analysis',
      'video_display',
      'video_generate',
      'browser_vision',
    ],
  },
  media_audio: {
    flag: 'TOOL_PACK_MEDIA_AUDIO',
    summary: '音频播放 / 音乐 / TTS',
    tools: ['audio_play', 'music', 'tts'],
  },
  doc_extra: {
    flag: 'TOOL_PACK_DOC_EXTRA',
    summary: '文档生成（pdf / file_convert 因有实测调用不在包内）',
    tools: ['doc_generate'],
  },
  collab: {
    flag: 'TOOL_PACK_COLLAB',
    summary: '团队 / 消息 / 广播（channel 因有实测调用不在包内）',
    tools: [
      'team_create',
      'team_delete',
      'list_peers',
      'send_message',
      'broadcast',
    ],
  },
  schedule: {
    flag: 'TOOL_PACK_SCHEDULE',
    summary: '定时任务 / 睡眠 / 让出轮次',
    tools: [
      'cron_create',
      'cron_delete',
      'cron_list',
      'cron_stop',
      'sleep',
      'sleep_for',
      'sleep_until',
      'sessions_yield',
    ],
  },
  workspace: {
    flag: 'TOOL_PACK_WORKSPACE',
    summary:
      '工作树 / 看板 / 建项目 / 存会话（VFS 三件由 VFS_ENABLED 另行门控）',
    tools: [
      'enter_worktree',
      'exit_worktree',
      'kanban',
      'create_project',
      'save_conversation',
    ],
  },
  system_extra: {
    flag: 'TOOL_PACK_SYSTEM_EXTRA',
    summary: '剪贴板 / 简报 / 代理清单 / 知识写入 / MCP 认证与资源',
    tools: [
      'clipboard',
      'brief',
      'agents_list',
      'knowledge_save',
      'mcp_auth',
      'mcp_resource',
    ],
  },
};

/** 工具名 → 能力包（`CAPABILITY_PACKS` 的派生索引；同族重复登记 ⇒ 首次求值即告警） */
const TOOL_PACK_INDEX: ReadonlyMap<string, CapabilityPack> = (() => {
  const index = new Map<string, CapabilityPack>();
  const duplicated: string[] = [];
  for (const [pack, spec] of Object.entries(CAPABILITY_PACKS) as [
    CapabilityPack,
    CapabilityPackSpec,
  ][]) {
    for (const toolName of spec.tools) {
      if (index.has(toolName)) {
        duplicated.push(`${toolName}（${index.get(toolName)} / ${pack}）`);
        continue;
      }
      index.set(toolName, pack);
    }
  }
  if (duplicated.length > 0) {
    logger.warn(
      '工具被登记到多个能力包 ⇒ 仅首个生效，请修正 CAPABILITY_PACKS',
      {
        duplicated,
      }
    );
  }
  return index;
})();

/** 该工具所属能力包（不在任何包内 ⇒ `undefined`） */
export function getCapabilityPackOf(
  toolName: string
): CapabilityPack | undefined {
  return TOOL_PACK_INDEX.get(toolName);
}

/** 该能力包当前是否开启（每次现读 `feature()`：env 覆盖即时生效，与 P0-1 同口径） */
export function isCapabilityPackEnabled(pack: CapabilityPack): boolean {
  return feature(CAPABILITY_PACKS[pack].flag);
}

/**
 * 该工具是否**因所属能力包未开**而不应下发给模型。
 *
 * 纯判定（不读 taskType / extraCategories —— 由调用方叠加，见 `filterToolsByTask`）。
 */
export function isToolInDisabledCapabilityPack(toolName: string): boolean {
  const pack = TOOL_PACK_INDEX.get(toolName);
  return pack !== undefined && !isCapabilityPackEnabled(pack);
}

/**
 * 套用能力包门控的**通用任务面**（其余任务类型 = 显式声明能力 ⇒ 不裁）。
 *
 * `undefined` 视作 `default`（与 `usesDefaultDisclosure` 同口径）。
 */
export const PACK_GATED_TASK_TYPES: ReadonlySet<string> = new Set([
  'default',
  'chat',
  'coding',
  'agent',
]);

/** 该任务面是否套用能力包门控 */
function usesPackageGating(taskType: string | undefined): boolean {
  return taskType === undefined || PACK_GATED_TASK_TYPES.has(taskType);
}

/** 已告警的组合（每个 taskType 只报一次，避免每轮刷屏） */
const warnedPackTaps = new Set<string>();

/**
 * 获取任务的工具类别白名单；未配置的任务回退 default 保底集。
 */
export function getTaskToolCategories(
  taskType: string | undefined
): ToolCategory[] {
  const categories = taskType ? TASK_TOOL_CATEGORIES[taskType] : undefined;
  return categories ?? TASK_TOOL_CATEGORIES[DEFAULT_TASK_KEY];
}

/**
 * 按任务过滤工具定义（Step 3 裁剪注入点使用）。
 * 兼容 OpenAI 兼容结构（name 在顶层或 function.name）。
 * @param toolDefinitions 待过滤的工具定义列表
 * @param taskType 当前任务类型
 * @param extraCategories 额外保留的类别（如带图消息注入 'image'，使 image_analysis 对模型可见）
 * @returns 仅包含任务类别白名单内工具的列表
 */
export function filterToolsByTask<
  T extends { name?: string; function?: { name?: string } },
>(
  toolDefinitions: T[],
  taskType: string | undefined,
  extraCategories: ToolCategory[] = []
): T[] {
  const allowed = new Set(getTaskToolCategories(taskType));
  for (const c of extraCategories) allowed.add(c);
  // 变体收敛（2026-10-20）：恒保留集由能力开关过滤（如 core 不含 AGENT ⇒ agent 不再恒保留）
  const mandatory = getMandatoryTools();
  // AC-16（P4，2026-10-28）：默认披露面白名单 —— 只收窄 `default`/`chat` 的**可见面**
  /** 本次新发现（且非归档）的"未登记类别"工具 —— 用于首次告警（去重由 warnedUnregisteredTools 承担） */
  const newlyUnregistered: string[] = [];
  /** 本次首次因能力包未开而被裁的工具（去重由 warnedPackTaps 承担） */
  const newlyPackTapped: string[] = [];
  const kept = toolDefinitions.filter((t) => {
    const toolName = t.name ?? t.function?.name ?? '';
    if (mandatory.has(toolName)) return true;
    if (isOutsideDefaultDisclosure(toolName, taskType, extraCategories))
      return false;
    const category = getToolCategory(toolName);
    if (category === 'misc' && !ARCHIVED_MISC_TOOLS.has(toolName)) {
      if (!warnedUnregisteredTools.has(toolName)) {
        warnedUnregisteredTools.add(toolName);
        newlyUnregistered.push(toolName);
      }
    }
    const categoryAllowed = allowed.has(category);
    // P0-2（2026-10-30）：能力包未开 ⇒ 不下发（仍注册可执行，可经 tool_search 检索）。
    // `extraCategories` 是**显式能力声明**（带图消息的 `image`、会话 profile 的 `media`）⇒
    // 命中即放开（与 `isOutsideDefaultDisclosure` 同规则；不能只看 `allowed` —— 任务类别
    // 白名单也在其中，无法区分"任务允许"与"显式声明"）。
    if (
      categoryAllowed &&
      usesPackageGating(taskType) &&
      !extraCategories.includes(category) &&
      isToolInDisabledCapabilityPack(toolName)
    ) {
      if (!warnedPackTaps.has(toolName)) {
        warnedPackTaps.add(toolName);
        newlyPackTapped.push(toolName);
      }
      return false;
    }
    return categoryAllowed;
  });
  if (newlyPackTapped.length > 0) {
    logger.info(
      '能力包未开 ⇒ 工具本轮不下发（仍注册可调用，可经 tool_search 检索；' +
        '开关：FEATURE_TOOL_PACK_*=true）',
      { taskType: taskType ?? DEFAULT_TASK_KEY, tools: newlyPackTapped }
    );
  }
  if (newlyUnregistered.length > 0) {
    logger.warn(
      '工具未登记类别 ⇒ 落 misc ⇒ 不在任何任务白名单 ⇒ 被静默裁剪（模型永远看不到）；' +
        '请在 TOOL_CATEGORIES 显式登记（未登记的运行期工具只有此处可观测）',
      { taskType: taskType ?? DEFAULT_TASK_KEY, tools: newlyUnregistered }
    );
  }

  // P0-1（2026-10-30）：严格披露预算（`coding` / `agent` 面）—— 只收窄**下发面**，
  // 未列入者仍注册可调用（经 `tool_search` 检索），与 AC-16 的"披露 ≠ 删除"同口径。
  const budget = resolveDisclosureBudget(taskType);
  if (budget === undefined || kept.length <= budget) return kept;

  const nameOf = (t: T): string => t.name ?? t.function?.name ?? '';
  const { kept: keptNames, dropped } = trimNamesToDisclosureBudget(
    kept.map(nameOf),
    budget
  );
  if (dropped.length === 0) return kept;
  const keptSet = new Set(keptNames);
  logger.info(
    '严格披露预算：按优先级截断工具面（未列入者仍可经 tool_search 检索）',
    {
      taskType: taskType ?? DEFAULT_TASK_KEY,
      budget,
      before: kept.length,
      after: keptNames.length,
      droppedNames: dropped,
    }
  );
  return kept.filter((t) => keptSet.has(nameOf(t)));
}

/**
 * 任务类型 → **真实工具名**列表（与 `filterToolsByTask` 同口径，含 `getMandatoryTools()`）。
 *
 * 用途：需要"名字清单"而非"定义过滤"的调用方 —— 目前为 **LRTO 角色工具范围**
 * （`tasks/lro/contracts.ts` 的 `RoleConfig.taskType`）。
 *
 * ⚠️ **禁止手写工具名清单**：本仓真实注册名是 `bash` / `code_run` / `file_read` /
 * `file_write` / `file_edit` / `web_fetch` / `browser`…；历史上多处清单抄的是
 * hermes / Claude Code 的名字（`read_file` / `bash_exec` / `execute_code` / `web_extract`…）
 * ⇒ 对真实工具**永不命中**，功能静默失效（2026-10-08：LRTO 步骤工具范围即因此全错名）。
 * 派生自 `TOOL_CATEGORIES` 是唯一入口；守卫见 `tests/tools/toolNameLists.test.ts`。
 */
export function getRealToolNamesForTask(
  taskType: string | undefined
): string[] {
  const allowed = new Set(getTaskToolCategories(taskType));
  const derived = Object.entries(TOOL_CATEGORIES)
    .filter(([, category]) => allowed.has(category))
    .map(([name]) => name);
  const names = new Set([...derived, ...getMandatoryTools()]);
  // AC-16（P4）：与 `filterToolsByTask` 同源 —— 默认披露面白名单同样收窄本清单
  // （否则 LRTO 角色工具范围会比模型真实可见面更宽，形成第二套口径）。
  if (usesDefaultDisclosure(taskType)) {
    for (const name of names) {
      if (!DEFAULT_DISCLOSURE_TOOLS.has(name)) names.delete(name);
    }
  }
  // P0-2（2026-10-30）：能力包未开的工具同样从本清单剔除（同一判据，避免第二套口径）。
  if (usesPackageGating(taskType)) {
    for (const name of names) {
      if (isToolInDisabledCapabilityPack(name)) names.delete(name);
    }
  }
  // P0-1（2026-10-30）：严格披露预算同样收窄本清单（同一判据，避免第二套口径）
  const budget = resolveDisclosureBudget(taskType);
  if (budget === undefined) return [...names];
  return trimNamesToDisclosureBudget([...names], budget).kept;
}

// ============================================================
// 严格披露预算（P0-1，2026-10-30；`FEATURE_TOOL_DISCLOSURE_STRICT`，默认关）
//
// 背景（实测）：AC-16 的门禁只覆盖 `default`/`chat`；`coding` / `agent` 面没有上限，
// 真机单轮 68 个工具 / 105.2 KB schema（≈30k–42k token），而 29 个会话 32 127 次调用
// 只用到 27 个工具、前 5 个占 94%。本预算对这两类任务做**优先级截断**：
//   - 恒集（`getMandatoryTools()`）永远保留；
//   - 其余按 `STRICT_DISCLOSURE_PRIORITY` 顺序取到预算为止；
//   - 未列入者**仍注册可调用**（模型可经 `tool_search` 检索），不是删除。
// ============================================================

/** 严格披露预算：任务类型 → 最多可见工具数（只对**开启开关**时生效） */
export const STRICT_DISCLOSURE_BUDGETS: Readonly<Record<string, number>> = {
  coding: 25,
  agent: 25,
};

/**
 * 严格披露下的**保留优先级**（越靠前越先保留）。
 *
 * 排序依据（实测，见 `dev_docs/20261030/Liri-工具与命令治理方案-20261030.md` §1.2）：
 * 前 12 个与 `DEFAULT_DISCLOSURE_TOOLS` 同源；其后是编码/代理场景的高频与结构性必需
 * （`glob` 21.2% / `powershell` 3.8% / `read_project_file` 1.9% / `tool_search` 0.8% …）。
 * 未列入者一律排在最后 —— 预算吃紧时先被截断，仍可经 `tool_search` 检索到。
 */
export const STRICT_DISCLOSURE_PRIORITY: readonly string[] = [
  ...DEFAULT_DISCLOSURE_TOOLS,
  'glob',
  'powershell',
  'read_project_file',
  'write_project_file',
  'file_convert',
  'sessions',
  'sessions_yield',
  'stat_vfs',
  'notebook',
  'skill',
  'skills_list',
  'plan',
  'clipboard',
  'brief',
  'lsp',
  'code_run',
  'create_project',
  'config',
  'monitor',
];

/**
 * 当前任务类型下的严格披露预算（未开开关 / 该任务无预算 ⇒ `undefined`）。
 *
 * 单一判定入口：`filterToolsByTask` 与 `getRealToolNamesForTask` 都走这里。
 */
export function resolveDisclosureBudget(
  taskType: string | undefined
): number | undefined {
  if (!feature('TOOL_DISCLOSURE_STRICT')) return undefined;
  return STRICT_DISCLOSURE_BUDGETS[taskType ?? DEFAULT_TASK_KEY];
}

/**
 * 按预算裁剪**工具名**（纯函数，单测直接打这里）。
 *
 * 规则：
 * - 数量未超预算 ⇒ 原样返回（`dropped` 为空）；
 * - 超预算 ⇒ 恒集优先、其余按 `priority` 排名（不在名单里的排最后，按原顺序稳定）；
 * - 恒集数量本身超预算 ⇒ **恒集全留**（预算是软上限，恒集不可裁）；
 * - 返回值保持**原顺序**（provider 侧输出稳定）。
 */
export function trimNamesToDisclosureBudget(
  names: readonly string[],
  budget: number,
  options: {
    mandatory?: ReadonlySet<string>;
    priority?: readonly string[];
  } = {}
): { kept: string[]; dropped: string[] } {
  const unique = [...new Set(names)];
  if (unique.length <= budget) return { kept: unique, dropped: [] };

  const mandatory = options.mandatory ?? getMandatoryTools();
  const priority = options.priority ?? STRICT_DISCLOSURE_PRIORITY;
  const rankOf = new Map<string, number>();
  priority.forEach((n, i) => {
    if (!rankOf.has(n)) rankOf.set(n, i);
  });

  const ordered = unique
    .map((name, index) => ({
      name,
      index,
      mustKeep: mandatory.has(name) ? 0 : 1,
      rank: rankOf.get(name) ?? Number.MAX_SAFE_INTEGER,
    }))
    .sort(
      (a, b) => a.mustKeep - b.mustKeep || a.rank - b.rank || a.index - b.index
    );

  const mustKeepCount = unique.filter((n) => mandatory.has(n)).length;
  const keepCount = Math.max(budget, mustKeepCount);
  const keptSet = new Set(ordered.slice(0, keepCount).map((x) => x.name));

  return {
    kept: unique.filter((n) => keptSet.has(n)),
    dropped: unique.filter((n) => !keptSet.has(n)).sort(),
  };
}
