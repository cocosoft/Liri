/**
 * 已读/已检索目标锚定（2026-11-01，P1-3 扩展于 2026-11-05）
 *
 * 问题（Bug 4 第三项「上下文锚定」的可落地部分）：长会话里模型会把**本会话已查过的目标**
 * 当没查过，重新 `file_read` / `glob` / `grep` 探路 —— 既费 token，也容易把已得结论推翻重来。
 * 实测（2026-11-05 盯盘）：183 次 `repeated-call`、120 个不同目标；其中 `glob **\/*`
 * 同路径重复最突出，而原实现**只覆盖 `file_read`** ⇒ 检索类重复无人纠正。
 *
 * 做法：只维护一份**极小的会话内台账**（目标 → 访问轮次 / 次数 / 是否已提示），在模型**再次访问
 * 同一目标**时，向下一轮注入一条纠偏（复用 `ReActToolLoop._injectRepeatCallCorrection` 的
 * 注入通道：`user` 角色 + `system` 片段，比 tool 结果更醒目）。
 *
 * 边界（刻意窄，避免副作用）：
 *   · 只认读取/检索类工具（`file_read` / `read_project_file` / `glob` / `grep`）；
 *   · 检索类目标的键 = **路径 + 模式**（同路径不同模式属正常探查，不提示）；
 *   · **同一轮内的重复访问不提示**（并行读取同一文件属正常）；
 *   · 每个目标**只提示一次**（`notified` 后不再打扰）；
 *   · 单条提示最多点名 3 个目标，其余以计数带过（防止提示本身撑爆上下文）。
 */

/** 单个目标保留的最近轮次条数 */
const MAX_TURNS_PER_PATH = 10;

/** 单条提示最多点名的目标数 */
const MAX_NOTICE_PATHS = 3;

/**
 * 读取/检索类工具的取键口径。
 *
 * `path` 必填；`pattern` 存在时键 = `路径 + 模式`（同路径不同模式的检索不算重复）。
 */
const TARGET_TOOLS: Record<
  string,
  { path: string; pattern?: string; verb: '读取' | '检索' }
> = {
  file_read: { path: 'path', verb: '读取' },
  read_project_file: { path: 'path', verb: '读取' },
  glob: { path: 'path', pattern: 'pattern', verb: '检索' },
  grep: { path: 'path', pattern: 'pattern', verb: '检索' },
};

/** 已访问目标记录 */
export interface ReadFileRecord {
  /** 台账键：读取类 = 路径；检索类 = `路径::模式` */
  key: string;
  /** 提示文案里展示的目标（读取类 = 路径；检索类 = `glob(模式) @ 路径`） */
  display: string;
  /** 动作词（`读取` / `检索`），用于提示措辞 */
  verb: '读取' | '检索';
  /** 已访问轮次（升序，最多 `MAX_TURNS_PER_PATH` 条） */
  turns: number[];
  /** 累计访问次数 */
  reads: number;
  /** 是否已注入过纠偏（每个目标只提示一次） */
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

/** 解析一次调用对应的「目标」；非读取/检索类工具、参数不合法 ⇒ `null` */
function targetOf(call: ReadFileCallLike): {
  key: string;
  display: string;
  verb: '读取' | '检索';
} | null {
  const spec = TARGET_TOOLS[call.name];
  if (!spec) return null;
  const input = call.input;
  if (input === null || typeof input !== 'object') return null;
  const obj = input as Record<string, unknown>;

  const rawPath = obj[spec.path];
  if (typeof rawPath !== 'string' || rawPath.trim() === '') return null;

  if (!spec.pattern) {
    return { key: rawPath, display: rawPath, verb: spec.verb };
  }
  const rawPattern = obj[spec.pattern];
  if (typeof rawPattern !== 'string' || rawPattern.trim() === '') return null;
  return {
    key: `${rawPath}::${rawPattern}`,
    display: `${call.name}(${rawPattern}) @ ${rawPath}`,
    verb: spec.verb,
  };
}

/** 记录本轮访问（幂等追加；每目标保留最近 `MAX_TURNS_PER_PATH` 个轮次） */
export function recordReadCalls(
  state: ReadFileAnchorState,
  calls: readonly ReadFileCallLike[],
  turn: number
): void {
  for (const call of calls) {
    const target = targetOf(call);
    if (target === null) continue;
    const existing = state.records[target.key];
    if (!existing) {
      state.records[target.key] = {
        key: target.key,
        display: target.display,
        verb: target.verb,
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
 * 生成本轮的「重复访问已查目标」纠偏文案；无命中返回 `null`。
 *
 * 命中条件：本轮要访问的目标在本台账里**已有更早轮次**的记录，且该目标尚未提示过。
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
    const target = targetOf(call);
    if (target === null || seen.has(target.key)) continue;
    seen.add(target.key);
    const record = state.records[target.key];
    if (!record || record.notified) continue;
    const earlier = record.turns.filter((t) => t < turn);
    if (earlier.length === 0) continue;
    hits.push(record);
  }

  if (hits.length === 0) return null;

  const named = hits.slice(0, MAX_NOTICE_PATHS).map((r) => {
    const rounds = r.turns.filter((t) => t < turn).join('、');
    return `${r.display}（第 ${rounds} 轮已${r.verb}）`;
  });
  const rest = hits.length - named.length;

  return (
    `你在本轮重复访问了本会话已查过的目标：${named.join('；')}。` +
    (rest > 0 ? `另有 ${rest} 个已查目标也被重复访问。` : '') +
    '这些内容已在上文上下文中，不要把"已查过"当成"没查过"重新探路；' +
    '若只是确认，请直接基于已有内容作答；确需更多细节请用 `file_read` 的 offset/limit 局部重读，' +
    '或改用更窄的检索模式，不要重复拉全文/重复同一检索。'
  );
}

/** 标记这些目标已提示过（避免逐轮重复注入） */
export function markNotified(
  state: ReadFileAnchorState,
  calls: readonly ReadFileCallLike[]
): void {
  for (const call of calls) {
    const target = targetOf(call);
    if (target === null) continue;
    const record = state.records[target.key];
    if (record) record.notified = true;
  }
}
