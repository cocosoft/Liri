// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 工具类别词表（**唯一事实源**）。
 *
 * ## 为什么单独成文件（2026-11-21）
 * `runtimeToolMeta.ts` 需要 `ToolCategory`，而 `toolCategories.ts` 又需要
 * `runtimeToolMeta.ts` 的 `getRuntimeToolMeta()`。原先是 `import type` 单向引用 ——
 * 运行期确实无环（类型被擦除），但 `madge` 仍把 `import type` 计为一条边，
 * CI 的「循环依赖 = 0」棘轮因此变红。把词表下沉到本叶子模块后：
 * `toolCategories → runtimeToolMeta → toolCategoryTypes`，无回边。
 *
 * 消费方：`toolCategories.ts`（原址再导出，既有 230+ 处引用零改动）与
 * `runtimeToolMeta.ts`。
 */

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
  | 'desktop' // 桌面自动化（截图/鼠标/键盘/窗口）—— 2026-11-21 从 misc 归档迁出
  | 'plugin' // 第三方插件工具（C3，2026-11-21；未声明类别时的安全默认 —— **可见**，与 misc 相反）
  | 'misc'; // 未分类；⚠️ **不在任何任务白名单** ⇒ 会被裁剪（新增工具必须显式登记类别，见 N-44）
