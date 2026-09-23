# Implementation Plan: llama.cpp Model Management

> **Spec**: [spec.md](.trae/specs/llama-cpp-model-management/spec.md)
> **Status**: Planned
> **Date**: 2026-08-19

---

## Phase 1: Configuration Infrastructure

### Task 1.1: Extend Configuration Schema & Path Resolution

- **Priority**: High
- **Dependencies**: None
- **Target ACs**: AC-1.1, AC-1.3

**Implementation**:
1. Update `LlamaServerConfig` interface to add `modelsDir?: string` field
2. Modify `resolveLlamaModelsDir()` in `paths.ts` to accept an optional path parameter
3. Update `LlamaCppServerManager` to use the configured `modelsDir` for model scanning
4. Ensure backward compatibility: if `modelsDir` is empty, fall back to default path

**Test Requirements**:
- [ ] `rule`: When `modelsDir` is set, `scanModels()` returns models from the custom path
- [ ] `rule`: When `modelsDir` is empty, `scanModels()` returns models from the default path
- [ ] `rule`: Loading config without `modelsDir` field works correctly (backward compat)
- [ ] `rule`: Saving config persists `modelsDir` correctly

### Task 1.2: Implement Path Validation & Safety Checks

- **Priority**: High
- **Dependencies**: Task 1.1
- **Target ACs**: AC-1.2, AC-1.4, NFR-1

**Implementation**:
1. Implement `validateModelsDir()` function with:
   - `fs.realpath()` to resolve symlinks
   - Write permission test with `try/finally` cleanup
   - Auto-create directory if not exists
2. Implement `ensureSafeMigrationPath()` function with:
   - Source-target same path check
   - Target is source subdirectory check
   - Forbidden system directories check (cross-platform)
3. Add path traversal prevention using `path.resolve` + `path.normalize`

**Test Requirements**:
- [ ] `rule`: Symlink to system directory is rejected
- [ ] `rule`: Non-existent directory is auto-created
- [ ] `rule`: System directory (e.g., `C:\Windows`) is rejected
- [ ] `rule`: Target = Source path is rejected with specific error code
- [ ] `rule`: Target is Source subdirectory is rejected
- [ ] `rule`: Temporary test file is cleaned up even on error

---

## Phase 2: Core Migration Service

### Task 2.1: Implement Migration Logic in LlamaCppServerManager

- **Priority**: High
- **Dependencies**: Task 1.2
- **Target ACs**: AC-2.1, AC-2.2, AC-2.7, AC-2.10, AC-2.11, NFR-6, NFR-7

**Implementation**:
1. Implement `migrateModels()` method with:
   - Service stop before migration
   - Service restart after migration (in `finally`)
   - File-by-file processing loop
   - Cross-disk `EXDEV` fallback (rename → copy + delete)
   - File overwrite logic based on `overwrite` flag
   - Recursive scan with depth limit (5) and symlink skip
2. Implement progress callback interface `MigrateProgress`
3. Implement `AbortController` integration for cancellation

**Test Requirements**:
- [ ] `rule`: Same-disk move succeeds
- [ ] `rule`: Cross-disk move falls back to copy+delete, log recorded
- [ ] `rule`: Service is stopped before migration and restarted after
- [ ] `rule`: Recursion stops at depth 5
- [ ] `rule`: Symlink directories are skipped
- [ ] `rule`: `overwrite=false` skips existing files
- [ ] `rule`: `overwrite=true` overwrites existing files

### Task 2.2: Implement SSE Migration API & Cancellation

- **Priority**: High
- **Dependencies**: Task 2.1
- **Target ACs**: AC-2.3, AC-2.4, AC-2.5, AC-2.6, AC-2.8, AC-2.9, NFR-5

**Implementation**:
1. Implement `handleLlamaMigrate()` handler with:
   - SSE response headers
   - Progress event streaming (`event: progress`)
   - Completion event (`event: complete`)
   - Error event (`event: error`)
   - Cancel event (`event: cancelled`)
2. Implement `handleLlamaMigrateCancel()` handler with:
   - AbortController retrieval and abort
3. Implement `checkDiskSpace()` pre-check function
4. Register new routes in `llama-routes.ts`

**Test Requirements**:
- [ ] `rule`: Source = Target returns `MIGRATE_SAME_PATH`
- [ ] `rule`: Target is source subdirectory returns `MIGRATE_NESTED_PATH`
- [ ] `rule`: System directory returns `MIGRATE_FORBIDDEN_PATH`
- [ ] `rule`: Insufficient disk space returns `MIGRATE_INSUFFICIENT_SPACE`
- [ ] `rule`: SSE connection receives progress events
- [ ] `rule`: Cancellation stops migration and sends `cancelled` event

---

## Phase 3: Hardware Detection Service

### Task 3.1: Implement Hardware Detector

- **Priority**: High
- **Dependencies**: None
- **Target ACs**: AC-3.1, AC-3.2, AC-3.3, AC-3.4, AC-3.5, AC-3.6, AC-3.7, NFR-12, NFR-14

**Implementation**:
1. Create `HardwareDetector.ts` with:
   - `detectCPU()`: Uses `os.cpus()` to get cores, threads, model
   - `detectMemory()`: Uses `os.totalmem()` and `os.freemem()`
   - `detectGPU()`: Platform-specific detection:
     - Windows: `nvidia-smi` lookup with fallback paths + WMI query
     - macOS: `system_profiler SPDisplaysDataType`
     - Linux: `nvidia-smi` + `rocm-smi` + `/sys/class/drm` fallback
   - `detectBackend()`: Check for llama.cpp binary files
2. Implement `estimateUsableMemory()` with unified formula
3. Implement `recommendGpuLayers()` with GGUF metadata support
4. Add caching (60s TTL)

**Test Requirements**:
- [ ] `rule`: Windows + NVIDIA returns GPU info
- [ ] `rule`: Windows + AMD returns GPU info
- [ ] `rule`: Windows + no GPU returns safe defaults
- [ ] `rule`: macOS + Apple Silicon returns unified memory info
- [ ] `rule`: Linux + NVIDIA works
- [ ] `rule`: Failed detection returns safe defaults (no throw)
- [ ] `rule`: Second call within 60s returns cached result
- [ ] `rule`: `estimateUsableMemory()` uses unified formula

### Task 3.2: Implement Hardware Detection API

- **Priority**: High
- **Dependencies**: Task 3.1
- **Target ACs**: AC-3.1, AC-3.7

**Implementation**:
1. Implement `handleHardwareDetection()` handler
2. Register route: `GET /v1/llama/hardware`
3. Return hardware info with cache timestamp

**Test Requirements**:
- [ ] `rule`: API returns hardware info successfully
- [ ] `rule`: API returns cached result within TTL

---

## Phase 4: Model Recommendation & Download

### Task 4.1: Implement Model Recommender

- **Priority**: High
- **Dependencies**: Task 3.1
- **Target ACs**: AC-4.1, AC-4.2, AC-4.3, AC-4.4, AC-4.5

**Implementation**:
1. Create `ModelRecommender.ts` with:
   - `recommend()` method using `HardwareDetector.estimateUsableMemory()`
   - Configurable model list (Qwen3.8 variants)
   - Suitability classification (high/medium/low)
   - `isBestRecommendation()` based on actual sort, not index
2. Implement sorting logic: suitability → quality score

**Test Requirements**:
- [ ] `rule`: 32GB + 12GB VRAM → Q5_K_M is 'high'
- [ ] `rule`: 16GB → IQ4_XS is best recommendation
- [ ] `rule`: 8GB → all versions are 'low'
- [ ] `rule`: Memory estimation uses `estimateUsableMemory()`
- [ ] `rule`: 'Best Recommendation' badge based on actual sort order

### Task 4.2: Implement Model Download Service

- **Priority**: High
- **Dependencies**: Task 4.1
- **Target ACs**: AC-5.1, AC-5.2, AC-5.3, AC-5.4, AC-5.5, AC-5.6, NFR-15, NFR-16

**Implementation**:
1. Create `ModelDownloadService.ts` with:
   - `checkCliAvailable()`: Detect `modelscope` CLI
   - `downloadViaHttp()`: HTTP fallback download with progress
   - `downloadAndConfigure()`: Orchestrates download → configure → optional start
   - `verifyChecksum()`: SHA256 verification
2. Implement `handleModelDownload()` SSE handler
3. Register route: `POST /v1/llama/download`
4. Support `MODELSCOPE_MIRROR` env variable

**Test Requirements**:
- [ ] `rule`: CLI available → uses CLI
- [ ] `rule`: CLI unavailable → falls back to HTTP
- [ ] `rule`: SSE pushes download progress
- [ ] `rule`: SHA256 checksum passes → model loaded
- [ ] `rule`: SHA256 mismatch → rejected with `MODEL_CHECKSUM_MISMATCH`
- [ ] `rule`: Auto-configures GPU layers after download

### Task 4.3: Implement Recommendation & Delete APIs

- **Priority**: Medium
- **Dependencies**: Task 4.1, Task 2.2
- **Target ACs**: AC-4.1, AC-5.6

**Implementation**:
1. Implement `handleModelRecommendations()` handler
2. Implement `handleLlamaDeleteModel()` handler with confirmation
3. Register routes:
   - `GET /v1/llama/recommendations`
   - `DELETE /v1/llama/models/:filename`

**Test Requirements**:
- [ ] `rule`: Recommendation API returns sorted list
- [ ] `rule`: Delete requires confirmation
- [ ] `rule`: Delete removes model file

---

## Phase 5: Frontend Integration

### Task 5.1: Implement Hardware & Recommendation UI

- **Priority**: Medium
- **Dependencies**: Task 3.2, Task 4.3
- **Target ACs**: AC-6.1, AC-6.3

**Implementation**:
1. Update `LlamaConfigPanel.tsx`:
   - Hardware detection card (CPU/Memory/GPU info)
   - Model recommendation list with suitability badges
   - 'Best Recommendation' highlighting
   - Auto-detect on page load
2. Implement `llamaService.ts` API methods:
   - `detectHardware()`
   - `getRecommendations()`

**Test Requirements**:
- [ ] `rubric`: Hardware info displays correctly
- [ ] `rubric`: Recommendations show correct badges
- [ ] `rule`: Hardware auto-detects on page load
- [ ] `rule`: Manual re-detect button works

### Task 5.2: Implement Migration & Download UI

- **Priority**: Medium
- **Dependencies**: Task 2.2, Task 4.2, Task 5.1
- **Target ACs**: AC-2.8, AC-2.9, AC-6.1, AC-6.2

**Implementation**:
1. Implement migration UI in `LlamaConfigPanel.tsx`:
   - Directory input with browse dialog
   - Migrate button with confirmation dialog
   - SSE progress bar during migration
   - Cancel button during migration
   - Results display (success/skipped/failed counts)
2. Implement download UI:
   - Download button per recommendation
   - Download progress with status
   - Completion/error display
3. Update `llamaService.ts`:
   - `startMigration()` with SSE handling
   - `cancelMigration()`
   - `downloadModel()` with SSE handling
   - `deleteModel()`

**Test Requirements**:
- [ ] `rule`: Migration confirmation dialog shows file count and target
- [ ] `rule`: SSE progress updates the bar in real-time
- [ ] `rule`: Cancel button stops migration
- [ ] `rule`: Download progress bar updates
- [ ] `rule`: Completion shows success/error state
- [ ] `rubric`: Entire flow is usable for novice users (AC-6.1)

---

## Phase 6: Testing & Verification

### Task 6.1: Unit Tests

- **Priority**: High
- **Dependencies**: All previous tasks
- **Target ACs**: AC-1.1 through AC-5.6

**Implementation**:
1. Write unit tests for:
   - Path validation logic
   - Migration logic (cross-disk fallback, overwrite)
   - Hardware detection (mock system commands)
   - Memory estimation
   - Recommendation logic (different hardware configs)
   - Checksum verification
   - SSE event handling

**Test Requirements**:
- [ ] `rule`: All path validation scenarios pass
- [ ] `rule`: Migration edge cases pass
- [ ] `rule`: Hardware detection works for all platforms
- [ ] `rule`: Recommendation logic is correct
- [ ] `rule`: Download service handles both CLI and HTTP
- [ ] `rule`: Checksum verification works

### Task 6.2: Integration & End-to-End Tests

- **Priority**: High
- **Dependencies**: Task 6.1
- **Target ACs**: AC-1.1 through AC-6.3, NFR-1 through NFR-19

**Implementation**:
1. Integration tests:
   - Full migration flow (API → Service → File System)
   - Full download flow (CLI/HTTP → Config → Service Start)
   - Hardware detection API integration
2. End-to-end tests:
   - Novice user scenario: detect → recommend → download → use
   - Cross-disk migration scenario
   - Cancellation scenario
   - Error recovery scenario

**Test Requirements**:
- [ ] `rule`: Full migration flow works end-to-end
- [ ] `rule`: Full download flow works end-to-end
- [ ] `rule`: Cancellation works in integration test
- [ ] `rubric`: Novice user can complete first deployment (AC-6.1)
- [ ] `rubric`: Migration is visible to user (AC-6.2)
- [ ] `rubric`: Error messages are clear (AC-6.3)

---

## Implementation Order

```
Phase 1 (Config) → Phase 2 (Migration) → Phase 3 (Hardware) → Phase 4 (Recommend/Download) → Phase 5 (Frontend) → Phase 6 (Testing)
```

Each phase's tasks can be parallelized within the phase if they have no dependencies.

---

## Success Criteria

- All ACs verified with passing test evidence
- No high-severity open issues
- Independent review passes
- Feature works on Windows (primary) and is compatible with macOS/Linux