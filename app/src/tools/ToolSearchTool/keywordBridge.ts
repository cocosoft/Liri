// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 中文关键词 → 工具英文词元的**检索桥**（2026-11-23，会话复测 P1）。
 *
 * 现场（`session_mwrf18pu00456e0f2b`）：`doc_generate pdf image_generate` 能命中，
 * 但用户自然语言 `生成一张图片` 返回空 —— 工具名/描述以英文为主（`image_generate` 的
 * description 为英文），中文查询与英文词元之间没有任何交集 ⇒ 模型判定"没有图像工具"，
 * 换词重搜直至死循环。
 *
 * 这里维护一张**受控词表**（中文意图词 → 工具名/描述里真实出现的英文词元）：
 * - 只做"词元扩展"，不改变评分框架（扩展词仍按 name/description/searchHint 命中计分）；
 * - 扩展词一律按**可选词**参与评分，不会把某组查询变成硬性前置条件；
 * - 词表不是"工具清单"：值是通用英文词（image/generate/file…），由既有评分决定命中谁。
 *
 * 维护约定：新增中文说法时只加词表条目；若某工具名/描述里的英文词元未被覆盖，
 * 优先在词表加映射，而不是在检索算法里按工具名写分支（CS01 归一化）。
 */
const ZH_TOOL_KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  // 媒体 / 图像
  图片: ['image'],
  图像: ['image'],
  画图: ['image', 'draw'],
  绘图: ['image', 'draw'],
  生图: ['image', 'generate'],
  截图: ['screenshot', 'computer'],
  屏幕: ['screen', 'computer'],
  视频: ['video'],
  音频: ['audio'],
  音乐: ['music'],
  语音: ['voice', 'tts', 'audio'],
  朗读: ['tts', 'voice'],
  转换: ['convert'],
  压缩: ['compress'],
  二维码: ['qr'],
  // 文档 / 办公
  文档: ['doc', 'document'],
  网页: ['web'],
  网站: ['web'],
  链接: ['web', 'url'],
  pdf: ['pdf'],
  word: ['doc', 'document'],
  // 文件与读写
  文件: ['file'],
  读取: ['read'],
  打开: ['read', 'open'],
  查看: ['read', 'view'],
  写入: ['write', 'save'],
  保存: ['save', 'write'],
  编辑: ['edit'],
  修改: ['edit'],
  删除: ['delete'],
  目录: ['directory', 'glob'],
  文件夹: ['directory', 'glob'],
  // 检索 / 网络
  搜索: ['search'],
  查找: ['search', 'find'],
  检索: ['search'],
  正则: ['regex', 'grep'],
  // 执行 / 代码
  命令: ['command', 'shell'],
  终端: ['terminal', 'shell'],
  运行: ['run', 'execute'],
  执行: ['execute', 'run'],
  代码: ['code'],
  分析: ['analysis'],
  编程: ['code', 'repl'],
  // 协作 / 任务
  任务: ['task'],
  计划: ['plan'],
  规划: ['plan'],
  待办: ['todo'],
  代理: ['agent'],
  智能体: ['agent'],
  子代理: ['agent', 'subagent'],
  技能: ['skill'],
  记忆: ['memory'],
  会话: ['session'],
  消息: ['message'],
  通知: ['notify', 'message'],
  配置: ['config'],
  设置: ['config', 'settings'],
  工具: ['tool'],
  知识: ['knowledge'],
  知识库: ['knowledge'],
  浏览器: ['browser'],
  剪贴板: ['clipboard'],
  睡眠: ['sleep'],
  等待: ['wait', 'sleep'],
  定时: ['cron', 'schedule'],
  日程: ['cron', 'schedule'],
  // 通用动词
  生成: ['generate'],
  创建: ['create'],
  新建: ['create', 'new'],
  列出: ['list'],
  列表: ['list'],
  获取: ['get'],
  更新: ['update'],
  状态: ['status'],
};

/** 词表键按长度降序（长词优先，避免「知识库」只命中「知识」） */
const ZH_KEYS_BY_LENGTH: readonly string[] = Object.keys(ZH_TOOL_KEYWORDS).sort(
  (a, b) => b.length - a.length
);

const CJK = /[\u4e00-\u9fff]/;

/**
 * 把查询词里的中文意图词扩展成工具英文词元（纯函数，供门禁自证与非中文查询零影响）。
 *
 * - 仅处理含中文的词；ASCII 词原样不扩展；
 * - 一个中文词可命中多个词表键（如「生成一张图片」⇒ 生成 + 图片）；
 * - 返回值已按入参顺序去重，且**排除**已存在的原始词，避免重复计分。
 */
export function bridgeChineseTerms(terms: readonly string[]): string[] {
  const existing = new Set(terms.map((t) => t.toLowerCase()));
  const out: string[] = [];
  for (const raw of terms) {
    const term = raw.toLowerCase();
    if (!CJK.test(term)) continue;
    for (const key of ZH_KEYS_BY_LENGTH) {
      if (!term.includes(key)) continue;
      for (const mapped of ZH_TOOL_KEYWORDS[key]!) {
        const token = mapped.toLowerCase();
        if (existing.has(token)) continue;
        existing.add(token);
        out.push(token);
      }
    }
  }
  return out;
}
