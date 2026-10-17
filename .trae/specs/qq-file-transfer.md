# QQ 通道文件传输（双向）

> 状态：待评审 | 创建：2026-08-20 | 版本：**v2（2026-10-17 订正上传/发送口径）**
> 范围：QQ c2c 私聊（群消息当前 BYPASS，本 spec 不启用群，仅预留字段兼容）
>
> ⚠️ **v2 订正的由来（真机事故）**：2026-10-17 真机出现 `QQ 媒体上传失败
> {fileType:4,status:400,apiMessage:"请求参数错误"}` ⇒ 文件**永远发不出去**。取证 QQ 官方
> 「富媒体消息」（最后更新 2026-06-26）后确认：**v1 的 §3.2-①/② 两处口径与文档不符**
> （v1 写 multipart + `srv_send_msg`；实为 JSON + `url`/`file_data`），且发送用 `media.file_uuid`
> 而文档要求 **`media.file_info`** ⇒ v2 订正，并加「捕获真实请求体」的单测钉住。

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

**① 重写 `uploadQQFile`：按官方文档口径（**JSON**，不是 multipart）**：

```
POST https://api.sgroup.qq.com/v2/users/{openid}/files      # 群：/v2/groups/{group_openid}/files
Content-Type: application/json
  file_type: 1(图片)/2(视频)/3(语音)/4(文件)      # 必填
  url:      <公网 http(s) 地址>                    # 必填（远程资源走这条）
  file_data: <本地文件内容的 base64>                # 可选（本地文件走这条）
→ { file_uuid, file_info, ttl }                    # 发消息用的是 file_info
```
- **本地文件** ⇒ 读为 **base64** 放进 `file_data`（v1 的 multipart + 字段 `file` **不是**文档参数 ⇒ 真机 400）。
- **公网 URL** ⇒ 走 `url`。
- **不得**再带 v1 里那个文档没有的 `srv_send_msg`。
- `file_type` 依据扩展名推断（png/jpg→1，mp4→2，mp3/wav→3，其余→4）。
- 上传返回**必须**含 `file_info`（发消息要用）；缺失 ⇒ **不臆造**，如实报错并**不**发消息。

**② 修复 `sendQQMediaMessage`：假 msg_id + `media` 字段口径**：
- 删除 `msg_id: Date.now()`，改为 `...this.consumePassiveReplyFields(target)`（与 sendTextMessage 一致：窗口内被动回复不耗主动配额，超窗降级不带 msg_id）；被动失败降级主动重试一次
- **`media` 用 `file_info`**（v1 用的 `file_uuid` 与文档不符 ⇒ 上传修好后发送仍会失败）：`{ msg_type: 7, media: { file_info } }`
  依据：官方「富媒体消息」返回参数说明（「file_info：文件信息，**用于发消息接口的 media 字段**」）与「发送单聊消息」示例

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
| `file_data` 是 **base64**（体积 ≈ 原文 ×4/3） | 30MB 文件的请求体 ≈ 40MB（平台对请求体大小的上限**未获权威文档**） | 现状按「路径提取层 ≤30MB」守卫；若真机出现体积相关的 4xx/超时，改走官方**推荐的分片上传**（`reopenWhen` 已记） |
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
3. client 中让 AI"把某个本地文档发给我" → QQ 收到文件消息（**v2 口径**：`application/json` 上传 + `media.file_info` 发送）
4. 无富媒体权限环境 → QQ 收到含原因的失败提示（而非静默）
5. 纯文本消息行为零回归（messageType=text 原路径）
6. typecheck + lint:arch（例外更新后）通过
7. **请求体口径单测**（`app/tests/channels/qqFileTransferPayload.test.ts`，5 例，**捕获真实请求体**）：上传 `Content-Type: application/json` + `file_data`(base64)/`url`，且**无** `file` / **无** `srv_send_msg`；发送 `media.file_info` 且**无** `file_uuid`；上传 400 与「上传成功但缺 `file_info`」⇒ 如实报错且**不**发消息

> **v2 复测状态（如实）**：第 3 条（真机文件外发）**尚未复测** —— 需一次「回复正文含本地路径」的真机触发（v2 目前证据 = 协议口径对齐 + 上述单测）。
> 触发方式（已知可行）：在 QQ 里让机器人 `file_read` 某文件并把路径回显到回复里即可复现该链路。

## 7. 实施步骤

1. QQChannel：QQAttachment 类型 + 入站 attachments 处理（下载/注册/提示文本）
2. QQChannel：uploadQQFile **JSON 口径**重写（`file_data`/`url`）+ sendQQMediaMessage 被动字段与 `media.file_info` 修复
3. messageRouter：出站文件路径提取 + 追加发送 + 失败反馈
4. layer-exceptions.json：QQChannel 行数例外更新
5. typecheck + lint:arch + QQ 实测（用户配合发文件）

## 8. 变更记录

| 版本 | 日期 | 变更 | 依据 |
|---|---|---|---|
| **v2** | 2026-10-17 | ① 上传改 **JSON 口径**（本地 → `file_data` base64；远程 → `url`；**删** multipart 的 `file` 与文档没有的 `srv_send_msg`）；② 发送改 **`media.file_info`**；③ 上传缺 `file_info` ⇒ 报错且不发；④ 新增请求体口径单测 5 例 | 真机事故 `{status:400,apiMessage:"请求参数错误"}` + QQ 官方「富媒体消息」「发送单聊消息」两篇 |
| v1 | 2026-08-20 | 初版（入站附件下载/注册 + 出站路径提取与发送；上传按 multipart 假设） | 用户裁定 |
