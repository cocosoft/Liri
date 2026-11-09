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
 * B2（2026-11-09）：demand（许愿式）会话的**目标意图**判定 —— 用户"只给目标"即应进入编排。
 *
 * 与 `isExecutionTaskIntent` 的分工：后者要求「帮我/我要 + 强动词」等**措辞证据**，
 * 许愿式常见写法（"做一个贪吃蛇小游戏"、"给这个项目加上登录"）往往不含这些词；
 * demand 模式下改为**排除法**：只要不是纯寒暄/致谢/确认，也不是纯知识型提问，就视为目标。
 *
 * 安全边界不在此处：单次能力请求仍由 `isCapabilityDirectIntent` 否决（调用方保留），
 * 危险工具/权限仍走各自闸门（本函数只决定"是否值得拉起编排"）。
 */
export function isDemandGoalIntent(text: string): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (trimmed.length < 2) return false;
  // 纯寒暄 / 致谢 / 确认 / 终止类短句 ⇒ 不是目标
  if (
    /^(?:你好|您好|hi|hello|嗨|在吗|谢谢|多谢|感谢|辛苦了|好的|好|ok|嗯|收到|明白|知道了|继续|暂停|停)[\s!！。.,，?？~～]*$/i.test(
      trimmed
    )
  ) {
    return false;
  }
  // 纯知识型提问（"什么是 X？"）⇒ 不是交付目标；带"做一个…?"则仍按目标处理
  if (
    /^(?:什么是|是什么|为什么|怎么理解|如何理解|介绍一下|解释一下|说说)/.test(
      trimmed
    ) &&
    /[?？]\s*$/.test(trimmed)
  ) {
    return false;
  }
  return true;
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
 * P2（2026-11-07 真机）：单次「能力直通」意图判定 —— **否决升级**用。
 *
 * 用户「看一张图 / 读一个文件 / 查一下版本」这类**单步能力请求**，本来就该由普通对话
 * 循环一次工具调用回答。把它升级成 PDCA 编排（自动建项目 + 分步 + 每步独立 TAOR）是净增
 * 成本：编排步骤的工具面固定为 file/bash/powershell，识别图片只能靠 shell 试错，每条命令
 * 一张审批卡（真机实录）。
 *
 * 判定（保守）：
 *  - 必须同时命中「只读动作词」+「单次能力对象」；
 *  - 命中任何「多步 / 产出 / 写操作」信号 ⇒ **不**直通（交回既有升级判定）。
 *
 * 语义边界：返回 true 只表示「不值得为它拉起编排」，**不**表示"必须调用某个工具"。
 * 误判代价 = 留在普通对话循环（用户仍可用 `/goal start` 显式编排），因此判定偏保守。
 */
export function isCapabilityDirectIntent(text: string): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (!trimmed) return false;

  /**
   * 多步 / 产出 / 写操作 ⇒ 天然不属于"单次能力"
   *
   * ⚠️ 写动词必须带宾语（`写一份` / `写代码` …）：裸 `写` 会把「文件里**写**了什么」这种
   * **只读**问句误判成写操作（真机复验实测，2026-11-07）。
   */
  const MULTI_STEP_OR_WRITE =
    /(?:步骤|逐步|分步|计划|批量|循环|每个|重构|实现|开发|搭建|创建|新建|编写|改写|重写|写入|写(?:一份|一个|个|段|代码|脚本|函数|程序)|修改|修正|改正|更新|补充|完善|删除|移动|重命名|安装|部署|提交|推送|生成|导出|整理|转成|转换成|测试|单测)/;
  if (MULTI_STEP_OR_WRITE.test(trimmed)) return false;

  /** 只读动作词 */
  const READ_VERB =
    /(?:识别|辨认|看看|看一下|看下|读取|读一下|读出|列出|列一下|查看|查一下|查询|分析|检查|打开|OCR|ocr)/;
  /** 单次能力对象（图片 / 单个文件 / 单条查询对象） */
  const CAPABILITY_OBJECT =
    /(?:图片|图像|照片|截图|图里|图中|这张图|那张图|文件|目录|文件夹|版本|端口|进程|环境变量|代码|报错|日志)/;

  return READ_VERB.test(trimmed) && CAPABILITY_OBJECT.test(trimmed);
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

/**
 * 自校验意图判定（2026-10-07，`.trae/specs/pattern-wiring-closure.md` §4「P1」）
 *
 * 用途：`self_verify` 编排模式的**触发信号** —— 与 `hasResearchIntent` 同款（消息意图分类，
 * 非状态判断）。词表**保守**聚焦"要求内置校验环节/质量把关"，避免与
 * `isExecutionTaskIntent` 的泛化"检查/验证"混淆（后者是"是否属执行类任务"，本函数是
 * "是否要求产出后校验"）。
 *
 * ⚠️ 生效受门控 `SELF_VERIFY_PATTERN`（**默认 false**）约束 —— 命中不等于启用。
 */
export function hasVerifyIntent(text: string): boolean {
  if (!text) return false;
  return /(?:自检|自查|自我验证|质量把关|质量校验|校验质量|逐项核对|逐条核对|验收标准|不得有误|确保无误|结果校验|输出校验|验证后再|先验证再)/.test(
    text
  );
}

/**
 * 多轮精修意图判定（2026-11-03，`.trae/specs/pattern-wiring-closure.md` §13）
 *
 * 用途：验证线路的**强度档位**信号 —— 命中 ⇒ `iterative_refine` 选中**同一 `verify` route**
 * 的 `deep` 档（更宽 `maxCycles`），即原「迭代精修」并入 `self_verify` 的档位，不新增 route。
 *
 * 词表聚焦"要求**多轮打磨**"（区别于 `hasVerifyIntent` 的"要校验"）：多轮 / 反复修改 / 迭代
 * 优化 / 精修 / 润色。命中**不改变**默认行为 —— 生效仍受 `SELF_VERIFY_PATTERN`（默认 false）门控。
 */
export function hasRefineIntent(text: string): boolean {
  if (!text) return false;
  // 2026-11-03（缺口 #6）：`多轮` 必须后接动作词才命中（否则「多轮对话」会误判为多轮打磨）
  return /(?:多轮(?:修改|打磨|优化|迭代)|反复(?:修改|打磨|调整|优化)|迭代(?:修改|打磨|优化|改进)|精修|逐轮(?:优化|改进)|润色)/.test(
    text
  );
}
