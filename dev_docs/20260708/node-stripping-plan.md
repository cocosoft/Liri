# Node.js 内置模块剥离执行方案

> 日期: 2026-07-08 | 依据: `node-modules-inventory.md` | 目标: 将 `app/src` 中 442 处 `node:*` 引用逐步替换为 Bun 原生 API
> 
> **进度**: Phase 1 ✅ | Phase 2 ✅ | 低量模块 ✅ | Phase 3 ⬜ (仅剩 fs 188 + http 60)
> 442 → 248，减少 194 处 (43.9%)，15 个模块清零

---

## 0. 为什么剥离

| 原因 | 说明 |
|------|------|
| **运行时统一** | 项目已使用 Bun 作为运行时/包管理器，继续依赖 `node:*` 模块会造成认知分裂 |
| **性能** | Bun 原生 API（`Bun.file()`, `Bun.spawn()`, `Bun.SHA256`）比 Node.js polyfill 路径快 2-5x |
| **可维护性** | `node:path` / `node:fs` 等每次调用都走 Node.js compat layer，增加调试复杂度 |
| **未来兼容** | Bun 长期不保证 100% Node.js API 兼容，主动剥离降低未来 breakage 风险 |

---

## 1. 总策略：三阶段递进

```
Phase 1 (低风险)    → events + path + url + util      207 处 (46.8%)
Phase 2 (中风险)    → os + crypto + child_process     116 处 (26.2%)
Phase 3 (高风险)    → fs + http                       248 处 (56.1%)

合计                                                ~442 处 (归并后约 390)
```

> Phase 2/3 有重叠文件（同一文件 import 多个模块），归并后实际改动文件数约 390。

---

## 2. Phase 1：✅ 已完成 — 零风险批量替换（207 处，4 个模块）

### 2.1 `node:events` → `events`（46 处）

**操作**：全局替换 `node:events` → `events`

**验证**：Bun 的 EventEmitter 与 Node.js 完全兼容，仅 import 路径不同。

**脚本**：
```bash
# 批量替换（在 app 目录执行）
rg -l "node:events" src/ | xargs -r sed -i "s/'node:events'/'events'/g"
rg -l 'node:events' src/ | xargs -r sed -i 's/"node:events"/"events"/g'
```

**影响文件**：46 个，主要是 `channels/*`, `plugins/*`, `security/*`
**测试**：`bun test` 全量回归
**风险**：无

---

### 2.2 `node:path` → `path`（155 处）

**操作**：全局替换 `node:path` → `path`（不带 `node:` 前缀）

**验证**：Bun 原生 `path` 模块与 Node.js `path` API 100% 兼容。

**脚本**：
```bash
rg -l "node:path" src/ | xargs -r sed -i "s/'node:path'/'path'/g"
rg -l 'node:path' src/ | xargs -r sed -i 's/"node:path"/"path"/g'
```

**特殊处理**：`import * as path from 'node:path'` 的 `* as` 导入需确认类型推断不受影响。

**影响文件**：155 个（占比最高），几乎覆盖所有目录
**测试**：`bun test` 全量回归
**风险**：无（Bun 的 `path` 即 Node.js `path`）

---

### 2.3 `node:url` → 全局 `URL`（3 处）

**操作**：删除 `import ... from 'node:url'`，直接使用全局 `URL`

**影响文件**：3 个
**风险**：无（`URL` 是 Web 标准全局类）

---

### 2.4 `node:util` → Bun 等效替代（3 处）

**操作**：
- `import { promisify } from 'node:util'` → 改为 `import { promisify } from 'util'` 或直接用 async/await 重构
- `import { ... } from 'node:util'` → 删除 import，使用原生 API

**影响文件**：3 个（主要是 `SignalChannel.ts`）
**风险**：极低

---

### Phase 1 验收 ✅

```bash
# 验证 node:events / node:path / node:url / node:util 已全部清除
rg "node:(events|path|url|util)" src/ --stats
# 结果: 1 match (仅注释中 "node:events → events" 说明文字, 非 import)

bun test ./src/tools/CanvasTool/__tests__/    # 11 pass
bun test ./src/tests/PathGuard.test.ts          # 16 pass, 5 skip
bun run typecheck                               # 通过
bun run lint:fix                                # 0 错误 0 警告

# 引用总览
rg -c "from 'node:" src/ # 303 matches (↓139, 31.4%)
```

---

## 3. Phase 2：中等风险逐模块替换（116 处，3 个模块）

### 3.1 `node:os` → Bun / `process.env`（18 处）

| Node.js API | Bun 替代 | 说明 |
|------|------|------|
| `os.homedir()` | `process.env.HOME \|\| process.env.USERPROFILE` | 跨平台主目录 |
| `os.tmpdir()` | `process.env.TMPDIR \|\| '/tmp'` | 临时目录 |
| `os.platform()` | `process.platform` | 平台检测 |
| `os.arch()` | `process.arch` | CPU 架构 |
| `os.cpus()` | 保留 `os.cpus()` 或改用 `navigator.hardwareConcurrency` | CPU 信息（仅监控用） |
| `os.freemem()` | 无直接替代，改为 `Bun` 系统调用 | 内存（仅监控用） |

**操作**：
1. 创建 `app/src/utils/systemInfo.ts` 统一的平台信息工具模块
2. 逐个文件替换 `import ... from 'node:os'` → `import { homedir, tmpdir } from '@utils/systemInfo'`
3. 对 `os.cpus()` / `os.freemem()`（仅 `SystemMetricsCollector.ts`）保留原生调用或用条件编译

**影响文件**：18 个
**测试**：`bun test` + 手动验证平台判断逻辑
**风险**：低（大多数 API 有 `process.*` 等价替代）

---

### 3.2 `node:crypto` → Bun Crypto（61 处）

| Node.js API | Bun 替代 | 引用数 | 备注 |
|------|------|:--:|------|
| `randomUUID()` | `Bun.randomUUIDv7()` 或 `crypto.randomUUID()` | ~30 | API 完全兼容 |
| `createHash('sha256')` | `new Bun.CryptoHasher('sha256')` 或 `Bun.SHA256.hash()` | ~25 | 需逐个适配 |
| `createSign('RSA-SHA256')` | **暂无 Bun 替代** | ~3 | VertexAI 认证，**保留** |
| `randomBytes(n)` | `crypto.getRandomValues(new Uint8Array(n))` | ~3 | Web Crypto API |

**操作**：
1. 创建 `app/src/utils/crypto.ts` 统一封装：
   ```typescript
   export function sha256(data: string | Buffer): string {
     return Bun.SHA256.hash(data, 'hex') as string;
   }
   export function uuid(): string {
     return crypto.randomUUID(); // Web Crypto
   }
   ```
2. 批量替换 `node:crypto` 的 `randomUUID` → 封装函数
3. `createHash('sha256')` 逐个替换为封装函数
4. **保留** `VertexAIProvider.ts` 中的 `createSign`（标记 TODO）

**影响文件**：61 个
**测试**：`bun test` + 手动验证 VertexAI 签名
**风险**：中（`createHash` 返回值类型不同，需仔细适配）

---

### 3.3 `node:child_process` → `Bun.spawn`（37 处）

| Node.js API | Bun 替代 | 引用数 | 备注 |
|------|------|:--:|------|
| `execSync(cmd)` | `Bun.spawnSync({ cmd: [...] }).stdout.toString()` | ~25 | 返回类型不同 |
| `spawn(cmd, args)` | `Bun.spawn([cmd, ...args])` | ~10 | API 略有差异 |
| `fork(module)` | Bun Worker 或保留 | ~3 | **暂无直接替代** |

**操作**：
1. 创建 `app/src/utils/shell.ts` 封装：
   ```typescript
   export function exec(cmd: string): { stdout: string; stderr: string; exitCode: number } {
     const parts = cmd.split(/\s+/);
     const result = Bun.spawnSync(parts);
     return {
       stdout: result.stdout.toString(),
       stderr: result.stderr.toString(),
       exitCode: result.exitCode,
     };
   }
   ```
2. 逐个替换各文件中的 `execSync` / `spawn` 调用
3. `fork()` 保留或改为 Worker（仅 3 处：`DetachedTaskRuntime`, `ForkedDreamExecutor`, `dreamWorker`）

**影响文件**：37 个
**测试**：`bun test` + CI 全量验证（Git/FFmpeg/Docker 命令路径）
**风险**：中（子进程行为差异，需逐命令验证）

---

### Phase 2 验收

```bash
rg "node:(os|crypto|child_process)" src/ --stats
# 期望: 仅剩 createSign + fork 保留使用

bun test              # 全量测试
bun run typecheck
bun run lint:fix
```

---

## 4. Phase 3：高风险核心模块替换（248 处，2 个模块）

> ⚠️ Phase 3 涉及项目最基础的 I/O 和网络层，建议分 **Phase 3a (fs)** 和 **Phase 3b (http)** 交替推进，每次提交后全量测试。

### 4.1 `node:fs` / `node:fs/promises` → `Bun.file()` / `Bun.write()`（188 处）

| Node.js API | Bun 替代 | 引用数 |
|------|------|:--:|
| `readFileSync(path)` | `Bun.file(path).text()` 或 `await Bun.file(path).text()` | ~40 |
| `writeFileSync(path, data)` | `Bun.write(path, data)` | ~35 |
| `existsSync(path)` | `Bun.file(path).exists()` 或 `await Bun.file(path).exists()` | ~30 |
| `readdir(path)` | `Array.from(new Bun.Glob('*').scanSync(path))` | ~15 |
| `stat(path)` | `Bun.file(path).stat()` | ~10 |
| `mkdirSync(path)` | `Bun.write(path + '/.keep', '')` 或 `import { mkdir } from 'node:fs/promises'` | ~10 |
| `unlink(path)` | `import { unlink } from 'node:fs/promises'` 或 `Bun.file(path).delete()` | ~8 |
| `readFile(path)` (promises) | `await Bun.file(path).text()` | ~40 |

**操作策略**（推荐渐进式）：

1. **Step 3a-1**: `existsSync` → `Bun.file().exists()`（30 处，影响面最广的单一 API）
2. **Step 3a-2**: `readFileSync` / `writeFileSync` → `Bun.file().text()` / `Bun.write()`（75 处）
3. **Step 3a-3**: `readdir` → `Bun.Glob`（15 处，API 差异大）
4. **Step 3a-4**: 其余 API（`stat`, `mkdir`, `unlink`, `readFile` async 等，68 处）

**风险**：
- `Bun.file()` 是 async 的，`existsSync` → `Bun.file().exists()` 在同步函数中会产生 `await`
- `readdir` → Glob 的返回格式不同（`Dirent[]` vs `string[]`）
- 建议逐目录、逐模块推进，不要一口气全局替换

**影响文件**：~90 个文件
**测试**：每个 Step 完成后 `bun test` + CI 构建验证
**风险**：高

---

### 4.2 `node:http` → `Bun.serve()`（60 处）

| 现状 | Bun 替代 |
|------|------|
| `import type http from 'node:http'`（58 处，类型标注） | 替换为 Bun 类型或自定义 Request/Response 类型 |
| `import http from 'node:http'`（2 处，Voice + LiveView） | 迁移到 `Bun.serve()` |

**操作策略**：

1. **Step 3b-1**: 将 58 处 `import type http from 'node:http'` 替换为自定义类型 `ServerRequest` / `ServerResponse`
2. **Step 3b-2**: 重构 `LocalHTTPService.ts` 为 Bun.serve()（当前使用 Node.js `http.createServer()`）
3. **Step 3b-3**: 迁移 `voice-handlers.ts` 和 `LiveViewServer.ts` 两个 runtime http 使用

**风险**：
- 所有 handler 的函数签名都会改变（`req: http.IncomingMessage, res: http.ServerResponse` → `req: Request`）
- 这是 API 层面不兼容的变更，建议单独在一个大 PR 中完成
- **强烈建议 Phase 3b 作为独立里程碑推进**

**影响文件**：60 个（几乎全是 `infrastructure/http/handlers/*`）
**测试**：全量 API 集成测试 + 手动验证
**风险**：高

---

## 5. 不会剥离的模块

| 模块 | 原因 |
|------|------|
| `net` (7) | Bun 有 `Bun.connect()`，但 IRC/邮件/SMTP 频道重度依赖 `net.Socket`，迁移成本 > 收益 |
| `tls` (3) | 同上，与 `net` 耦合 |
| `stream` (3) | 仅类型标注，无需剥离 |
| `https` (2) | `Bun.fetch()` 已原生支持 HTTPS，实际可以不 import |
| `worker_threads` (1) | 可用 Bun Worker 替代，但收益极小 |
| `dns` (1) | 可用 `Bun.dns`，收益极小 |
| `buffer` (1) | Bun 完全兼容，无剥离心要 |
| `readline` (1) | Bun 兼容，收益极小 |
| `zlib` (1) | 可用 `Bun.gzipSync()`，收益极小 |

---

## 6. 执行时间线

```
✅ Week 1: Phase 1 完成 (2026-07-08)
  ✅ events + path 批量替换（~125 文件，2 条命令）
  ✅ url + util 逐文件替换（6 文件）
  ✅ typecheck + lint + test 验证通过

⬜ Week 2-3: Phase 2 待执行
  Day 1-3: os 替换（含 systemInfo 工具模块）
  Day 4-6: crypto 替换（含 crypto 工具模块 + createSign 保留）
  Day 7-9: child_process 替换（含 shell 工具模块 + fork 保留）
  Day 10-12: 测试 + 回归 + 提交

⬜ Week 4-8: Phase 3 待执行
  Day 16-20: Step 3a-1 (existsSync)
  Day 21-25: Step 3a-2 (readFileSync/writeFileSync)
  Day 26-30: Step 3a-3 (readdir) + Step 3a-4 (其余)
  Day 31-40: Phase 3b (http → Bun.serve(), 独立里程碑)
```

**总预估**：8 周（可并行推进，实际取决于测试覆盖率和 CI 反馈速度）

---

## 7. 风险控制

| 措施 | 说明 |
|------|------|
| **每 Phase 独立分支** | `strip/node-phase1`, `strip/node-phase2`, `strip/node-phase3` |
| **逐文件提交** | 每个文件替换单独 commit，便于 `git bisect` 定位问题 |
| **保留 CI 双轨** | 剥离期间 Bun 和 Node.js compat layer 同时可用，不破坏现有功能 |
| **回滚点** | 每个 Step 完成后打 tag（如 `v0.4.29-phase1`），失败立即回滚 |
| **渐进式** | fs/http 等高影响模块按 API 粒度拆分，分步验证 |

---

## 8. 验收标准

```bash
# Phase 1 验收
rg "node:(events|path|url|util)" src/ --count   # 期望: 0

# Phase 2 验收
rg "node:(os|crypto|child_process)" src/ --count  # 期望: ≤5 (仅保留项)

# Phase 3 验收
rg "node:(fs|http)" src/ --count  # 期望: 0

# 全量验收
bun test                    # 0 fail
bun run typecheck           # 0 errors
bun run lint:fix            # 0 errors
bun run build:release       # Tauri 打包成功（CI green）
```
