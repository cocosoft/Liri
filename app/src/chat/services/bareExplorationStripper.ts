// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * bareExplorationStripper — 裸探索段剥离（MessageContextPipeline 拆分）
 *
 * R04-001 治理：MessageContextPipeline 超 800 行，将"裸探索段剥离"抽离至此。
 *
 * 背景：模型把工具执行过程叙述（"先规划…bash 又被拦了，改用 glob…继续定位…
 * 链路基本成型…直接出报告"）未走 thinking 通道、直接泄漏进正文。
 * 实证来源：真实会话导出 chat-export-*.md。
 *
 * 职责：
 *  1. stripBareExploration — 后端落盘前剥离裸探索段（保守，宁可漏过不可错杀）
 *  2. 前端（client/src/stores/chat/chat-toolcall.slice.ts）有同语义实现，
 *     用于流结束收尾时将探索段抽离为 thinking 块，两侧规则保持一致。
 */

/**
 * 裸探索段信号正则（来自真实会话导出实证）
 * 三类信号：
 *  1. 第一人称操作开头（让我/继续/再/先…）
 *  2. 工具操作反馈（被拦/改用/读完了/确认了/找到了/路径解析…）
 *  3. 探索发现叙述（真相大白/看起来/出现了/参考目录…）
 */
const EXPLORATION_SENTENCE_PATTERNS = [
  /(?:^|[。！？；：])\s*(?:让我(?:先|再|看看|读读|查查|深入)?|我现在|接下来|下一步|继续(?:读|看|挖|深挖|定位|确认|搜索|探索|排查|把|补)|再(?:读|看|挖|深入|确认)|先(?:定位|规划|看看|系统|把|批量)|换个方式|改用|换成|逐一|逐个|批量)/,
  /(?:被拦|被拦截|改用|重试|路径解析|输出被截断|读完了|看完了|确认了|发现了|找到了|拿到了|定位到|列出来了|搜一下|命令被|证据收集完毕|更新任务状态|出(?:正式)?报告|输出报告|链路基本成型|拼图|补上|补齐|汇总新增|这轮|本轮|盲区|还没(?:读|看|碰|覆盖)|找不到|没找到|不在)/,
  /(?:真相大白|看起来|这说明|这表明|出现了|参考目录)/,
];

/** Markdown 结构行（标题/列表/引用/代码/图片）——结构行是正文标志，不作探索句处理 */
const MARKDOWN_STRUCTURE_RE =
  /^\s*(?:#{1,6}\s|\*\s|-\s|>\s|\d+\.\s|```|`|\[\[|!\[)/;

/** 按句子拆分 content，fenced code block 整体占位保护，保留换行结构 */
function splitSentencesPreservingFences(content: string): string[] {
  const FENCE_RE = /```[\s\S]*?```/g;
  const placeholders: string[] = [];
  const masked = content.replace(FENCE_RE, (m) => {
    placeholders.push(m);
    return `\u0000FENCE${placeholders.length - 1}\u0000`;
  });
  // 零宽切分：句号后 / 换行前切分（不消费分隔符，保留换行结构）
  const parts = masked.split(/(?<=[。！？；?!])|(?=\n)/);
  return parts.map((p) =>
    p.replace(/\u0000FENCE(\d+)\u0000/g, (_m, idx: string) => {
      return placeholders[Number(idx)] ?? '';
    })
  );
}

/** 判定单个句子是否为"裸探索句" */
function isBareExplorationSentence(sentence: string): boolean {
  if (!sentence?.trim()) return false;
  if (MARKDOWN_STRUCTURE_RE.test(sentence)) return false;
  return EXPLORATION_SENTENCE_PATTERNS.some((re) => re.test(sentence));
}

/**
 * 剥离"裸探索段"——模型未走 thinking 通道、直接把工具执行过程叙述泄漏进正文的文本。
 *
 * 实证来源：真实会话导出 chat-export-*.md
 *  - 整段探索叙述（"先规划…改用 glob/grep…继续定位…链路基本成型…直接出报告"）
 *  - 正文句与探索句交错（"先定位所有相关文件…读完了。你判断完全正确——…"）
 *
 * 策略（保守，宁可漏过不可错杀）：
 *  1. fenced code block 占位保护后按句子拆分
 *  2. 逐句判定探索信号（Markdown 结构行视为正文标志，不判探索）
 *  3. 剥离探索句；剥离后剩余为空 → 保留原文
 */
export function stripBareExploration(content: string): string {
  if (!content?.trim()) return content;

  const sentences = splitSentencesPreservingFences(content);
  const removed: string[] = [];
  const kept: string[] = [];
  for (const sentence of sentences) {
    if (isBareExplorationSentence(sentence)) {
      removed.push(sentence);
    } else {
      kept.push(sentence);
    }
  }

  if (removed.length === 0) return content;

  // 保护规则：剥离后剩余为空 → 保留原文（宁可漏过不可错杀，防止误删整段正文）
  const keptText = kept.join('').trim();
  if (keptText.length === 0) return content;

  return kept.join('');
}
