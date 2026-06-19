# Computer Use 功能差距分析与优化建议

## 一、当前已有功能

| 功能 | 状态 | 说明 |
|------|------|------|
| `screenshot` | ✅ | 截屏,返回 JPEG base64 图像,支持 quality 参数 |
| `mouseMove(x, y)` | ✅ | 鼠标移动到指定坐标 |
| `keyboardType(text)` | ✅ | 键盘输入文本 |
| `setClipboard(content)` | ✅ | 设置剪贴板内容 |
| `launchApp(text)` | ✅ | 启动应用程序 |
| `keyPress(key)` | ✅ | 按键(ENTER/TAB/ESC 等) |
| `mouseScroll(deltaX, deltaY)` | ✅ | 鼠标滚轮滚动 |

## 二、与 Claude Code (CC) 对比的差距分析

### 🔴 严重缺失(核心操作能力)

| 缺失功能 | 严重程度 | 影响 |
|----------|---------|------|
| **mouseClick** | 🔴 致命 | 可以移动鼠标但无法点击,相当于有"手"却"动不了",是最关键缺失 |
| **doubleClick** | 🔴 高 | 无法双击,影响文件打开等操作 |
| **rightClick** | 🔴 高 | 无法右键,无法访问上下文菜单 |

### 🟡 中度缺失(操作体验)

| 缺失功能 | 严重程度 | 影响 |
|----------|---------|------|
| **mouseDown/mouseUp** | 🟡 中 | 无法实现拖拽操作(drag & drop) |
| **keyCombination** | 🟡 中 | 无法执行 Ctrl+C/V/X、Alt+Tab 等组合键;当前 keyPress 只支持单一按键 |
| **getCursorPosition** | 🟡 中 | 无法获取当前鼠标位置,无法实现"相对于此"的操作 |
| **getScreenSize** | 🟡 低 | screenshot 返回的 width/height 为 0(bug),无法获知屏幕尺寸 |

### 🔵 缺失但可用替代方案

| 缺失功能 | 替代方案 |
|---------|---------|
| **sleep/wait** | 有独立的 `sleep` 工具可用 |
| **窗口管理** | 有 `launchApp` 可启动程序,但无法最小化/最大化/切换窗口 |

## 三、详细优化建议

### 1. 添加 mouseClick(最高优先级)

```python
# 建议新增 action: "mouseClick"
# 参数:
#   x: number (可选,点击的X坐标)
#   y: number (可选,点击的Y坐标)
#   button: enum ("left" | "right" | "middle") (可选,默认 "left")
#   clicks: number (可选,点击次数,1=单击,2=双击,默认1)

# 使用方式:
# - mouseClick() -> 在当前光标位置左键单击
# - mouseClick(x=100, y=200) -> 移动到(100,200)并左键单击
# - mouseClick(x=100, y=200, button="right") -> 右键单击
# - mouseClick(x=100, y=200, clicks=2) -> 双击
```

### 2. 添加 keyCombination(支持组合键)

```python
# 建议在 keyPress 中扩展支持组合键
# 方案A:新增 action "keyCombination"
#   参数: keys: string (如 "Ctrl+C", "Alt+Tab", "Ctrl+Shift+Esc")

# 方案B:在Press 中识别 "+" 号分隔的复合键
#   如 keyPress(key="Ctrl+C") 自动解析为按住 Ctrl 再按 C
```

### 3. 修复 screenshot 并添加 getScreenSize

```text
# 问题:screenshot 返回 width=0, height=0(应该是 bug)
# 修复方向:确保返回正确的屏幕分辨率

# 新增 getScreenSize:
#   返回当前屏幕的宽度和高度 (width, height)
#   这在计算相对坐标操作时非常必要
```

### 4. 添加鼠标状态查询功能

```python
# 新增 action: "getCursorPosition"
#   返回: { x: number, y: number }
#   用途:获知当前鼠标位置,实现"相对移动"等高级操作
```

### 5. 添加拖拽支持

```python
# 利用 mouseDown + mouseMove + mouseUp 实现
# 或新增 action: "drag"
#   参数: startX, startY, endX, endY
```

### 6. 窗口管理功能(中优先级)

```python
# 新增:
# - "windowMinimize" / "windowMaximize" 
# - "getActiveWindow" -> 获取当前活动窗口信息
# - "listWindows" -> 列出所有打开的窗口
```

## 四、实现优先级建议

| 优先级 | 功能 | 预计工作量 | 理由 |
|--------|------|-----------|------|
| P0 🔴 | mouseClick | 小 | 最基础交互,无此功能无法完成任何 GUI 操作 |
| P1 🔴 | keyCombination | 小 | 组合键是基本交互需求 |
| P1 🟡 | screenshot 修复 | 小 | width/height=0 是明显 bug |
| P2 🟡 | getCursorPosition | 中 | 让"相对于光标"的操作成为可能 |
| P2 🟡 | drag & drop | 中 | 支持文件拖拽等场景 |
| P3 🔵 | getScreenSize | 小 | 方便坐标计算 |
| P3 🔵 | 窗口管理 | 大 | 高级自动化能力 |

## 五、总结

当前 `computer_use` 已具备基本的屏幕截图、鼠标移动、键盘输入和滚轮操作能力,但 **缺少最核心的鼠标点击功能**,这导致当前的计算机使用能力实际上是"瘫痪"的——能看、能移动、能打字,但不能真正"操作"界面。

**短期修复重点:**
1. 添加 `mouseClick`(支持左/右键、单击/双击)
2.扩展 `keyPress` 支持组合键
3. 修复 `screenshot` 的尺寸信息

**中期增强方向:**
- 光标位置查询
- 拖拽操作
- 窗口管理
