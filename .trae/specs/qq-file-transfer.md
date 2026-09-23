# QQ 通道文件传输（双向）

> 状态：待评审 | 创建：2026-08-20 | 版本：v1
> 范围：QQ c2c 私聊（群消息当前 BYPASS，本 spec 不启用群，仅预留字段兼容）

## 1. 背景与目标

QQ 通道当前仅支持纯文本交互：
- **入站**：`handleC2cMessageCreate` 将所有消息视为 `text`，QQ 媒体事件携带的 `attachments[]`（CDN 下载 URL）被丢弃——用户发文件/图片 bot 无感知。
- **出站**：`QQChannel.sendFileMessage`/`sendImageMessage` 已存在但三处断链：① 本地文件用 data URI 塞 JSON `url` 字段（QQ files API 仅接受公网 URL，无效）；② `sendQQMediaMessage` 用 `msg_id: Date.now()` 假 ID（被服务端拒绝或误耗主动配额）；③ `messageRouter` 出站仅 `sendText`，文件无路由。

**目标**：
1. 入站：QQ 发文件/图片 → 下载 → FileRegistry 注册 → AI 可感知处理
2. 出站：AI 最终回复中的本地文件路径 → multipart 上传 QQ 媒体库 → 发送文件消息

## 2. 现有基础设施（复用，不新造）

| 设施 | 位置 | 说明 |
|------|------|------|
| `handleInboundFile()` | BaseChannelPlugin L466 | 入站文件注册 FileRegistry（MD5 去重/存储统一） |
| `MessageAttachment` | IChannel.ts L86 | 入站附件类型（已存在） |
| 飞书参照实现 | FeishuChannel L738-824 | 下载→注册→文本回退提示 AI 的完整模式 |
| `consumePassiveReplyFields()` | QQChannel | 被动回复 msg_id/msg_seq 配额管理（文件消息同样占用 5 条配额，需接入） |
| `sendFileMessage()` 框架 | QQChannel L836 | 上传+发送骨架（保留，重写上传实现） |

## 3. 设计

### 3.1 入站（QQ → Liri）

**payload 类型补充**（QQChannel L2035）：

```typescript
interface QQAttachment {
  content_type: number;   // 0=文本 1=图片 2=视频 3=语音 4=文件（富媒体 subtype）
  filename?: string;
  height?: number;
  width?: number;
  size?: number;
  url?: string;           // QQ CDN 临时 URL（有时效，需立即下载）
}
interface QQC2cMessageCreatePayload {
  // ...现有字段
  attachments?: QQAttachment[];
}
```

**处理流程**（`handleC2cMessageCreate`）：
1. `attachments?.length` 且含 url → 按飞书模式**立即异步下载**（CDN 时效）：
   `fetch(url)` → `handleInboundFile({ originalName: filename, content: buffer, sourceId: messageId, mimeType })`
2. content 置为提示文本（AI 可感知并可 file_read 该路径）：
   - 图片：`[用户发送了图片: ${filename}]`
   - 文件：`[用户发送了文件: ${filename} (${size}字节)，已保存，可用 file_read 读取]`
3. `messageType` 按附件类型映射 `'image' | 'file'`；无附件维持 `'text'` 原路径（零回归）

**下载失败**：content 回退 `[用户发送了附件 ${filename}，但下载失败]`，AI 可告知用户重发。不静默（CS03）。

### 3.2 出站（Liri → QQ）

**① 重写 `uploadQQFile` 本地路径 → multipart 上传**：

```
POST https://api.sgroup.qq.com/v2/users/{openid}/files
Content-Type: multipart/form-data
  file_type: 1(图片)/2(视频)/3(语音)/4(文件)
  file: <二进制>（Bun FormData + Blob，无需第三方库）
  srv_send_msg: false
→ { file_uuid }
```
公网 http(s) URL 输入保留现有 JSON 方式。file_type 依据扩展名推断（png/jpg→1，mp4→2，mp3/wav→3，其余→4）。

**② 修复 `sendQQMediaMessage` 假 msg_id**：
- 删除 `msg_id: Date.now()`，改为 `...this.consumePassiveReplyFields(target)`（与 sendTextMessage 一致：窗口内被动回复不耗主动配额，超窗降级不带 msg_id）
- 被动失败降级主动重试一次（对齐 sendTextMessage L622-632 模式）

**③ messageRouter 出站文件路由**（流结束后追加发送）：
- 最终回复 `content` 提取本地文件路径：正则匹配 Windows 绝对路径（`[A-Za-z]:\\[^\s*"'）]+`），`fs.existsSync` 过滤 + 限定 output/downloads/attachments 目录（安全：防止发送任意系统文件）+ 大小 ≤30MB
- 文本回复先发（现有 sendText 路径不变），随后逐个 `onOutbound` 发文件
- 发送结果追加日志；全部文件发送失败不影响文本已送达的事实，仅在文本后补一句"⚠️ 文件发送失败: {原因}"（QQ 权限未开通富媒体时报 QQ 返回的 message）
- 配额感知：文件消息占用被动 seq（consumePassiveReplyFields 天然管理），文本+文件总条数 ≤5 内安全（文本1 + 文件≤2 截断，超出部分改为路径列表文本告知）

**④ AttachmentDownloadDebouncer 不引入**：下载立即触发，无需新组件。

### 3.3 不做（明确排除）

- 群消息文件（群事件当前 BYPASS，仅类型层兼容）
- 频道（guild）文件发送（官方不支持，QQChannel L844 已有守卫）
- DeliverableBlockData 出站集成（死类型无生产者，不依赖）
- 视频/语音生成类工具的主动推送

## 4. 外部约束（代码无法解决，需用户侧确认）

| 约束 | 影响 | 缓解 |
|------|------|------|
| QQ 开放平台**富媒体权限**：正式环境需申请，沙箱一般可用 | 上传 API 可能 403 | 失败时回复明确原因（API 返回 message），提示用户在 QQ 开放平台申请 |
| 文件 ≤30MB / 图片 ≤10MB / 视频 ≤100MB | 超限文件无法发送 | 超限跳过并在文本中说明 |
| QQ CDN 入站 URL 时效（分钟级） | 延迟下载失败 | 立即异步下载（飞书同模式） |

## 5. 合规检查清单

- [x] CS01 归一化：复用 handleInboundFile/FileRegistry/consumePassiveReplyFields/飞书模式，无重复造轮子
- [x] CS02：无字符串状态判断（messageType 用枚举；文件路径提取是内容提取非状态判断）
- [x] CS03：下载失败/发送失败均有日志+用户可见反馈，无静默回退
- [x] CS04：零 Mock
- [x] R02：类型统一（复用 MessageAttachment；QQAttachment 仅协议层私有类型）
- [x] R03：改动收敛在 channels/qq + channels/routing，无跨层新依赖（fs/path 动态 import 与现有 uploadQQFile 一致）
- [x] R04：QQChannel.ts 现 ~2050 行（已超限预存，FSZ 例外沿用；本次净增 ~150 行登记例外更新）；messageRouter 现 1028 行（FSZ-138 已登记，净增 ~60 行内）
- [x] api-spec.md：无新 HTTP 端点（纯通道内部能力）

## 6. 验收标准

1. QQ 发图片 → AI 回复确认看到图片（FileRegistry 有记录，jsonl content 含提示文本）
2. QQ 发文档 → AI 能 file_read 并总结内容
3. client 中让 AI"把某个本地文档发给我" → QQ 收到文件消息（multipart 上传成功）
4. 无富媒体权限环境 → QQ 收到含原因的失败提示（而非静默）
5. 纯文本消息行为零回归（messageType=text 原路径）
6. typecheck + lint:arch（例外更新后）通过

## 7. 实施步骤

1. QQChannel：QQAttachment 类型 + 入站 attachments 处理（下载/注册/提示文本）
2. QQChannel：uploadQQFile multipart 重写 + sendQQMediaMessage 被动字段修复
3. messageRouter：出站文件路径提取 + 追加发送 + 失败反馈
4. layer-exceptions.json：QQChannel 行数例外更新
5. typecheck + lint:arch + QQ 实测（用户配合发文件）
