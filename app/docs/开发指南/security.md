# 安全体系

> Liri 拥有 6 大安全子系统，是所有代码变更必须尊重的基础设施。

---

## 一、安全子系统总览

| 子系统 | 路径 | 功能 |
|--------|------|------|
| Bash 分析 | `security/BashSecurityAnalyzer.ts` | Rust + TS 双引擎命令安全分析 |
| 运行时脱敏 | `security/redact/` | 50+ 敏感字段自动脱敏 |
| 文件保护 | `security/files/` | 17 个文件 + 9 个目录写入拦截 |
| 注入检测 | `security/injection/` | 提示注入模式检测 + Unicode 清理 |
| 权限系统 | `security/permission/` | RBAC + DLP + OAuth + 角色 |
| 审计系统 | `security/audit/` | 6 维度审计追踪 |

---

## 二、运行时日志脱敏

所有 Gateway 日志经 RedactedLogger 自动脱敏。

- **50+ 敏感字段**：`api_key`/`token`/`secret`/`password` 等自动识别
- **短 token**（<18 字符）：全遮盖为 `***`
- **长 token**：保留首 6 尾 4，中间 `...` 替代

控制开关：`REDACT_ENABLED` 环境变量。

---

## 三、文件写入保护

- **17 个精确文件路径**：系统关键配置文件
- **9 个目录前缀**：配置目录、系统目录等

`PathValidator.ts` 在每次写入/删除操作前自动检查 `isWriteProtected()`。

`Liri_WRITE_SAFE_ROOT` 环境变量可限制所有写入仅在该根目录下。

---

## 四、提示注入检测

`SystemPromptBuilder.ts` 在构建系统提示前：
1. Unicode 清理：移除不可见字符
2. 注入检测：检测注入模式
3. Critical 级别：严重注入直接抛异常

---

## 五、不可退步红线

任何代码变更不得：
1. 简化 Rust Bash 分析引擎
2. 移除或降低审计子系统覆盖范围
3. 削弱 RBAC/DLP/OAuth 权限管理
4. 减少 MCP 传输层支持种类
5. 降低 OTel 监控覆盖范围
6. 简化 BaseTool 泛型抽象级别

---

## 六、安全编码 Checklist

每 PR 前确认：
- [ ] Gateway 日志输出已通过 RedactedLogger
- [ ] 文件写入操作调用了 PathValidator
- [ ] 系统提示构建经过注入检测
- [ ] 新增工具实现了 isReadOnly/isDestructive
- [ ] 敏感配置不硬编码
- [ ] `tsc --noEmit` 零错误
