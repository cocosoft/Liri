/**
 * taskIntent.ts — 消息执行意图判定（纯函数）
 *
 * K4（2026-09-06）：统一"用户消息是否指向执行类任务"的判定。
 * 原实现内联在 ChatManager persist 回调（goal fallback）与工具集类别裁剪
 * 决策需要同一判定，提取共用避免重复 regex 漂移（CS01）。
 *
 * 注：属消息意图分类（非状态判断），regex 语义沿用 ImplicitEngine 既有模式。
 */

/**
 * 判定消息文本是否含执行类任务意图（写代码/测试/计划分步/搭建等）。
 * 命中场景示例：
 *  - "为 chatBlocks.ts 写单测并执行"（写 + 单测）
 *  - "帮我实现一个分页组件，按步骤来"（帮我实现 + 步骤）
 * 未命中：纯提问/闲聊（"什么是 PDCA？"）。
 */
export function isExecutionTaskIntent(text: string): boolean {
  if (!text) return false;
  return (
    /(?:帮我|我要|我想|给我|请)\s*(?:做|开发|规划|设计|建|创建|写|整理|实现|搭建|部署|重构|优化|改进|补|检查|验证|核查)/.test(
      text
    ) || /(?:计划|步骤|按步骤|逐步|实现计划|分步|测试|单测)/.test(text)
  );
}

/**
 * 取消息列表最后一条非空 user 文本（供工具类别裁剪等场景读"本轮用户意图"）。
 * 找不到返回空串。
 */
export function lastUserMessageText(
  messages: ReadonlyArray<Record<string, unknown>>
): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (
      m?.role === 'user' &&
      typeof m.content === 'string' &&
      m.content.trim()
    ) {
      return m.content;
    }
  }
  return '';
}

/**
 * D1（2026-09-06，方案 P1-1）：征询接受判定——用户对"要我按 PDCA 四阶段推进吗？"
 * 的回复是否为明确短肯定。
 *
 * 判定规则（保守，防误伤）：
 *  - 肯定词表（"好/行/可以/要/同意/ok/是/嗯/能"）中出现 → 候选；
 *  - 同时**排除否定/条件从句**（"但是/不过/先别/等等/再/如果/先不/不用/别"）——
 *    例如"好的，但先别建项目"不算接受。
 *  - 纯语气词如"嗯嗯/好的好的"由词表命中自然覆盖。
 * 空串/长文本（>40 字，疑似新任务而非回应）返回 false。
 */
export function isAcceptanceReply(text: string): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > 40) return false;
  const NEGATION =
    /(?:但是|不过|先别|等等|再|如果|先不|不用|别|还是算了|我自己来|我自己)/;
  if (NEGATION.test(trimmed)) return false;
  return /(?:好|行|可以|要|同意|ok|是|嗯|能|确定)/i.test(trimmed);
}

/**
 * R4（2026-09-06，走查 W5/W10）：强产出意图——"帮我/我要…做/写/开发"等明确
 * 产出型动词（造物类）。用于首条消息触发判定：首条即强产出（如"帮我做个记账软件"）
 * 允许直接升级（自动建项目 + launch）；弱动词（检查/验证/补）仍需第 2+ 轮，防"帮我
 * 检查报错"这类一次性求助被误升级。
 * 与 isExecutionTaskIntent 的关系：本函数是其第一分支的"强子集"（剔除 检查/验证/核查/
 * 补 等弱动词与纯提问），用于轮次闸放宽的判别。
 */
export function isStrongBuildIntent(text: string): boolean {
  if (!text) return false;
  return /(?:帮我|我要|我想|给我|请)\s*(?:做|开发|写|创建|实现|搭建|建|做一个|写一个|开发一个)/.test(
    text
  );
}

/**
 * P0-3（2026-09-06，Teamwork 方案 H）：研究型意图判定——候选生成 + 对抗批评的触发信号。
 * 与 isExecutionTaskIntent 同属消息意图分类（非状态判断），regex 命中表示"该任务值得
 * 多视角生成候选并由对抗批评收敛"，供 ChatManager 分流研究模式（与 feature
 * COMPETITIVE_STRATEGY 门控配合）。词表保守聚焦"多方案/权衡/系统性研究"语义，
 * 普通单答问题（"解释一下 X"）不命中，避免研究模式成本翻倍误伤日常问答。
 */
export function hasResearchIntent(text: string): boolean {
  if (!text) return false;
  return /(?:研究|调研|调查|多方案|候选方案|方案对比|方案比较|对比评估|权衡|选型|可行性|竞品分析|研究报告|文献综述|系统性地评估|综合评估)/.test(
    text
  );
}
