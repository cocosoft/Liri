# `crashes/` 归档说明（2026-09-25 数据清理）

## 归档件

| 项 | 值 |
|---|---|
| 路径 | `dev_docs/error_repairs/crashes-archive-20260925.zip` |
| SHA256 | `DE37A83F4D5C5970E1247997700FF8B07CF770BE1420DB4C692B046F1DCA5AC8` |
| 大小 | 42.7 KB（原件合计 58.7 KB） |
| 文件数 | **69** |
| 时间范围 | 2026-08-17 14:37 → 2026-09-25 01:54（UTC） |
| 解压校验 | **69/69 可恢复** ✓（已实测 `Expand-Archive` 后计数） |
| 原目录 | `~/.pyapp/data/crashes/`（清理后**剩 0 个文件**，目录保留） |

恢复方式：`Expand-Archive -Path crashes-archive-20260925.zip -DestinationPath <dir>`

## 消息分布（按 `dump.message` 归类，69 份）

| `message` | 次数 | 备注 |
|---|---|---|
| `实体未找到` | **37** | ⚠️ **最大宗**，属**独立缺陷类**（非本轮已修的中止类）—— 见台账附带发现 8 |
| `The operation timed out.` | 17 | 超时 |
| `The socket connection was closed unexpectedly...` | 7 | 连接中断 |
| `The operation was aborted.` | 3 | 中止 |
| `liri:system-abort` | 1 | 中止类；①/② 收口后**不应再产生**转储 |
| `OpenAI chat failed: Unable to connect. Is the computer able to access the url?` | 1 | 网络不可达 |
| `QQ Bot WebSocket 连接超时` | 1 | 通道侧 |
| `Stream reader cancelled via releaseLock()` | 1 | 与本轮修掉的 `reader.cancel()` 消费缺失**同源** |

## dump schema（供后续解析）

```json
{
  "timestamp": "ISO8601", "type": "unhandledRejection", "pid": 0, "platform": "win32",
  "nodeVersion": "v24.x", "uptimeMs": 0,
  "message": "...", "stack": "...", "raw": "...",
  "memory": { "rss": 0, "heapTotal": 0, "heapUsed": 0, "external": 0, "arrayBuffers": 0 },
  "argv": []
}
```

## 为什么可以删除（取证价值已保全）

1. 崩溃转储是**单次故障快照**，事后价值集中在"**消息分布**（上表）与**栈**"——两者已随 **zip + 本表**完整保留；
2. 逐份堆积 69 个文件对排查无增益，反而会干扰"**是否出现新类型故障**"的判断（噪音淹没信号）；
3. 目录本身**未被删除**（仅清空文件），后续新的崩溃转储仍会正常落盘。
