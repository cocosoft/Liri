/**
 * 已读文件锚定（2026-11-01）
 *
 * 问题（Bug 4 第三项「上下文锚定」的可落地部分）：长会话里模型会把**本会话已读过的文件**
 * 当没读过，重新 `grep`/`glob`/`file_read` 探路 —— 既费 token，也容易把已得结论推翻重来。
 *
 * 做法：只维护一份**极小的会话内台账**（路径 → 读取轮次 / 次数 / 是否已提示），在模型**再次读取
 * 同一路径**时，向下一轮注入一条纠偏（复用 `ReActToolLoop._injectRepeatCallCorrection` 的
 * 注入通道：`user` 角色 + `system` 片段，比 tool 结果更醒目）。
 *
 * 边界（刻意窄，避免副作用）：
 *   · 只认 `file_read` 且参数里带字符串 `path`；
 *   · **同一轮内的重复读不提示**（并行读取同一文件属正常）；
 *   · 每个路径**只提示一次**（`notified` 后不再打扰）；
 *   · 单条提示最多点名 3 个路径，其余以计数带过（防止提示本身撑爆上下文）。
 */

/** 读取工具名（事实源：`constants/toolNames.generated.ts` 的 `TOOL_NAMES`） */
const FILE_READ_TOOL = 'file_read';

/** 单条提示最多点名的路径数 */
const MAX_NOTICE_PATHS = 3;

/** 单个路径保留的最近轮次条数 */
const MAX_TURNS_PER_PATH = 10;

/** 已读记录 */
export interface ReadFileRecord {
  /** 文件路径（原样保存，仅用于提示文案） */
  path: string;
  /** 已读轮次（升序，最多 `MAX_TURNS_PER_PATH` 条） */
  turns: number[];
  /** 累计读取次数 */
  reads: number;
  /** 是否已注入过纠偏（每个路径只提示一次） */
  notified: boolean;
}

/** 会话级台账状态（普通对象，便于直接挂在循环状态里） */
export interface ReadFileAnchorState {
  records: Record<string, ReadFileRecord>;
}

/** 最小工具调用形状（与 `ToolCallEntry` 结构兼容） */
export interface ReadFileCallLike {
  name: string;
  input?: unknown;
}

export function createReadFileAnchorState(): ReadFileAnchorState {
  return { records: {} };
}

/** 取 `file_read` 调用的路径；非读取工具 / 参数不合法 ⇒ `null` */
function pathOf(call: ReadFileCallLike): string | null {
  if (call.name !== FILE_READ_TOOL) return null;
  const input = call.input;
  if (input === null || typeof input !== 'object') return null;
  const raw = (input as Record<string, unknown>)['path'];
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : raw;
}

/** 记录本轮读取（幂等追加；每路径保留最近 `MAX_TURNS_PER_PATH` 个轮次） */
export function recordReadCalls(
  state: ReadFileAnchorState,
  calls: readonly ReadFileCallLike[],
  turn: number
): void {
  for (const call of calls) {
    const path = pathOf(call);
    if (path === null) continue;
    const existing = state.records[path];
    if (!existing) {
      state.records[path] = {
        path,
        turns: [turn],
        reads: 1,
        notified: false,
      };
      continue;
    }
    existing.reads += 1;
    if (existing.turns[existing.turns.length - 1] !== turn) {
      existing.turns.push(turn);
      if (existing.turns.length > MAX_TURNS_PER_PATH) existing.turns.shift();
    }
  }
}

/**
 * 生成本轮的「重复读已读文件」纠偏文案；无命中返回 `null`。
 *
 * 命中条件：本轮要读的路径在本台账里**已有更早轮次**的读取记录，且该路径尚未提示过。
 * 调用本函数**不会**修改台账（记录由调用方随后 `recordReadCalls` 完成），便于测试与复用。
 */
export function buildRereadNotice(
  state: ReadFileAnchorState,
  calls: readonly ReadFileCallLike[],
  turn: number
): string | null {
  const hits: ReadFileRecord[] = [];
  const seen = new Set<string>();

  for (const call of calls) {
    const path = pathOf(call);
    if (path === null || seen.has(path)) continue;
    seen.add(path);
    const record = state.records[path];
    if (!record || record.notified) continue;
    const earlier = record.turns.filter((t) => t < turn);
    if (earlier.length === 0) continue;
    hits.push(record);
  }

  if (hits.length === 0) return null;

  const named = hits.slice(0, MAX_NOTICE_PATHS).map((r) => {
    const rounds = r.turns.filter((t) => t < turn).join('、');
    return `${r.path}（第 ${rounds} 轮已读）`;
  });
  const rest = hits.length - named.length;

  return (
    `你在本轮再次读取了本会话已读过的文件：${named.join('；')}。` +
    (rest > 0 ? `另有 ${rest} 个已读文件也被重复读取。` : '') +
    '这些内容已在上文上下文中，不要把"已读过"当成"没读过"重新探路；' +
    '若只是确认，请直接基于已有内容作答；确需更多细节请用 `file_read` 的 offset/limit 局部重读，不要重复拉全文。'
  );
}

/** 标记这些路径已提示过（避免逐轮重复注入） */
export function markNotified(
  state: ReadFileAnchorState,
  calls: readonly ReadFileCallLike[]
): void {
  for (const call of calls) {
    const path = pathOf(call);
    if (path === null) continue;
    const record = state.records[path];
    if (record) record.notified = true;
  }
}
