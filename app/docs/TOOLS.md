# Liri 工具帮助文档

本文档详细介绍 Liri 中所有可用的工具及其使用方法。

---

## 文件操作工具

### file_read - 读取文件内容

**描述**: 读取指定文件的内容。

**输入参数**:
- `file_path` (string, 必需): 要读取的文件路径

**使用示例**:
```javascript
// 读取单个文件
file_read({ file_path: "./src/index.ts" })

// 读取配置文件
file_read({ file_path: "./config.json" })
```

**返回**: 文件的文本内容

---

### file_write - 写入文件内容

**描述**: 将内容写入指定的文件。如果文件不存在则创建，如果存在则覆盖。

**输入参数**:
- `file_path` (string, 必需): 要写入的文件路径
- `content` (string, 必需): 要写入的内容

**使用示例**:
```javascript
// 写入文本文件
file_write({
  file_path: "./output.txt",
  content: "Hello, Liri!"
})

// 写入JSON配置
file_write({
  file_path: "./config.json",
  content: JSON.stringify({ name: "Liri" }, null, 2)
})
```

---

### FileEditTool - 编辑文件

**描述**: 对文件进行精确编辑，支持搜索替换功能。

**输入参数**:
- `file_path` (string, 必需): 要编辑的文件路径
- `search` (string, 必需): 要搜索的内容
- `replace` (string, 必需): 替换后的内容

**使用示例**:
```javascript
FileEditTool({
  file_path: "./src/index.ts",
  search: "const oldValue = 1;",
  replace: "const newValue = 2;"
})
```

---

### GlobTool - 文件模式匹配

**描述**: 根据 glob 模式查找匹配的文件。

**输入参数**:
- `pattern` (string, 必需): glob 模式（如 `**/*.ts`）
- `options` (object, 可选): 额外的匹配选项

**使用示例**:
```javascript
// 查找所有 TypeScript 文件
GlobTool({ pattern: "**/*.ts" })

// 查找 src 目录下的所有文件
GlobTool({ pattern: "src/**/*" })

// 查找配置文件
GlobTool({ pattern: "**/*.json" })
```

---

### todo_write - 待办事项管理

**描述**: 管理待办事项列表，支持创建、更新和完成待办事项。

**输入参数**:
- `operation` (string, 必需): 操作类型 (`add`, `done`, `remove`, `list`)
- `content` (string, 可选): 待办事项内容（用于 add 操作）
- `index` (number, 可选): 待办事项索引（用于 done, remove 操作）

**使用示例**:
```javascript
// 添加待办
todo_write({ operation: "add", content: "完成项目文档" })

// 标记完成
todo_write({ operation: "done", index: 0 })

// 移除待办
todo_write({ operation: "remove", index: 1 })

// 查看列表
todo_write({ operation: "list" })
```

---

## 系统命令工具

### bash - 执行 Shell 命令

**描述**: 在系统 shell 中执行命令，包含安全检查。

**输入参数**:
- `command` (string, 必需): 要执行的命令
- `timeout` (number, 可选): 超时时间（毫秒）

**使用示例**:
```javascript
// 执行简单命令
bash({ command: "ls -la" })

// 执行 npm 命令
bash({ command: "npm run build" })

// 带超时
bash({ command: "sleep 5", timeout: 10000 })
```

**安全特性**:
- 阻止危险命令
- 环境变量污染检测
- Unicode 零宽字符注入防护

---

## 网络请求工具

### web_fetch - 获取网页内容

**描述**: 从 URL 获取网页内容、API 响应或其他 HTTP 资源。

**输入参数**:
- `url` (string, 必需): 目标 URL
- `options` (object, 可选): 请求选项（method, headers, body 等）

**使用示例**:
```javascript
// 获取网页内容
web_fetch({ url: "https://example.com" })

// 获取 API 数据
web_fetch({
  url: "https://api.github.com/repos/test/repo",
  options: { headers: { "Accept": "application/json" } }
})
```

---

### web_search - 网络搜索

**描述**: 搜索网络信息，用于查找当前事件、事实、文档或任何需要最新互联网资源的主题。

**输入参数**:
- `query` (string, 必需): 搜索查询词
- `count` (number, 可选): 返回结果数量（默认 5）

**使用示例**:
```javascript
// 搜索技术文档
web_search({ query: "TypeScript handbook" })

// 搜索新闻
web_search({ query: "latest AI developments", count: 10 })
```

---

## AI/代理工具

### Agent - 创建子代理

**描述**: 创建一个专门的子代理来执行特定任务。

**输入参数**:
- `task` (string, 必需): 子代理要执行的任务描述
- `prompt` (string, 可选): 给子代理的提示词
- `model` (string, 可选): 使用的 AI 模型

**使用示例**:
```javascript
// 创建代码审查子代理
Agent({
  task: "审查这段代码并找出潜在问题",
  prompt: "使用严格的代码审查标准"
})

// 创建研究子代理
Agent({
  task: "研究 React Server Components",
  model: "your-model-id"
})
```

---

### Skill - 执行技能

**描述**: 执行一个已注册的技能。

**输入参数**:
- `name` (string, 必需): 技能名称
- `args` (object, 可选): 技能参数

**使用示例**:
```javascript
// 执行翻译技能
Skill({
  name: "translate",
  args: { text: "Hello", target: "中文" }
})

// 执行代码生成技能
Skill({
  name: "codegen",
  args: { description: "生成一个 React 组件" }
})
```

---

## 任务管理工具

### TaskCreate - 创建任务

**描述**: 在任务列表中创建新任务。

**输入参数**:
- `title` (string, 必需): 任务标题
- `description` (string, 可选): 任务描述
- `priority` (string, 可选): 优先级 (`high`, `medium`, `low`)

**使用示例**:
```javascript
TaskCreate({
  title: "完成用户认证模块",
  description: "实现 JWT 认证功能",
  priority: "high"
})
```

---

### TaskList - 列出任务

**描述**: 列出任务列表中的所有任务。

**输入参数**: 无

**使用示例**:
```javascript
TaskList({})
```

**返回**: 包含所有任务详情的列表

---

### TaskGet - 获取任务详情

**描述**: 获取特定任务的详细信息。

**输入参数**:
- `task_id` (string, 必需): 任务 ID

**使用示例**:
```javascript
TaskGet({ task_id: "task_123" })
```

---

### TaskUpdate - 更新任务

**描述**: 更新现有任务的状态或信息。

**输入参数**:
- `task_id` (string, 必需): 任务 ID
- `status` (string, 可选): 新状态 (`pending`, `in_progress`, `completed`)
- `title` (string, 可选): 新标题
- `description` (string, 可选): 新描述

**使用示例**:
```javascript
TaskUpdate({
  task_id: "task_123",
  status: "completed"
})
```

---

### task_stop - 停止任务

**描述**: 通过 ID 停止正在运行的任务。

**输入参数**:
- `task_id` (string, 必需): 要停止的任务 ID

**使用示例**:
```javascript
task_stop({ task_id: "task_123" })
```

---

## 其他工具

### grep - 文本搜索

**描述**: 在文件中搜索匹配特定模式的行。

**输入参数**:
- `pattern` (string, 必需): 要搜索的正则表达式模式
- `files` (string 或 string[], 必需): 要搜索的文件
- `options` (object, 可选): 搜索选项（ignoreCase, wholeWord 等）

**使用示例**:
```javascript
// 搜索函数调用
grep({
  pattern: "console\\.log",
  files: "**/*.ts"
})

// 搜索并忽略大小写
grep({
  pattern: "TODO",
  files: ["./src/index.ts", "./src/utils.ts"],
  options: { ignoreCase: true }
})
```

---

### ask_user_question - 用户问答

**描述**: 向用户提出多项选择题。

**输入参数**:
- `question` (string, 必需): 问题内容
- `options` (string[], 必需): 选项列表
- `multi_select` (boolean, 可选): 是否允许多选（默认 false）

**使用示例**:
```javascript
ask_user_question({
  question: "请选择您的偏好设置：",
  options: ["黑暗模式", "明亮模式", "跟随系统"],
  multi_select: false
})
```

---

### brief - 生成会话摘要

**描述**: 生成当前会话的摘要总结。

**输入参数**: 无

**使用示例**:
```javascript
brief({})
```

**返回**: 会话的简要摘要

---

### SleepTool - 延迟执行

**描述**: 延迟执行指定的时间（毫秒）。

**输入参数**:
- `duration` (number, 必需): 延迟时间（毫秒）

**使用示例**:
```javascript
// 延迟 2 秒
SleepTool({ duration: 2000 })

// 延迟 5 秒
SleepTool({ duration: 5000 })
```

---

### MonitorTool - 系统监控

**描述**: 监控系统状态和性能指标。

**输入参数**: 无

**使用示例**:
```javascript
MonitorTool({})
```

**返回**: 系统监控信息和性能指标

---

### ComputerUseTool - 桌面自动化

**描述**: 控制桌面操作系统执行截图、鼠标操作、键盘输入、剪贴板访问和窗口管理。跨平台支持 Windows、macOS 和 Linux。

**输入参数**:
- `action` (string, 必需): 操作类型，可选值：
  - `screenshot` - 全屏截图
  - `mouseMove` - 移动鼠标（需 x, y）
  - `mouseClick` - 鼠标点击（可选 x, y, button）
  - `mouseDoubleClick` - 鼠标双击（可选 x, y）
  - `mouseRightClick` - 鼠标右键（可选 x, y）
  - `mouseScroll` - 滚轮滚动（需 deltaX, deltaY）
  - `getMousePos` - 获取鼠标位置
  - `keyboardType` - 键盘输入（需 text）
  - `keyPress` - 按键（需 key）
  - `keyCombination` - 组合键（需 key，如 `ctrl+c`）
  - `mouseDown` - 鼠标按下（可选 button）
  - `mouseUp` - 鼠标释放（可选 button）
  - `drag` - 拖拽（需 startX, startY, x, y）
  - `zoom` - 区域截图（需 x, y, deltaX, deltaY）
  - `getClipboard` - 读取剪贴板
  - `setClipboard` - 写入剪贴板（需 text）
  - `getWindows` - 获取窗口列表
  - `getFrontmostWindow` - 获取前台窗口
  - `getDisplaySize` - 获取主显示器尺寸
  - `getAllDisplays` - 获取所有显示器信息
  - `launchApp` - 启动应用（需 text）
  - `keyHold` - 长按按键（需 key, durationMs）
- `x` (number, 可选): X 坐标
- `y` (number, 可选): Y 坐标
- `startX` (number, 可选): 拖拽起始 X
- `startY` (number, 可选): 拖拽起始 Y
- `text` (string, 可选): 文本内容
- `key` (string, 可选): 按键名或组合键表达式
- `button` (string, 可选): 鼠标按钮 `left` / `right` / `middle`（默认 `left`）
- `deltaX` (number, 可选): 水平滚动量或区域宽度
- `deltaY` (number, 可选): 垂直滚动量或区域高度
- `quality` (number, 可选): 截图质量 0-1（默认 0.75）
- `durationMs` (number, 可选): 按键保持时长（毫秒）

**使用示例**:
```javascript
// 截图
computer_use({ action: "screenshot" })

// 移动鼠标并点击
computer_use({ action: "mouseClick", x: 500, y: 300 })

// 键盘输入
computer_use({ action: "keyboardType", text: "Hello, Liri!" })

// 组合键
computer_use({ action: "keyCombination", key: "ctrl+c" })
```

**平台要求与注意事项**:

| 平台 | 依赖 | 备注 |
|------|------|------|
| Windows | PowerShell（内置） | 无需额外安装 |
| macOS | 系统内置工具 | 需授权屏幕录制和辅助功能权限 |
| Linux | xdotool, xclip, imagemagick, wmctrl | 仅支持 X11 会话 |

详细说明请参阅 [工具参考/computer-use.md](docs/工具参考/computer-use.md)。

---

## 工具使用技巧

### 1. 组合使用工具

多个工具可以组合使用来完成复杂任务：

```javascript
// 示例：读取文件、搜索内容、创建任务
[
  file_read({ file_path: "./src/index.ts" }),
  grep({ pattern: "TODO", files: "**/*.ts" }),
  TaskCreate({ title: "处理 TODO 事项" })
]
```

### 2. 错误处理

工具执行可能失败，建议进行错误处理：

```javascript
try {
  const content = await file_read({ file_path: "./data.json" });
  // 处理内容
} catch (error) {
  console.error("读取文件失败:", error.message);
}
```

### 3. 异步执行

部分工具支持异步执行和进度回调：

```javascript
bash({
  command: "npm run build",
  onProgress: (data) => console.log("进度:", data)
})
```

---

**文档版本**: v1.0
**最后更新**: 2026-05-04