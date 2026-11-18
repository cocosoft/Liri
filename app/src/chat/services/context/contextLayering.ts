// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// 上下文分层开关与切窗提示（2026-11-18，从 `MessageContextPipeline` 外移）
//
// 只含「本次请求要不要分层 / 要不要注入代码类强化提示」的**瞬时决策**与两段提示文案；
// 不涉及消息截断本身（见 `./contextTruncation` 与外移中的 `truncateApiMessages`）。
// 对外符号与实现逐字搬迁，行为不变。

import { configManager } from '@openliri/infra/config';

/**
 * C 阶段分层开关（P2-a，2026-09-02）：`CONTEXT_LAYERING !== 'off'` 默认开。
 * 长文档/代码库类任务（完整通读全文语义 > 分页取回体验）可会话级置 off 关闭。
 */
export function contextLayeringEnabled(): boolean {
  // 经统一出入口（R05-012）
  return configManager.env('CONTEXT_LAYERING') !== 'off';
}

/**
 * C 阶段切点提示（P2-a，2026-09-02）：切窗生效时注入到保留段首条 user 消息前缀，
 * 告知模型早期记录可通过 session_lookup 取回（对齐 get_tool_result 摘要提示先例风格）。
 * 轻量（≤80 tokens），幂等（注入发生在请求构建期临时副本上，不落盘）。
 */
export const LAYERING_HINT =
  '（提示：为控制上下文，本次请求未携带较早的对话记录；需要时可调用 session_lookup 取回原始记录。）';

/**
 * 代码/长文档会话的切窗提示（D5② 取回增强，2026-09-02）：检测到代码/文档类任务且
 * 发生切窗时注入更强提示——强调代码块/文件原文可通过 session_lookup 按区间原样取回
 * （对齐"完整通读语义 > 分页取回"场景的补偿）。
 */
export const LAYERING_HINT_CODE =
  '（提示：本次会话涉及代码/文档类任务，较早的代码块/文件内容已分层归档；session_lookup 可按原会话区间原样取回完整代码与文件，代码语义以取回原文为准。）';

/**
 * D5② 取回增强（2026-09-02）：代码/文档类任务判定（瞬时请求决策，非持久化状态）。
 *
 * 判定依据：最近一条 user 消息中的任务形态措辞（项目/代码库级操作、多文件、重构/迁移
 * 等）。说明：这是"本次请求是否走取回增强"的**瞬时决策**（对应 C-3 切点对齐同类动态
 * 决策），不用于持久化状态判断（CS02 约束的是状态标记，非此类逐请求路由决策）；后续
 * 可强化为"工具轮证据"（grep/read/glob 密集）而非纯文本启发。
 */
const CODE_CONTEXT_MARKERS = [
  '整个项目',
  '整个仓库',
  '整个代码库',
  '代码库',
  '项目结构',
  '全部文件',
  '多文件',
  '所有文件',
  '跨文件',
  '重构',
  '迁移',
  '源码',
  '代码',
  '补丁',
  'diff',
  'entire project',
  'entire repo',
  'codebase',
  'repository',
  'source code',
  'refactor',
  'migration',
];

export function isCodeContextMessage(
  messages: Array<{ role: string; content: unknown }>
): boolean {
  // 扫描全部 user 消息（任一条含代码/文档任务措辞即判定）——兼容"继续/下一步"
  // 类后续指令不含任务措辞但会话仍处代码/文档任务的场景（瞬时会话内粘性）
  for (const m of messages) {
    if (m.role !== 'user') continue;
    const content =
      typeof m.content === 'string'
        ? m.content
        : Array.isArray(m.content)
          ? JSON.stringify(m.content)
          : '';
    if (!content) continue;
    const text = content.toLowerCase();
    if (CODE_CONTEXT_MARKERS.some((k) => text.includes(k.toLowerCase()))) {
      return true;
    }
  }
  return false;
}
