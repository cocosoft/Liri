# llama.cpp 模型管理系统规范

> **版本**: v1.0
> **日期**: 2026-08-19
> **状态**: Approved
> **设计参考**: `dev_docs/20260819/llama_cpp模型目录配置与迁移功能设计方案.md`

---

## 1. Problem Statement

当前 `llama.cpp` 集成存在以下痛点：

1. **模型路径硬编码**：用户无法将 GGUF 模型存放到非默认路径，无法利用更大存储空间或更快 SSD。
2. **手动迁移风险**：更换模型目录需手动复制文件，跨磁盘移动（`EXDEV` 错误）易导致失败，且无进度反馈。
3. **硬件检测缺失**：用户需手动查询 CPU/GPU 配置，手动计算 GPU 层数与内存预算，小白用户无法独立完成。
4. **模型选择困难**：面对众多量化版本（Q4_K_M / Q5_K_M / IQ4_XS 等）无从选择，下载了不适合的版本。
5. **下载依赖 CLI**：`modelscope` CLI 未安装时无法下载模型，无 HTTP 回退方案。

## 2. Stakeholders & Goals

### 2.1 Users

- **小白用户**：零配置体验，下载即用，无需了解硬件细节。
- **进阶用户**：精细控制模型存储路径、量化版本、GPU 层数。
- **运维人员**：批量迁移模型、管理多环境配置。

### 2.2 Goals

| Goal | Description | Priority |
|------|-------------|----------|
| G1: 模型目录可配置 | 用户可将 GGUF 模型存放到任意路径（本地磁盘） | Must |
| G2: 安全可靠的模型迁移 | 支持跨磁盘迁移、跨符号链接检测、磁盘空间预检、服务停机迁移 | Must |
| G3: 可见的迁移反馈 | SSE 实时推送迁移进度，支持用户取消 | Must |
| G4: 自动硬件检测 | 自动检测 CPU/GPU/内存配置，跨平台支持（Win/Mac/Linux） | Must |
| G5: 智能模型推荐 | 基于硬件配置推荐最优模型量化版本，适配度分级 | Must |
| G6: 一键下载与配置 | 下载模型后自动配置 GPU 层数、上下文窗口，支持自动启动 | Must |
| G7: CLI 依赖回退 | `modelscope` CLI 不可用时自动回退到 HTTP 直连下载 | Should |
| G8: 文件完整性校验 | 下载后 SHA256 校验，防止损坏/篡改模型被加载 | Should |

### 2.3 Non-Goals

- 不支持网络路径（UNC/SMB/NFS）作为模型存储目录（P2 规划）。
- 不支持多目录同时扫描与聚合（P2 规划）。
- 不实现 Ollama 模型管理（独立模块）。
- 不实现云端模型同步（P3 规划）。

## 3. Functional Requirements

### 3.1 配置管理

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-1.1 | 系统 SHALL 允许用户通过 API 配置自定义模型存储目录（`modelsDir`） | Must |
| FR-1.2 | 系统 SHALL 校验目录的存在性、可读性、可写性 | Must |
| FR-1.3 | 系统 SHALL 拒绝路径穿越攻击（`path.resolve` + `path.normalize` + `fs.realpath`） | Must |
| FR-1.4 | 系统 SHALL 拒绝将模型迁移到系统目录（跨平台禁止路径表） | Must |
| FR-1.5 | 系统 SHALL 支持配置向后兼容：旧配置无 `modelsDir` 字段时自动使用默认路径 | Must |
| FR-1.6 | 系统 SHALL 在配置保存时使用 `try/finally` 清理临时测试文件 | Should |

### 3.2 文件迁移

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-2.1 | 系统 SHALL 支持 `copy`（复制）和 `move`（移动）两种迁移模式 | Must |
| FR-2.2 | 系统 SHALL 在迁移前停止 `llama-server`，迁移完成后按需重启 | Must |
| FR-2.3 | 系统 SHALL 捕获 `EXDEV`/`XDEV` 错误并自动降级为"复制+删除源文件" | Must |
| FR-2.4 | 系统 SHALL 拒绝源目录与目标目录相同的迁移请求 | Must |
| FR-2.5 | 系统 SHALL 拒绝目标目录为源目录子目录的迁移请求 | Must |
| FR-2.6 | 系统 SHALL 在迁移前预检目标磁盘剩余空间（估算源文件总大小 + 500MB 缓冲） | Must |
| FR-2.7 | 系统 SHALL 使用 SSE 推送迁移进度（`progress` 事件 + `complete`/`error`/`cancelled` 事件） | Must |
| FR-2.8 | 系统 SHALL 支持用户取消进行中的迁移（`AbortController`） | Must |
| FR-2.9 | 系统 SHALL 限制递归扫描深度（默认 5 层）并跳过符号链接目录 | Must |
| FR-2.10 | 系统 SHALL 支持覆盖/跳过目标目录中已存在的同名文件 | Must |

### 3.3 硬件检测

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-3.1 | 系统 SHALL 检测 CPU 核心数、线程数、型号 | Must |
| FR-3.2 | 系统 SHALL 检测系统总内存与当前可用内存 | Must |
| FR-3.3 | 系统 SHALL 跨平台检测 GPU 信息：Windows（WMI/nvidia-smi）、macOS（system_profiler）、Linux（nvidia-smi/rocm-smi） | Must |
| FR-3.4 | 系统 SHALL 检测 llama.cpp 后端二进制类型（cpu/cuda/vulkan） | Must |
| FR-3.5 | 系统 SHALL 缓存检测结果 60 秒，避免频繁执行系统命令 | Must |
| FR-3.6 | 系统 SHALL 在 GPU 检测失败时返回安全默认值，不抛出异常 | Must |

### 3.4 模型推荐

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-4.1 | 系统 SHALL 基于硬件检测结果推荐模型量化版本 | Must |
| FR-4.2 | 系统 SHALL 统一使用 `HardwareDetector.estimateUsableMemory()` 估算可用内存 | Must |
| FR-4.3 | 系统 SHALL 按适配度分级（high/medium/low）标记推荐项 | Must |
| FR-4.4 | 系统 SHALL 基于实际最优项标记"最佳推荐"，而非简单的列表第一项 | Must |
| FR-4.5 | 系统 SHALL 支持从 GGUF 元数据读取实际模型层数，用于 GPU 层数估算 | Should |
| FR-4.6 | 系统 SHALL 支持可配置的推荐规则表（模型系列、量化版本、质量评分） | Should |

### 3.5 模型下载

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-5.1 | 系统 SHALL 支持通过 `modelscope` CLI 下载模型 | Must |
| FR-5.2 | 系统 SHALL 在 CLI 不可用时自动回退到 HTTP 直连下载 | Must |
| FR-5.3 | 系统 SHALL 支持配置国内镜像源（`MODELSCOPE_MIRROR` 环境变量） | Must |
| FR-5.4 | 系统 SHALL 通过 SSE 推送下载进度（百分比/状态） | Must |
| FR-5.5 | 系统 SHALL 在下载完成后校验 SHA256 哈希完整性 | Must |
| FR-5.6 | 系统 SHALL 在哈希校验失败时拒绝加载并报告错误 | Must |
| FR-5.7 | 系统 SHALL 在下载完成后自动配置 GPU 层数、上下文窗口等参数 | Must |
| FR-5.8 | 系统 SHALL 支持自动启动 `llama-server` | Should |

## 4. Non-Functional Requirements

### 4.1 安全性

| ID | Requirement | Type |
|----|-------------|------|
| NFR-1 | 所有路径校验 SHALL 使用 `fs.realpath` 解析真实路径，防止符号链接绕过 | rule |
| NFR-2 | 迁移 SHALL 禁止目标路径为系统目录（跨平台） | rule |
| NFR-3 | 迁移 SHALL 禁止目标路径为源路径的子目录 | rule |
| NFR-4 | 下载 SHALL 校验文件 SHA256 完整性 | rule |
| NFR-5 | 迁移 SHALL 预检磁盘剩余空间，不足时提前拒绝 | rule |

### 4.2 可靠性

| ID | Requirement | Type |
|----|-------------|------|
| NFR-6 | 迁移 SHALL 在服务运行时自动停止并在完成后恢复 | rule |
| NFR-7 | 跨磁盘移动 SHALL 自动降级为复制+删除 | rule |
| NFR-8 | 用户 SHALL 可以取消进行中的迁移 | rule |
| NFR-9 | 硬件检测 SHALL 在检测失败时返回安全默认值 | rule |

### 4.3 兼容性

| ID | Requirement | Type |
|----|-------------|------|
| NFR-10 | 配置向后兼容：旧配置无 `modelsDir` 时自动映射为默认路径 | rule |
| NFR-11 | API 响应 SHALL 在新增字段时保持向前兼容（旧客户端忽略新字段） | rule |

### 4.4 性能

| ID | Requirement | Type |
|----|-------------|------|
| NFR-12 | 硬件检测 SHALL 在 5 秒内完成（含超时） | rubric |
| NFR-13 | 迁移进度推送 SHALL 每处理 1 个文件推送至少 1 次事件 | rule |
| NFR-14 | 硬件检测缓存 TTL SHALL 为 60 秒 | rule |

### 4.5 可观测性

| ID | Requirement | Type |
|----|-------------|------|
| NFR-15 | 所有关键操作（迁移/下载/检测） SHALL 记录 INFO 级别日志 | rule |
| NFR-16 | 错误 SHALL 通过 `handleError()` 统一处理并上报 ErrorTracker | rule |

### 4.6 UX-Design Rubrics

| ID | Dimension | Scale | Pass Threshold | Evidence |
|----|-----------|-------|----------------|----------|
| NFR-17 | 小白用户完成首次模型部署 | 0-2: 0=需手动查配置；1=部分需手动；2=全自动化 | 2 | 端到端测试录像 |
| NFR-18 | 迁移过程用户可见进度 | 0-2: 0=无反馈；1=静态状态；2=实时进度条+可取消 | 2 | 功能测试录像 |
| NFR-19 | 错误提示清晰度 | 0-2: 0=技术术语堆积；1=部分可读；2=用户友好+日志定位 | 1 | 错误场景截图 |

## 5. Data Model

### 5.1 LlamaServerConfig

```typescript
interface LlamaServerConfig {
  host: string;
  port: number;
  model: string;
  modelsDir: string;        // v1.1 新增：空字符串 = 使用默认路径
  autoStart: boolean;
  gpuLayers: number;
  contextWindow: number;
}
```

### 5.2 HardwareInfo

```typescript
interface HardwareInfo {
  cpu: {
    model: string;
    cores: number;
    threads: number;
  };
  memory: {
    totalGB: number;
    availableGB: number;
  };
  gpu: {
    hasGPU: boolean;
    vendor: 'nvidia' | 'amd' | 'apple' | 'none';
    model: string;
    vramGB: number;
    supportsCUDA: boolean;
    supportsVulkan: boolean;
  };
  backend: {
    cpuBinaryExists: boolean;
    cudaBinaryExists: boolean;
    vulkanBinaryExists: boolean;
    recommendedBackend: 'cpu' | 'cuda' | 'vulkan';
  };
}
```

### 5.3 ModelRecommendation

```typescript
interface ModelRecommendation {
  modelId: string;
  quantVersion: string;
  fileSizeGB: number;
  estimatedRamGB: number;
  qualityScore: number;     // 0-100
  recommendationReason: string;
  suitability: 'high' | 'medium' | 'low';
}
```

### 5.4 LlamaMigrateRequest

```typescript
interface LlamaMigrateRequest {
  targetDir: string;
  copy?: boolean;
  overwrite?: boolean;
}
```

### 5.5 LlamaMigrateResponse

```typescript
interface LlamaMigrateResponse {
  success: boolean;
  migratedFiles: Array<{
    source: string;
    destination: string;
    size: number;
  }>;
  skippedFiles: string[];
  failedFiles: Array<{
    path: string;
    error: string;
  }>;
  elapsedMs: number;
}
```

### 5.6 MigrateProgress (SSE Event Payload)

```typescript
interface MigrateProgress {
  current: number;
  total: number;
  file: string;
  percent: number;
  phase: 'migrating' | 'skipped' | 'error';
  error?: string;
}
```

### 5.7 SSE Event Types

| Event Name | Payload Type | Description |
|------------|-------------|-------------|
| `progress` | `MigrateProgress` | 迁移/下载进度更新 |
| `complete` | `LlamaMigrateResponse` | 迁移完成 |
| `error` | `{ success: false; error: string }` | 操作失败 |
| `cancelled` | `{ success: true; message: string }` | 操作被用户取消 |

## 6. API Contract

### 6.1 Config API

| Method | Path | Request | Response | Description |
|--------|------|---------|----------|-------------|
| GET | `/v1/llama/config` | — | `{ success, config: LlamaServerConfig, status }` | 获取当前配置（含 `modelsDir` 实际路径） |
| PUT | `/v1/llama/config` | `Partial<LlamaServerConfig>` | `{ success, config }` | 更新配置（含 `modelsDir`） |

### 6.2 Migration API

| Method | Path | Request | Response | Description |
|--------|------|---------|----------|-------------|
| POST | `/v1/llama/migrate` | `LlamaMigrateRequest` | SSE: `progress`→`complete`/`error` | 迁移模型文件 |
| POST | `/v1/llama/migrate/cancel` | — | `{ success, message }` | 取消进行中的迁移 |
| DELETE | `/v1/llama/models/:filename` | `{ confirm: true }` | `{ success, deleted, sizeGB }` | 删除指定模型 |

### 6.3 Hardware & Recommendation API

| Method | Path | Request | Response | Description |
|--------|------|---------|----------|-------------|
| GET | `/v1/llama/hardware` | — | `{ success, hardware: HardwareInfo }` | 获取硬件检测结果 |
| GET | `/v1/llama/recommendations` | — | `{ success, recommendations: ModelRecommendation[] }` | 获取模型推荐列表 |

### 6.4 Download API

| Method | Path | Request | Response | Description |
|--------|------|---------|----------|-------------|
| POST | `/v1/llama/download` | `{ modelId, quantVersion, autoStart? }` | SSE: `progress`→`complete`/`error` | 下载并配置模型 |

## 7. Error Codes

| Error Code | HTTP Status | Description |
|------------|-------------|-------------|
| `MIGRATE_TARGET_EMPTY` | 400 | 迁移目标目录为空 |
| `MIGRATE_SAME_PATH` | 400 | 源目录与目标目录相同 |
| `MIGRATE_NESTED_PATH` | 400 | 目标目录为源目录子目录 |
| `MIGRATE_FORBIDDEN_PATH` | 400 | 目标路径为系统目录 |
| `MIGRATE_INSUFFICIENT_SPACE` | 400 | 目标磁盘空间不足 |
| `MODELS_DIR_NOT_ACCESSIBLE` | 400 | 模型目录不可访问 |
| `INVALID_MODELS_DIR` | 400 | 路径不是有效目录 |
| `MODEL_DOWNLOAD_FAILED` | 500 | 模型下载失败 |
| `MODEL_CHECKSUM_MISMATCH` | 500 | 模型文件 SHA256 校验失败 |
| `HARDWARE_DETECTION_TIMEOUT` | 500 | 硬件检测超时 |

## 8. Acceptance Criteria

### 8.1 Configuration ACs

| AC ID | Type | Requirement |
|-------|------|-------------|
| AC-1.1 | rule | 用户可通过 API 配置自定义 `modelsDir`，配置保存后重启应用仍然生效 |
| AC-1.2 | rule | 系统拒绝无效路径（不存在、不可写、系统目录、符号链接绕过）并返回明确错误码 |
| AC-1.3 | rule | 旧配置（无 `modelsDir` 字段）读取时自动映射为默认路径，应用正常启动 |
| AC-1.4 | rule | 临时测试文件在 `validateModelsDir` 中被 `try/finally` 清理，无残留垃圾文件 |

### 8.2 Migration ACs

| AC ID | Type | Requirement |
|-------|------|-------------|
| AC-2.1 | rule | 同磁盘移动（`fs.rename`）正常完成，文件从源目录消失、出现在目标目录 |
| AC-2.2 | rule | 跨磁盘移动抛出 `EXDEV` 时自动降级为复制+删除，日志记录降级操作 |
| AC-2.3 | rule | 源=目标目录的迁移请求被立即拒绝，返回 `MIGRATE_SAME_PATH` |
| AC-2.4 | rule | 目标为源子目录的迁移请求被立即拒绝，返回 `MIGRATE_NESTED_PATH` |
| AC-2.5 | rule | 系统目录作为目标被立即拒绝，返回 `MIGRATE_FORBIDDEN_PATH` |
| AC-2.6 | rule | 磁盘空间不足时预检拒绝，返回 `MIGRATE_INSUFFICIENT_SPACE`，不开始迁移 |
| AC-2.7 | rule | 迁移过程中 `llama-server` 被自动停止，完成后按需重启 |
| AC-2.8 | rule | SSE 连接在迁移过程中至少推送 1 次 `progress` 事件/文件 |
| AC-2.9 | rule | 用户取消迁移后，SSE 推送 `cancelled` 事件，已迁移文件保留 |
| AC-2.10 | rule | 递归扫描深度限制为 5 层，符号链接目录被跳过并记录警告日志 |
| AC-2.11 | rule | 目标已有同名文件时，根据 `overwrite` 参数决定覆盖或跳过 |

### 8.3 Hardware Detection ACs

| AC ID | Type | Requirement |
|-------|------|-------------|
| AC-3.1 | rule | Windows + NVIDIA 环境：返回 GPU 型号、显存、CUDA=true |
| AC-3.2 | rule | Windows + AMD 环境：返回 GPU 型号，CUDA=false |
| AC-3.3 | rule | Windows + 无独显：`hasGPU=false`，`vramGB=0` |
| AC-3.4 | rule | macOS + Apple Silicon：返回 `vendor=apple`，统一内存映射 |
| AC-3.5 | rule | Linux + NVIDIA：`nvidia-smi` 查询成功 |
| AC-3.6 | rule | 无 GPU 环境：返回安全默认值，不抛出异常 |
| AC-3.7 | rule | 60 秒内重复请求返回缓存结果 |

### 8.4 Recommendation ACs

| AC ID | Type | Requirement |
|-------|------|-------------|
| AC-4.1 | rule | 32GB 内存 + 12GB 显存：`Q5_K_M` 被标记为 `high` 适配度 |
| AC-4.2 | rule | 16GB 内存：`IQ4_XS` 被标记为最佳推荐 |
| AC-4.3 | rule | 8GB 内存：所有版本标记为不推荐（`low`） |
| AC-4.4 | rule | 可用内存估算使用 `HardwareDetector.estimateUsableMemory()`，与 GPU 层数估算一致 |
| AC-4.5 | rule | "最佳推荐"标记基于实际排序结果，而非列表第一项 |

### 8.5 Download ACs

| AC ID | Type | Requirement |
|-------|------|-------------|
| AC-5.1 | rule | `modelscope` CLI 可用时使用 CLI 下载，不可用时自动回退到 HTTP |
| AC-5.2 | rule | SSE 推送下载进度（百分比/状态），断线不丢失进度 |
| AC-5.3 | rule | 下载完成后 SHA256 校验通过才加载模型 |
| AC-5.4 | rule | SHA256 校验失败时拒绝加载，返回 `MODEL_CHECKSUM_MISMATCH` |
| AC-5.5 | rule | 下载完成后自动配置 GPU 层数与上下文窗口 |
| AC-5.6 | rule | 支持配置国内镜像源下载 |

### 8.6 UX Rubrics

| AC ID | Type | Dimension | Threshold |
|-------|------|-----------|-----------|
| AC-6.1 | rubric | 小白用户完成首次模型部署 | ≥ 1.5/2 |
| AC-6.2 | rubric | 迁移过程用户可见进度 | ≥ 1.5/2 |
| AC-6.3 | rubric | 错误提示清晰度 | ≥ 1/2 |

## 9. Constraints & Assumptions

| ID | Type | Description |
|----|------|-------------|
| C-1 | Constraint | 仅支持本地磁盘路径（不支持 UNC/SMB/NFS） |
| C-2 | Constraint | 最大递归扫描深度为 5 层 |
| C-3 | Constraint | 硬件检测超时 5 秒 |
| C-4 | Assumption | 用户操作系统为 Windows/macOS/Linux |
| C-5 | Assumption | 用户有足够磁盘空间存放 GGUF 模型（最小 IQ4_XS 约 11GB） |
| C-6 | Assumption | `modelscope` CLI 版本兼容当前 ModelScope API |
| C-7 | Assumption | ModelScope API 提供 SHA256 哈希查询端点 |

## 10. Open Questions

| ID | Question | Status | Resolution |
|----|----------|--------|------------|
| Q-1 | 是否需要支持网络路径（UNC/SMB/NFS）？ | Deferred | P2 规划 |
| Q-2 | GGUF 元数据读取是否需要引入专门的解析库？ | Open | 需评估 `gguf-parser` 或自建轻量实现 |
| Q-3 | HTTP 回退下载是否需要支持 HuggingFace 源？ | Open | 需评估用户群体分布 |
| Q-4 | 是否需要支持多模型同时迁移（并发）？ | Open | 当前串行，可后续优化 |

## 11. Related Files

| File | Role |
|------|------|
| `dev_docs/20260819/llama_cpp模型目录配置与迁移功能设计方案.md` | 设计方案（本文档为其可验证规范） |
| `.trae/specs/llama-cpp-model-management/tasks.md` | 实施任务列表 |
| `.trae/specs/llama-cpp-model-management/review.md` | 独立评审记录 |