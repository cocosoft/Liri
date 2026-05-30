# 添加平台渠道

> 如何让 Liri 接入新的消息平台。

---

## ChannelInterface 接口

```typescript
export interface ChannelInterface {
  name: string;
  type: string;
  enabled: boolean;
  connected: boolean;
  connect(): Promise<boolean>;
  disconnect(): Promise<void>;
  sendMessage(target: string, text: string): Promise<boolean>;
  getStatus(): Record<string, unknown>;
  homeChannelId?: string;
  supportsThreads?: boolean;
  sendThreadMessage?(target: string, threadId: string, text: string): Promise<boolean>;
}
```

---

## 创建适配器

在 `src/channels/platforms/` 下新建：

```typescript
export class NewPlatformChannel {
  readonly name: string;
  readonly type = 'newplatform';
  readonly enabled = true;

  async connect(): Promise<boolean> { /* WebSocket/HTTP 连接 */ return true; }
  async disconnect(): Promise<void> {}
  async sendMessage(target: string, text: string): Promise<boolean> { return true; }
  getStatus(): Record<string, unknown> { return { connected: this.connected }; }
}
```

---

## 注册

修改 `src/channels/platforms/index.ts` 添加导出。

---

## 参考实现

- 简单轮询 → `DingTalkChannel.ts`
- WebSocket → `QQChannel.ts`
- HTTP API → `WeComChannel.ts`
- 企业 SDK → `FeishuChannel.ts`

现有平台适配器均继承 `BasePlatformAdapter.ts`。

---

## Home Channel 与线程

```typescript
homeChannelId = 'chat_12345';
supportsThreads = true;
sendThreadMessage(target, threadId, text) { /* 线程回复 */ }
```

`ChannelRegistry.sendToHomeChannel()` / `sendThreadReply()` 自动生效。
