# 事件驱动的自动化

## 概述

PY_APP 支持通过事件触发自动化操作，实现"当...时，执行..."的自动化规则。

## 配置

```bash
# 添加自动化规则
/hook add "当收到包含'紧急'的消息时，通知所有渠道"

# 查看规则
/hook list

# 删除规则
/hook remove <id>
```

## 触发器

| 事件 | 说明 |
|------|------|
| `message:received` | 收到消息 |
| `tool:executed` | 工具执行完成 |
| `session:created` | 会话创建 |
| `error:occurred` | 发生错误 |
| `schedule:cron` | 定时触发 |
| `webhook:received` | Webhook 接收 |

## 动作

| 动作 | 说明 |
|------|------|
| `notify` | 发送通知 |
| `log` | 记录日志 |
| `execute` | 执行命令 |
| `webhook` | 调用 Webhook |

## 规则配置

```json
{
  "hooks": [
    {
      "name": "紧急消息通知",
      "trigger": {
        "event": "message:received",
        "condition": "message.content.includes('紧急')"
      },
      "action": {
        "type": "notify",
        "channels": ["discord", "slack"]
      }
    }
  ]
}
```
