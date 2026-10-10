/**
 * ToolResultPersister — 工具结果二级防御（落盘路径引用 + 单轮聚合 spill）
 *
 * 对标 hermes `tools/tool_result_storage.py` 的三级防御：
 *   一级：工具内 cap（maxResultSizeChars，已有）
 *   二级：单条超限结果落盘 `~/.pyapp/data/tool-results/{toolCallId}.txt`，
 *         上下文替换为 preview + 路径引用（模型可 read_file 读全量）
 *   三级：单轮全部结果聚合超预算（TURN_BUDGET_CHARS）→ spill 未持久化结果
 *
 * 背景（2026-08-31）：历史 822KB 工具结果直接全量进上下文引发 OOM；
 * 原实现（ChatManager._buildToolRoundMessages）对工具结果 JSON.stringify 无截断。
 */
import { resolveDataSubDir } from '@modules/core/paths';
import { getLogger } from '@modules/monitoring';
import {
  findStructuralCut,
  closeStructure,
  inferFenceLang,
} from '@modules/utils/structureCut';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

const logger = getLogger('tools:toolResultPersister');

/** 单条工具结果字符预算（超过则落盘，上下文只留 preview + 路径引用） */
export const SINGLE_RESULT_LIMIT_CHARS = 50_000;
/** 单轮全部工具结果聚合预算（合计超限则 spill 未持久化结果） */
export const TURN_BUDGET_CHARS = 200_000;
/** 上下文内 preview 保留长度 */
export const PREVIEW_CHARS = 8_000;

/** 落盘目录名（resolveDataSubDir 挂 ~/.pyapp/data/ 下） */
const TOOL_RESULTS_DIR = 'tool-results';

/** 生成路径引用替换文本 */
export function buildPathRefNotice(path: string): string {
  return `\n\n[工具结果超出上下文预算，完整内容已保存到 ${path}；如需查看可用 read_file 工具读取该路径]`;
}

/**
 * R18-B：**安全预览** —— 大工具结果被替换为预览时，避免"字符级硬切"把**代码行 / Markdown 围栏**
 * 截成残缺（= 语法盲截断，外部 §6.3 之关切在本仓的**真实落点**）。
 *
 * 策略（只在末尾回退/追加，**不改动**已保留正文）：
 *   ① 切点经**结构感知**求解（`findStructuralCut`：括号净深度 0 且不在未闭合围栏内）——
 *      优先空行/块边界，其次行边界，结构无安全点时退回既有"行边界优先"口径；
 *   ② 若预览内 ``` 围栏数为**奇数**（截在围栏内）⇒ 补一行 ``` 收尾，防 Markdown 吞掉后续引用文案。
 *
 * P0（2026-10-10）：切点从"仅行/块边界"升级为"括号 + 围栏感知"，**默认不劣化**既有行为
 * （结构无安全点时退回原口径）；"补齐闭括号后缀"属 P1。
 */
export function buildSafePreview(text: string, limit = PREVIEW_CHARS): string {
  if (text.length <= limit) return text;
  const cut = findStructuralCut(text, limit);
  let preview = text.slice(0, cut);
  // P1（2026-10-10）：**结构闭合后缀** —— 原生 `py_close_structure` 可用时，为未配对括号补齐
  // 闭括号（`}`/`]`/`)`），使预览在语法上闭环。原生不可用 ⇒ 降级 P0（**不追加**，零行为变更）。
  const closure = closeStructure(preview, inferFenceLang(preview));
  if (closure && !closure.balanced && closure.closureSuffix) {
    preview += closure.closureSuffix;
  }
  const fences = (preview.match(/```/g) ?? []).length;
  if (fences % 2 === 1) preview += '\n```';
  return preview;
}

/** 引用文案特征（幂等判定：已改写过的内容不再处理） */
const PATH_REF_MARKER = '[工具结果超出上下文预算';

/**
 * T2 / D-236（2026-10-02）：**持久化侧同口径改写**（spec `.trae/specs/tool-result-persistence-limit.md` §3.1）。
 *
 * 背景（实测）：限额此前**只在上下文侧**生效，而持久化用的是**改写前的对象** —— 样本会话
 * `messages.jsonl` 达 30.43MB（单条 `tool_result` ≈14MB），而同一 `toolCallId` 的全量已落盘
 * （spec §1.3 判定为 (a) 顺序/对象问题，非旁路）。
 *
 * 语义：令持久化与上下文**同阈值、同文案** —— 载荷文本 `> SINGLE_RESULT_LIMIT_CHARS` ⇒ 全量落盘
 * （复用 `persistToolResult`，路径与上下文侧一致）+ 内容替换为 `PREVIEW_CHARS` + `buildPathRefNotice()`。
 * **幂等**：已含引用文案者跳过；`≤ 阈值` 者原样返回（零开销）；**非 JSON 结构者不动**（无法安全改写）。
 *
 * ⚠️ 形态订正（2026-10-02，D-240）：工具结果消息的 `content` 在生产是 **`ContentBlock[]`**
 * （`MessageService.createToolResultMessage` 构造 `[{type:'tool_result', value, toolCallId}]`），
 * 而本函数与调用方门禁此前都要求 `string` ⇒ 生产链路**整体未生效**（T2 目标未达成；
 * 其验证用的是合成字符串消息，形态与生产不符）。现同时接受
 * **字符串**（历史 / JSONL 形态 = `JSON.stringify(blocks)`）与 **数组**（内存活形态）。
 *
 * ⚠️ 载荷口径订正：块内 `value` 实为 `JSON.stringify(payload)`（字符串载荷含引号/转义），
 * 故**先还原为可读文本**再比阈值 / 落盘 / 取预览 —— 与上下文侧 `extractResultText()` 同口径；
 * 原实现直接对含引号的 JSON 文本切片，预览会以引号开头、落盘内容也与上下文侧不一致。
 */
export async function shrinkToolResultMessageForPersistence(
  message: {
    id?: string;
    type?: string;
    /** 工具调用 id（`Message.toolCallId`）—— 优先用于落盘文件名，与上下文侧同名同物 */
    toolCallId?: string;
    content?: string | unknown;
    metadata?: { toolCallId?: string };
  },
  /**
   * D-238 第 1 条（2026-10-04）：**单轮聚合窗口**。
   *
   * 上下文侧按"工具轮"聚合（`prepareToolResultsForContext`，`TURN_BUDGET_CHARS`），而持久化在
   * 工具轮内**逐条发生**（`ReActToolLoop:1684`，早于该聚合）⇒ 持久化侧拿不到轮总量 ⇒
   * "多块合计超限但单块不超限"者不被改写。此参数传入**由调用方按会话维护的累计器**
   * （跨本用户轮累加），使本函数在累计超 `TURN_BUDGET_CHARS` 时对后续大块**强制 spill**。
   *
   * 未传入 ⇒ 与历史行为**逐字段一致**（零回归）。
   */
  options?: { turnAcc?: { chars: number } }
): Promise<{
  content: string | unknown;
  changed: boolean;
  /** 落盘路径（与上下文侧 `metadata.toolResultPath` 同字段，供下游检索全量） */
  toolResultPath?: string;
  /** 落盘前的**载荷文本**长度（与上下文侧 `metadata.toolResultFullChars` 同口径） */
  toolResultFullChars?: number;
}> {
  const raw = message.content;
  const isString = typeof raw === 'string';
  if (!isString && !Array.isArray(raw)) return { content: raw, changed: false };
  // 有 turnAcc 时不做"整串 ≤ 阈值即返回"的提前退出——该判定只看单条，会漏掉"轮内累计超限"。
  if (isString && !options?.turnAcc) {
    const text = raw as string;
    // 字符串形态下信封长度 ≥ 载荷长度 ⇒ 提前零开销返回是安全的
    if (
      text.length <= SINGLE_RESULT_LIMIT_CHARS ||
      text.includes(PATH_REF_MARKER)
    ) {
      return { content: raw, changed: false };
    }
  }
  let blocks: unknown[];
  if (isString) {
    try {
      const parsed: unknown = JSON.parse(raw as string);
      if (!Array.isArray(parsed)) return { content: raw, changed: false };
      blocks = parsed;
    } catch {
      return { content: raw, changed: false };
    }
  } else {
    blocks = raw as unknown[];
  }

  // 文件名口径：`Message.toolCallId`（生产实况，由 `createToolResultMessage` 设置）
  // ＞ metadata ＞ 消息 id —— 与上下文侧 `normalizedToolCall.id` **同名同物**，
  // 保证同一结果只有一个落盘文件（否则上下文侧与持久化侧会各写一份）。
  const toolCallId =
    message.toolCallId ??
    message.metadata?.toolCallId ??
    message.id ??
    'unknown';
  let changed = false;
  let toolResultPath: string | undefined;
  let toolResultFullChars: number | undefined;
  const out = await Promise.all(
    blocks.map(async (b) => {
      const blk = b as { type?: string; value?: unknown };
      if (blk?.type !== 'tool_result' || typeof blk.value !== 'string')
        return b;
      const payload = decodeBlockValue(blk.value);
      if (payload.includes(PATH_REF_MARKER)) return b;
      // D-238 第 1 条（2026-10-04）：单轮聚合 —— 累计本轮工具结果载荷；超 TURN_BUDGET_CHARS 后
      // 对本块也强制 spill（与上下文侧 prepareToolResultsForContext 同预算、同文案）。
      const turnAcc = options?.turnAcc;
      if (turnAcc) turnAcc.chars += payload.length;
      const overTurn = (turnAcc?.chars ?? 0) > TURN_BUDGET_CHARS;
      if (payload.length <= SINGLE_RESULT_LIMIT_CHARS && !overTurn) return b;
      // 过小载荷外置得不偿失（引用文案本身更长）⇒ 跳过；避免"轮超限后连小结果也外置"
      if (payload.length <= PREVIEW_CHARS) return b;
      // 落盘幂等：路径由 toolCallId 决定，与上下文侧一致（重复写同内容）
      const path = await persistToolResult(toolCallId, payload);
      changed = true;
      toolResultPath = path;
      toolResultFullChars = payload.length;
      return {
        ...blk,
        value: buildSafePreview(payload) + buildPathRefNotice(path),
      };
    })
  );
  if (!changed) return { content: raw, changed: false };
  return {
    content: isString ? JSON.stringify(out) : out,
    changed: true,
    toolResultPath,
    toolResultFullChars,
  };
}

/**
 * 取出块内载荷的**可读文本**。
 *
 * `createToolResultMessage` 写入的是 `JSON.stringify(toolResult.result)` —— 当载荷是**字符串**时
 * 会被包一层引号并转义；直接切片会把引号当正文，且落盘内容与上下文侧（`extractResultText`）
 * 不一致。此处在形如 JSON 字符串时还原；对象载荷（`{…}`）本就可读，原样返回。
 */
function decodeBlockValue(value: string): string {
  if (!value.startsWith('"')) return value;
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === 'string' ? parsed : value;
  } catch {
    return value;
  }
}

/** 工具结果落盘路径（toolCallId 做安全化，防路径注入） */
export function toolResultPath(toolCallId: string): string {
  const safe = toolCallId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return join(resolveDataSubDir(TOOL_RESULTS_DIR), `${safe}.txt`);
}

/** 将完整工具结果写入落盘，返回路径 */
export async function persistToolResult(
  toolCallId: string,
  content: string
): Promise<string> {
  const dir = resolveDataSubDir(TOOL_RESULTS_DIR);
  await mkdir(dir, { recursive: true });
  const path = toolResultPath(toolCallId);
  await writeFile(path, content, 'utf8');
  logger.info('tool_result:persisted', {
    toolCallId,
    chars: content.length,
    path,
  });
  return path;
}

/**
 * **chat 域**工具结果最小结构 —— 载荷字段是 **`result`**（与 tools 域的 `data` 区分）。
 *
 * 事实源：`ToolExecutionService._executeInternal` 的
 * `{ toolCallId, toolName, result: toolResult.data, error, metadata }`。
 */
export interface ChatDomainToolResult {
  result?: unknown;
  error?: string;
  metadata?: Record<string, unknown>;
}

/**
 * 提取工具结果的可序列化文本（与 `_buildToolRoundMessages` / `createToolResultMessage` 同字段）。
 *
 * ⚠️ 契约订正（2026-10-02，D-239）：入参是 **chat 域**结果对象，载荷在 **`result`**。
 * B2-c（2026-09-30）曾把此处读侧「收口为 `data`」（tools 域字段），但本函数**唯一调用方是 chat 域**
 * （`ReActToolLoop` 的 `processedResults`）且 tools 域并无调用 ⇒ 恒取 `undefined`、退化为 `'{}'`，
 * 单条/单轮预算永不触发 ⇒ 二级/三级防御**整体空转**（实测：51,000 字符 chat 形态结果零替换）。
 */
function extractResultText(result: ChatDomainToolResult): string {
  const payload = result.result;
  if (typeof payload === 'string') return payload;
  if (payload !== undefined) return JSON.stringify(payload);
  if (result.error) return result.error;
  return '{}';
}

/**
 * 工具结果入上下文预处理（二级 + 三级防御）。
 * 就地替换 processedResults 中每个 result 为"preview + 路径引用"版本，
 * 并将完整内容落盘（metadata 保留 toolResultPath 供调试/前端）。
 */
export async function prepareToolResultsForContext(
  processedResults: Array<{
    normalizedToolCall: { id: string; name: string };
    result: ChatDomainToolResult;
  }>
): Promise<void> {
  if (processedResults.length === 0) return;

  // 先提取文本与长度，统计单轮聚合
  const items = processedResults.map((pr) => {
    const content = extractResultText(pr.result);
    return { pr, content, len: content.length };
  });
  const turnTotal = items.reduce((s, c) => s + c.len, 0);
  const needsTurnSpill = turnTotal > TURN_BUDGET_CHARS;

  // 超限 spill 时从最大的开始（hermes 语义），减少上下文膨胀
  const overItems = items
    .filter((c) => c.len > SINGLE_RESULT_LIMIT_CHARS || needsTurnSpill)
    .sort((a, b) => b.len - a.len);

  for (const item of overItems) {
    const toolCallId = item.pr.normalizedToolCall.id;
    try {
      const path = await persistToolResult(toolCallId, item.content);
      const preview = buildSafePreview(item.content);
      const notice = buildPathRefNotice(path);
      item.pr.result = {
        ...item.pr.result,
        // D-239（2026-10-02）：溢出替换写回**实际调用方契约字段 `result`**
        //（与读取、送模型 `_buildToolRoundMessages`、落盘消息构造 `createToolResultMessage` 同字段）；
        // 原写 `data`（tools 域）在 chat 域**无人读取** ⇒ 替换等于没做。
        result: preview + notice,
        metadata: {
          ...(item.pr.result.metadata ?? {}),
          toolResultPath: path,
          toolResultFullChars: item.len,
        },
      };
      logger.info('tool_result:context_replaced', {
        toolCallId,
        toolName: item.pr.normalizedToolCall.name,
        fullChars: item.len,
        previewChars: preview.length,
        reason:
          item.len > SINGLE_RESULT_LIMIT_CHARS
            ? 'single_budget'
            : 'turn_budget',
      });
    } catch (e) {
      // 落盘失败不阻断工具轮（保留原结果，仅记录）——CS03 回退最小化：落盘是本机 IO，
      // 失败概率极低，失败时保留原文进上下文
      logger.warn('tool_result:persist_failed', {
        toolCallId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
}
