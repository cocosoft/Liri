/**
 * 硬编码治理「同名常量」B2 守卫：协议/格式常量**唯一真源**（`CHANNEL_TAG` · `RESET`→`ANSI_RESET` · `BYTES_PER_TOKEN`）。
 *
 * 背景：这三组原为「同名常量在 ≥2 文件各写一份」——`lint:consts` 的 `同名常量:<NAME>` 检测项。
 * 2026-10-14 **续批 B2b**：再收 `A2A_TASKS_PATH`（原 `a2a-routes.ts` 与 `a2a/discoverySidecar.ts` 各一份）
 * 与 **oauth 加密参数 5 个 + 盐消歧**、**`WAV_HEADER_SIZE`**。
 * B2 的处置是**保留单一真源、其余处改为引用/转出**（导出面不变 ⇒ 零消费者改动、零行为变化）。
 *
 * 本测试即**防回流**：若有人再在消费侧写回 `const X =`，此处立即变红
 * （与棘轮门禁互补：门禁管"新增键 ⇒ 阻断"，本守卫管"这几处的形态不被改回"）。
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const APP = resolve(import.meta.dir, '../..');
const read = (rel: string) => readFileSync(join(APP, rel), 'utf8');

describe('同名常量 B2 · 协议/格式常量唯一真源', () => {
  test('ANSI_RESET 真源存在、取值钉住、并声明为唯一真源', () => {
    const src = read('src/constants/figures.ts');
    expect(src).toMatch(/export const ANSI_RESET = '\\x1b\[0m';/);
    expect(src).toContain('唯一真源');
  });

  test('两个原副本（cli/print.ts · commands/tasks/tasks.ts）不再各自定义 RESET，改为引用真源', () => {
    for (const rel of ['src/cli/print.ts', 'src/commands/tasks/tasks.ts']) {
      const src = read(rel);
      expect(src).not.toMatch(/const RESET =/);
      expect(src).toContain("from '@modules/constants'");
      expect(src).toContain('ANSI_RESET');
    }
    // 消费点确实用了新名（防"只改 import 未改用法"）
    expect(read('src/cli/print.ts')).toContain('result += ANSI_RESET;');
    expect(read('src/commands/tasks/tasks.ts')).toContain('${ANSI_RESET}');
  });

  test('CHANNEL_TAG 真源在 constants/xml.ts；消费侧只保留导出面（不再定义）', () => {
    expect(read('src/constants/xml.ts')).toMatch(
      /export const CHANNEL_TAG = 'channel';/
    );
    const parser = read('src/chat/ChannelMessageParser.ts');
    expect(parser).not.toMatch(/const CHANNEL_TAG =/);
    expect(parser).toContain(
      "import { CHANNEL_TAG } from '@modules/constants';"
    );
    expect(parser).toContain('export { CHANNEL_TAG };');
  });

  test('BYTES_PER_TOKEN 真源在 constants/toolLimits.ts；消费侧只保留导出面（不再定义）', () => {
    expect(read('src/constants/toolLimits.ts')).toMatch(
      /export const BYTES_PER_TOKEN = 4;/
    );
    const types = read('src/services/toolResultStorage/types.ts');
    expect(types).not.toMatch(/const BYTES_PER_TOKEN =/);
    expect(types).toContain(
      "export { BYTES_PER_TOKEN } from '@modules/constants';"
    );
  });

  test('B2b：A2A_TASKS_PATH 真源在 types/a2a.ts（与 A2A_RPC_PATH 同处）；两消费侧不再各自定义', () => {
    const truth = read('src/types/a2a.ts');
    expect(truth).toMatch(/export const A2A_TASKS_PATH = '\/v1\/a2a\/tasks';/);
    expect(truth).toContain('单一事实源');
    // 两消费侧：均不再定义本地副本，且都从真源模块导入
    const routes = read(
      'src/infrastructure/http/handlers/routes/a2a-routes.ts'
    );
    const sidecar = read('src/infrastructure/http/a2a/discoverySidecar.ts');
    for (const src of [routes, sidecar]) {
      expect(src).not.toMatch(/const TASKS_PATH =/);
      expect(src).toContain('A2A_TASKS_PATH');
    }
    expect(routes).toContain(
      "import { A2A_RPC_PATH, A2A_TASKS_PATH } from '@modules/types/a2a';"
    );
    expect(sidecar).toContain(
      "import { A2A_TASKS_PATH } from '@modules/types/a2a';"
    );
  });

  test('B2b：AES-256-GCM 参数真源在 oauth/utils/OAuthCrypto.ts；两 store 以别名引用（加密实现逐字不动）', () => {
    const truth = read('src/oauth/utils/OAuthCrypto.ts');
    expect(truth).toMatch(
      /export const OAUTH_CIPHER_ALGORITHM = 'aes-256-gcm';/
    );
    expect(truth).toMatch(/export const OAUTH_CIPHER_IV_LENGTH = 16;/);
    expect(truth).toMatch(/export const OAUTH_CIPHER_AUTH_TAG_LENGTH = 16;/);
    expect(truth).toMatch(/export const OAUTH_CIPHER_KEY_LENGTH = 32;/);
    expect(truth).toMatch(/export const OAUTH_PBKDF2_ITERATIONS = 100000;/);
    for (const rel of [
      'src/oauth/OAuthProviderStore.ts',
      'src/oauth/services/OAuthStorage.ts',
    ]) {
      const src = read(rel);
      // 不再各自定义参数常量...
      for (const decl of [
        /const ALGORITHM =/,
        /const IV_LENGTH =/,
        /const AUTH_TAG_LENGTH =/,
        /const KEY_LENGTH =/,
        /const ITERATIONS =/,
        /const PBKDF2_SALT =/,
      ]) {
        expect(src).not.toMatch(decl);
      }
      // ...而是以**别名导入**保留原有局部名（实现零改动）
      expect(src).toContain('OAUTH_CIPHER_ALGORITHM as ALGORITHM');
      expect(src).toContain('OAUTH_PBKDF2_ITERATIONS as ITERATIONS');
    }
    // 盐已**改名消歧**但**值不变**（两处本就不同值 ⇒ 存量密文照常解密）
    expect(read('src/oauth/OAuthProviderStore.ts')).toContain(
      "'pyapp-oauth-provider-salt-v1'"
    );
    expect(read('src/oauth/services/OAuthStorage.ts')).toContain(
      "'pyapp-oauth-salt-v2'"
    );
  });

  test('B2b：WAV_HEADER_SIZE 真源在 services/voice/services/audioUtils.ts；三处消费侧改引真源', () => {
    expect(read('src/services/voice/services/audioUtils.ts')).toMatch(
      /export const WAV_HEADER_SIZE = 44;/
    );
    for (const rel of [
      'src/services/voice/services/audioPlayer.ts',
      'src/services/voice/services/playbackManager.ts',
      'src/services/voice/services/ttsProvider.ts',
    ]) {
      const src = read(rel);
      expect(src).not.toMatch(/const WAV_HEADER_SIZE =/);
      expect(src).toContain("import { WAV_HEADER_SIZE } from './audioUtils';");
    }
  });

  test('B3-1：通道标识已按适配器消歧（不再同名）；`DEFAULT_OLLAMA_URL` 本地别名已删（直用真源）', () => {
    const adapters: Array<[string, string]> = [
      ['src/agent/orchestration/SwarmChannelAdapter.ts', 'SWARM_CHANNEL'],
      [
        'src/agent/orchestration/SchedulerChannelAdapter.ts',
        'SCHEDULER_CHANNEL',
      ],
      ['src/agent/orchestration/RemoteChannelAdapter.ts', 'REMOTE_CHANNEL'],
    ];
    for (const [rel, name] of adapters) {
      const src = read(rel);
      expect(src).not.toMatch(/const CHANNEL =/);
      // 不含 `=` 后尾空格：prettier 可能因新名变长而把声明换行
      expect(src).toContain(`const ${name} =`);
      expect(src).toContain(`[${name}]`);
    }
    for (const rel of [
      'src/ai/local/ollama/registerOllamaProvider.ts',
      'src/ai/embedding/providers/LocalEmbeddingProvider.ts',
    ]) {
      const src = read(rel);
      // 不再有**定义**（注释里可提及历史名）
      expect(src).not.toMatch(/const DEFAULT_OLLAMA_URL/);
      expect(src).toContain('DEFAULT_OLLAMA_ENDPOINT');
    }
  });

  test('B3-2：`MAX_STATUS_CHARS` 真源在 GitDetector.ts（3→1）；`LLAMACPP_PROVIDER_TYPE` 真源在 LlamaCppServerManager.ts（2→1）', () => {
    const git = read('src/context/GitDetector.ts');
    expect(git).toMatch(/export const MAX_STATUS_CHARS = 2000;/);
    expect(git).toContain('唯一真源');
    const consumers: Array<[string, string]> = [
      ['src/context/GitContextService.ts', "from './GitDetector'"],
      ['src/context/services/SystemContextService.ts', "from '../GitDetector'"],
    ];
    for (const [rel, imp] of consumers) {
      const src = read(rel);
      expect(src).not.toMatch(/const MAX_STATUS_CHARS =/);
      expect(src).toContain(imp);
    }
    const mgr = read('src/ai/local/llama/LlamaCppServerManager.ts');
    expect(mgr).toMatch(
      /export const LLAMACPP_PROVIDER_TYPE = 'llamacpp' as const;/
    );
    const reg = read('src/ai/local/llama/registerLlamaCppProvider.ts');
    expect(reg).not.toMatch(/const LLAMACPP_PROVIDER_TYPE =/);
    expect(reg).toContain('LLAMACPP_PROVIDER_TYPE,');
  });

  test('B3-3：`MODEL_ALIASES` 唯一真源在 ai/models/ModelAliases.ts（AIModelManager 改导入，不保留副本）', () => {
    expect(read('src/ai/models/ModelAliases.ts')).toMatch(
      /export const MODEL_ALIASES = \['best', 'fast', 'pro', 'flash'\] as const;/
    );
    const mgr = read('src/ai/AIModelManager.ts');
    expect(mgr).not.toMatch(/export const MODEL_ALIASES =/);
    expect(mgr).toContain(
      "import { MODEL_ALIASES, type ModelAlias } from './models/ModelAliases';"
    );
  });

  test('B3-4：`CRED_STORED_MARKER` 真源上提到 infra `constants/common.ts`（chronos 侧复刻已删；app 侧保留导出面）', () => {
    expect(read('src/constants/common.ts')).toMatch(
      /export const CRED_STORED_MARKER = '__stored__';/
    );
    expect(
      read('src/chronos/maintenance/ChronosBackgroundHousekeeping.ts')
    ).not.toMatch(/const CRED_STORED_MARKER =/);
    const cs = read('src/ai/credentials/CredentialStore.ts');
    expect(cs).not.toMatch(/const CRED_STORED_MARKER =/);
    expect(cs).toContain(
      "export { CRED_STORED_MARKER } from '@modules/constants';"
    );
  });

  test('B5-1①：`TABLE_NAME` ×5 已按域消歧（不再同名；表名字符串值未改）', () => {
    const stores: Array<[string, string, string]> = [
      ['src/workspace/TaskStore.ts', 'TASKS_TABLE_NAME', "'tasks'"],
      [
        'src/workspace/ProjectItemStore.ts',
        'PROJECT_ITEMS_TABLE_NAME',
        "'project_items'",
      ],
      [
        'src/query/DBTAORCheckpointStorage.ts',
        'TAOR_CHECKPOINTS_TABLE_NAME',
        "'taor_checkpoints'",
      ],
      [
        'src/ai/translation/TranslateHistoryStore.ts',
        'TRANSLATE_HISTORY_TABLE_NAME',
        "'translate_history'",
      ],
      [
        'src/ai/router/SessionRouterStore.ts',
        'SESSION_ROUTER_TABLE_NAME',
        "'router_session_routes'",
      ],
    ];
    for (const [rel, name, value] of stores) {
      const src = read(rel);
      expect(src).not.toMatch(/const TABLE_NAME =/);
      expect(src).toContain(`const ${name} = ${value};`);
    }
  });

  test('B5-1②：`DEFAULT_BASE_URL` ×5 已按域消歧（Ollama 去别名；其余按 provider 改名）', () => {
    const pairs: Array<[string, string]> = [
      ['src/ai/providers/OpenAIProvider.ts', 'OPENAI_PROVIDER_BASE_URL'],
      [
        'src/ai/embedding/providers/OpenAIEmbeddingProvider.ts',
        'OPENAI_EMBEDDING_BASE_URL',
      ],
      ['src/ai/providers/LlamaCppProvider.ts', 'LLAMACPP_PROVIDER_BASE_URL'],
      ['src/ai/providers/GoogleProvider.ts', 'GOOGLE_PROVIDER_BASE_URL'],
    ];
    for (const [rel, name] of pairs) {
      const src = read(rel);
      expect(src).not.toMatch(/const DEFAULT_BASE_URL =/);
      // 不含 `=` 后尾空格：prettier 可能因新名变长而把声明换行
      expect(src).toContain(`const ${name} =`);
    }
    const ollama = read('src/ai/providers/OllamaProvider.ts');
    expect(ollama).not.toContain('DEFAULT_BASE_URL');
    expect(ollama).toContain('DEFAULT_OLLAMA_ENDPOINT');
  });

  test('B5-1③：`CACHE_TTL_MS` ×7 已按域消歧（取值一字未改）', () => {
    // 7 处同名 `CACHE_TTL_MS` 各属**独立缓存**（不同层/不同对象）⇒ 判为「命名太泛」，按域改名消歧、**不得合一**
    const items: Array<[string, string, string]> = [
      [
        'src/ai/models/ActiveModelService.ts',
        'ACTIVE_MODEL_CACHE_TTL_MS',
        '30_000',
      ],
      [
        'src/ai/translation/LanguageDetector.ts',
        'LANGUAGE_DETECTION_CACHE_TTL_MS',
        '5 * 60 * 1000',
      ],
      [
        'src/chat/services/PathGuardService.ts',
        'PATH_GUARD_CACHE_TTL_MS',
        '30_000',
      ],
      [
        'src/config/settings/CheckpointLogConfig.ts',
        'CHECKPOINT_LOG_CACHE_TTL_MS',
        '3_000',
      ],
      [
        'src/services/prompt/PromptVersionManager.ts',
        'PROMPT_VERSION_CACHE_TTL_MS',
        '30_000',
      ],
      [
        'src/tokenBudget/ModelContextCache.ts',
        'MODEL_CONTEXT_CACHE_TTL_MS',
        '5 * 60 * 1000',
      ],
      [
        '../client/src/services/imageService.ts',
        'IMAGE_SERVICE_CACHE_TTL_MS',
        '30_000',
      ],
    ];
    for (const [rel, name, value] of items) {
      const src = read(rel);
      expect(src).not.toMatch(/const CACHE_TTL_MS =/);
      // 断言确切新名 + **取值钉住**（证明"只改名、TTL 数值一字未改"）
      expect(src).toContain(`${name} = ${value};`);
    }
  });

  test('B5-1④：`DEFAULT_TIMEOUT_MS` ×8 已按域消歧（取值一字未改；sandbox 跨文件消费侧同步）', () => {
    // 8 处同名 `DEFAULT_TIMEOUT_MS` 分属不同子系统的**独立超时**（取值 8000 / 30_000 / 60_000 / 180_000 / 300000）
    const items: Array<[string, string, string]> = [
      [
        'src/ai/embedding/providers/LocalEmbeddingProvider.ts',
        'EMBEDDING_DEFAULT_TIMEOUT_MS',
        '180_000',
      ],
      [
        'src/ai/providers/SpeedTestService.ts',
        'SPEED_TEST_DEFAULT_TIMEOUT_MS',
        '8000',
      ],
      [
        'src/evals/adversarialProposer.ts',
        'ADVERSARIAL_DEFAULT_TIMEOUT_MS',
        '60_000',
      ],
      [
        'src/sandbox/utils/TimeoutController.ts',
        'SANDBOX_DEFAULT_TIMEOUT_MS',
        '300000',
      ],
      [
        'src/session/lock/PrioritySessionLock.ts',
        'SESSION_LOCK_DEFAULT_TIMEOUT_MS',
        '30_000',
      ],
      [
        'src/services/mcp/transports/StreamableHttpTransport.ts',
        'MCP_TRANSPORT_DEFAULT_TIMEOUT_MS',
        '30_000',
      ],
      [
        'src/tools/CodeRunner/CrossPlatformRunner.ts',
        'CROSS_PLATFORM_RUNNER_DEFAULT_TIMEOUT_MS',
        '60_000',
      ],
      [
        'src/tools/CodeRunner/CodeRunnerTool.ts',
        'CODE_RUNNER_TOOL_DEFAULT_TIMEOUT_MS',
        '60_000',
      ],
    ];
    for (const [rel, name, value] of items) {
      const src = read(rel);
      expect(src).not.toMatch(/const DEFAULT_TIMEOUT_MS =/);
      // 不含 `=` 后尾空格：prettier 可能因新名变长而把声明换行
      expect(src).toContain(`${name} =`);
      expect(src).toContain(`${value};`);
    }
    // 唯一的**跨文件**消费侧：`sandbox/SandboxManager.ts` 曾从 `TimeoutController` 按旧名导入 ⇒ 同步改名（防"只改定义未改导入"）
    const sandboxMgr = read('src/sandbox/SandboxManager.ts');
    expect(sandboxMgr).not.toMatch(/\bDEFAULT_TIMEOUT_MS/);
    expect(sandboxMgr).toContain('SANDBOX_DEFAULT_TIMEOUT_MS');
  });

  test('B5-1⑤：`MAX_FILE_SIZE` ×6 已按域消歧（取值一字未改；`constants/common.ts` 处为假真源故未动）', () => {
    // 6 处同名 `MAX_FILE_SIZE`：工具侧读取 10 MiB / 编辑·写入 1 GiB / 前端附件 20 MiB（**同值对已登记为合一候选**）
    const items: Array<[string, string, string]> = [
      [
        'src/tools/FileReadTool/FileReadTool.ts',
        'FILE_READ_MAX_FILE_SIZE',
        '10 * 1024 * 1024',
      ],
      [
        'src/tools/FileEditTool/FileEditTool.ts',
        'FILE_EDIT_MAX_FILE_SIZE',
        '1 * 1024 * 1024 * 1024',
      ],
      [
        'src/tools/FileWriteTool/FileWriteTool.ts',
        'FILE_WRITE_MAX_FILE_SIZE',
        '1 * 1024 * 1024 * 1024',
      ],
      [
        '../client/src/components/ChatArea/FileAttachmentBar.tsx',
        'ATTACHMENT_MAX_FILE_SIZE',
        '20 * 1024 * 1024',
      ],
      [
        '../client/src/components/ChatArea/ChatInput.tsx',
        'CHAT_INPUT_ATTACHMENT_MAX_FILE_SIZE',
        '20 * 1024 * 1024',
      ],
    ];
    for (const [rel, name, value] of items) {
      const src = read(rel);
      expect(src).not.toMatch(/const MAX_FILE_SIZE =/);
      expect(src).toContain(`${name} = ${value};`);
    }
    // `app/src/constants/common.ts` 的该名**零消费者**（假真源）⇒ 本片**有意未动**（删除需 CD01–CD06 六步核查，属另案）
    expect(read('src/constants/common.ts')).toContain(
      'export const MAX_FILE_SIZE ='
    );
  });

  test('B5-2①：`DEFAULT_TTL_MS` ×9 已按域消歧（取值一字未改）', () => {
    // 9 处同名 `DEFAULT_TTL_MS` 各属**独立缓存/锁**（60_000 ×3 · 5min ×2 · 1h ×2 · 30min · 300_000）
    const items: Array<[string, string, string]> = [
      ['src/cost/DailyCostCache.ts', 'DAILY_COST_CACHE_TTL_MS', '60_000'],
      ['src/tasks/CrossProcessLock.ts', 'CROSS_PROCESS_LOCK_TTL_MS', '60_000'],
      [
        'src/core/cache/SessionCache.ts',
        'SESSION_CACHE_TTL_MS',
        '5 * 60 * 1000',
      ],
      [
        'src/core/approval/ApprovalCache.ts',
        'APPROVAL_CACHE_TTL_MS',
        '5 * 60 * 1000',
      ],
      [
        'src/memory/FrozenSnapshotService.ts',
        'FROZEN_SNAPSHOT_TTL_MS',
        '60 * 60 * 1000',
      ],
      [
        'src/media/image/TempFileManager.ts',
        'TEMP_FILE_TTL_MS',
        '30 * 60 * 1000',
      ],
      [
        'src/permission/ApprovedCommandRegistry.ts',
        'APPROVED_COMMAND_TTL_MS',
        '300_000',
      ],
      [
        'src/tools/ImageGenerateTool/ImageGenerationCache.ts',
        'IMAGE_GENERATION_CACHE_TTL_MS',
        '3600 * 1000',
      ],
      [
        'src/services/file/FileStatsService.ts',
        'FILE_STATS_CACHE_TTL_MS',
        '60_000',
      ],
    ];
    for (const [rel, name, value] of items) {
      const src = read(rel);
      expect(src).not.toMatch(/const DEFAULT_TTL_MS =/);
      expect(src).toContain(`${name} = ${value};`);
    }
  });

  test('B5-2②：`SCHEMA` ×6 已按域消歧（DDL 目标表未改；tasks 公开导出面同步改名）', () => {
    // 6 处同名 `SCHEMA` 各是**不同表的 SQL DDL** ⇒ 按域消歧（DDL 文本一字未改）
    const items: Array<[string, string, string]> = [
      [
        'src/dream/DreamCycleDb.ts',
        'DREAM_CYCLE_SCHEMA',
        'CREATE TABLE IF NOT EXISTS dream_cycles',
      ],
      [
        'src/tasks/db/schema.ts',
        'TASKS_SCHEMA',
        'CREATE TABLE IF NOT EXISTS task_states',
      ],
      [
        'src/tasks/cron/DeliveryQueue.ts',
        'DELIVERY_QUEUE_SCHEMA',
        'CREATE TABLE IF NOT EXISTS delivery_queue',
      ],
      [
        'src/tasks/cron/CronRunLog.ts',
        'CRON_RUN_LOG_SCHEMA',
        'CREATE TABLE IF NOT EXISTS ${TABLE_CRON_RUN_LOGS}',
      ],
      [
        'src/tasks/cron/CronJobStore.ts',
        'CRON_JOB_SCHEMA',
        'CREATE TABLE IF NOT EXISTS cron_jobs',
      ],
      [
        'src/modules/calendar/AIScheduleIndex.ts',
        'AI_SCHEDULE_SCHEMA',
        'CREATE TABLE IF NOT EXISTS ai_schedules',
      ],
    ];
    for (const [rel, name, table] of items) {
      const src = read(rel);
      expect(src).not.toMatch(/const SCHEMA = /);
      expect(src).toContain(`const ${name} =`);
      expect(src).toContain(table);
    }
    // `tasks/db/schema.ts` 的 `TASKS_SCHEMA` 属**公开导出面** ⇒ 2 import + 2 barrel 转出 + 1 seed 脚本**全部同步**
    // ⚠️ 只断言**标识符**，不钉 import/export 语句的单行形态 —— prettier 会按行宽把长 import 折成多行
    for (const rel of [
      'src/tasks/db/SqliteTaskStore.ts',
      'src/tasks/db/GoalMetricsService.ts',
      'src/tasks/db/index.ts',
      'src/tasks/index.ts',
    ]) {
      expect(read(rel)).toContain('TASKS_SCHEMA');
    }
    const seed = read('scripts/seed-test-tasks.ts');
    expect(seed).toContain('TASKS_SCHEMA');
    expect(seed).not.toContain('as TASK_SCHEMA');
  });

  test('B5-2③：`REQUEST_TIMEOUT_MS` ×5 已按域消歧（取值一字未改）', () => {
    // 5 处同名 `REQUEST_TIMEOUT_MS` 全为**文件内局部**（无 export），取值 5 个全不同
    const items: Array<[string, string, string]> = [
      [
        'src/ai/providers/BalanceChecker.ts',
        'BALANCE_CHECK_REQUEST_TIMEOUT_MS',
        '10000',
      ],
      [
        'src/channels/bluebubbles/BlueBubblesChannel.ts',
        'BLUEBUBBLES_REQUEST_TIMEOUT_MS',
        '20000',
      ],
      [
        'src/channels/mattermost/MattermostChannel.ts',
        'MATTERMOST_REQUEST_TIMEOUT_MS',
        '15000',
      ],
      [
        'src/services/voice/services/senseVoiceSTTProvider.ts',
        'SENSEVOICE_STT_REQUEST_TIMEOUT_MS',
        '60_000',
      ],
      [
        'src/services/voice/services/localSTTProvider.ts',
        'LOCAL_STT_REQUEST_TIMEOUT_MS',
        '30_000',
      ],
    ];
    for (const [rel, name, value] of items) {
      const src = read(rel);
      expect(src).not.toMatch(/const REQUEST_TIMEOUT_MS = /);
      expect(src).toContain(`${name} = ${value};`);
    }
  });

  test('B5-2④：`MAX_CACHE_SIZE` ×4 已按域消歧（取值/单位一字未改）', () => {
    // 4 处同名 `MAX_CACHE_SIZE` 单位各异：字节（通用 100 MiB）· 条数（1000 / 10000 / 100）
    const items: Array<[string, string, string]> = [
      ['src/constants/common.ts', 'MAX_CACHE_SIZE_BYTES', '100 * 1024 * 1024'],
      [
        'src/ink/ink/line-width-cache.ts',
        'LINE_WIDTH_CACHE_MAX_ENTRIES',
        '1000',
      ],
      [
        'src/tokenBudget/ModelContextCache.ts',
        'MODEL_CONTEXT_CACHE_MAX_ENTRIES',
        '10000',
      ],
      [
        'src/tools/ImageGenerateTool/ImageGenerationCache.ts',
        'IMAGE_GENERATION_CACHE_MAX_ENTRIES',
        '100',
      ],
    ];
    for (const [rel, name, value] of items) {
      const src = read(rel);
      expect(src).not.toMatch(/const MAX_CACHE_SIZE = /);
      expect(src).toContain(`${name} = ${value};`);
    }
  });

  test('B5-2⑤：`CACHE_TTL` ×4 已按域消歧（取值一字未改）', () => {
    // 4 处同名 `CACHE_TTL`：ink 行宽缓存 60s · LSP schema 缓存 60s · 缩略图 30min · 能力列表 5min
    const items: Array<[string, string, string]> = [
      ['src/ink/ink/line-width-cache.ts', 'LINE_WIDTH_CACHE_TTL_MS', '60000'],
      ['src/lsp/schemas.ts', 'LSP_SCHEMA_CACHE_TTL_MS', '60000'],
      [
        '../client/src/components/views/media/thumbCache.ts',
        'THUMB_CACHE_TTL_MS',
        '30 * 60 * 1000',
      ],
      [
        '../client/src/services/capabilityService.ts',
        'CAPABILITY_CACHE_TTL_MS',
        '5 * 60 * 1000',
      ],
    ];
    for (const [rel, name, value] of items) {
      const src = read(rel);
      expect(src).not.toMatch(/const CACHE_TTL = /);
      expect(src).toContain(`${name} = ${value};`);
    }
  });

  test('B5-2⑥：`FENCE_RE` ×4 已按域消歧（正则一字未改）', () => {
    // 4 处同名 `FENCE_RE`：2 处**围栏行**正则（`^\s*```）· 2 处**围栏块**正则（```…```）
    const items: Array<[string, string, string]> = [
      ['src/utils/structureCut.ts', 'STRUCTURE_CUT_FENCE_RE', '/^\\s*```/'],
      [
        'src/channels/messageSplitter.ts',
        'MESSAGE_SPLITTER_FENCE_RE',
        '/^\\s*```/',
      ],
      [
        'src/chat/services/bareExplorationStripper.ts',
        'BARE_EXPLORATION_FENCE_RE',
        '/```[\\s\\S]*?```/g',
      ],
      [
        '../client/src/stores/chat/chat-toolcall.slice.ts',
        'CHAT_TOOLCALL_FENCE_RE',
        '/```[\\s\\S]*?```/g',
      ],
    ];
    for (const [rel, name, re] of items) {
      const src = read(rel);
      expect(src).not.toMatch(/const FENCE_RE = /);
      expect(src).toContain(`${name} = ${re};`);
    }
  });

  test('B5-2⑦：`MAX_FILES` ×5 已按域消歧（取值一字未改；含扫描面外 1 处脚本）', () => {
    // 5 处同名 `MAX_FILES`：4 处在门禁扫描面（app/src）+ 1 处在扫描面外（app/scripts 基准脚本）
    const items: Array<[string, string, string]> = [
      ['src/tools/GlobTool/GlobTool.ts', 'GLOB_TOOL_MAX_FILES', '100'],
      [
        'src/context/promptSections/builtinSections.ts',
        'BUILTIN_SECTION_MAX_FILES',
        '20',
      ],
      [
        'src/infrastructure/http/handlers/project-artifact-handlers.ts',
        'PROJECT_ARTIFACT_MAX_FILES',
        '500',
      ],
      [
        'src/skills/loaders/adapter/clawhub/ClawHubInstaller.ts',
        'CLAWHUB_INSTALL_MAX_FILES',
        '50',
      ],
      ['scripts/bench-truncation-closure.ts', 'BENCH_MAX_FILES', '400'],
    ];
    for (const [rel, name, value] of items) {
      const src = read(rel);
      expect(src).not.toMatch(/const MAX_FILES = /);
      expect(src).toContain(`${name} = ${value};`);
    }
    // 同族**后缀名** `MAX_FILES_PER_REPLY` 是另一个标识符（非本键）⇒ 有意未动
    expect(read('src/channels/routing/outboundFileRouter.ts')).toContain(
      'MAX_FILES_PER_REPLY'
    );
  });

  test('B5-2⑧：`MAX_HISTORY` ×4 已按域消歧（取值一字未改；全在 client 侧）', () => {
    // 4 处同名 `MAX_HISTORY` **全在 client**：图像任务历史 50 · TTS 试听台 100 · STT 测试页 50 · 连接监控 20
    const items: Array<[string, string, string]> = [
      [
        '../client/src/components/views/image/taskHistoryStore.ts',
        'IMAGE_TASK_MAX_HISTORY',
        '50',
      ],
      [
        '../client/src/components/views/TTSPlayground.tsx',
        'TTS_PLAYGROUND_MAX_HISTORY',
        '100',
      ],
      [
        '../client/src/components/views/STTTestPage.tsx',
        'STT_TEST_MAX_HISTORY',
        '50',
      ],
      [
        '../client/src/services/connectionMonitor.ts',
        'CONNECTION_MONITOR_MAX_HISTORY',
        '20',
      ],
    ];
    for (const [rel, name, value] of items) {
      const src = read(rel);
      expect(src).not.toMatch(/const MAX_HISTORY = /);
      expect(src).toContain(`${name} = ${value};`);
    }
    // 同族**后缀名** `MAX_HISTORY_ENTRIES`（app 侧压缩指标）是另一个标识符（非本键）⇒ 有意未动
    expect(read('src/context/compaction/CompactionMetrics.ts')).toContain(
      'MAX_HISTORY_ENTRIES'
    );
  });

  test('B5-2⑨：`MAX_STREAM_AGE_MS` ×4 已按渠道消歧（取值一字未改）', () => {
    // 4 处同名 `MAX_STREAM_AGE_MS` 分属 4 个渠道的流式消息模块（45000 / 300000 / 60000 / 900000）
    const items: Array<[string, string, string]> = [
      [
        'src/channels/msteams/streaming-message.ts',
        'MSTEAMS_MAX_STREAM_AGE_MS',
        '45000',
      ],
      [
        'src/channels/matrix/streaming-message.ts',
        'MATRIX_MAX_STREAM_AGE_MS',
        '300000',
      ],
      [
        'src/channels/feishu/streaming-card.ts',
        'FEISHU_MAX_STREAM_AGE_MS',
        '60000',
      ],
      [
        'src/channels/discord/streaming-message.ts',
        'DISCORD_MAX_STREAM_AGE_MS',
        '900000',
      ],
    ];
    for (const [rel, name, value] of items) {
      const src = read(rel);
      expect(src).not.toMatch(/const MAX_STREAM_AGE_MS = /);
      expect(src).toContain(`${name} = ${value};`);
    }
  });

  test('B5-2⑩：`MAX_RECONNECT_ATTEMPTS` ×4 已按域消歧（取值一字未改；含 QQ 导出真源 + 消费侧同步）', () => {
    // 4 处同名 `MAX_RECONNECT_ATTEMPTS`：QQ 渠道导出真源 50；会话 WS / MCP 管理器 / MCP client 各 5
    const items: Array<[string, string, string]> = [
      ['src/channels/qq/types.ts', 'QQ_MAX_RECONNECT_ATTEMPTS', '50'],
      [
        'src/session/websocket/SessionsWebSocket.ts',
        'SESSIONS_WS_MAX_RECONNECT_ATTEMPTS',
        '5',
      ],
      [
        'src/services/mcp/MCPConnectionManager.ts',
        'MCP_MANAGER_MAX_RECONNECT_ATTEMPTS',
        '5',
      ],
      ['src/services/mcp/client.ts', 'MCP_CLIENT_MAX_RECONNECT_ATTEMPTS', '5'],
    ];
    for (const [rel, name, value] of items) {
      const src = read(rel);
      expect(src).not.toMatch(/const MAX_RECONNECT_ATTEMPTS = /);
      expect(src).toContain(`${name} = ${value};`);
    }
    // QQ 处属**导出真源** ⇒ 消费侧 `QQChannel` 已同步（只断言**标识符**，不钉 import 单行形态）
    expect(read('src/channels/qq/QQChannel.ts')).toContain(
      'QQ_MAX_RECONNECT_ATTEMPTS'
    );
    // 同族**前缀名** `WS_MAX_RECONNECT_ATTEMPTS`（飞书渠道，另一标识符）非本键 ⇒ 未动
    expect(read('src/channels/feishu/FeishuChannel.ts')).toContain(
      'WS_MAX_RECONNECT_ATTEMPTS'
    );
  });

  test('B5-2⑪：`CLEANUP_INTERVAL_MS` ×4 已按域消歧（取值一字未改）', () => {
    // 4 处同名 `CLEANUP_INTERVAL_MS`：chronos 日清 24h · 临时文件 5min · 画布实例 5min · 已批准命令 30s
    const items: Array<[string, string, string]> = [
      [
        'src/chronos/maintenance/cleanup.ts',
        'CHRONOS_CLEANUP_INTERVAL_MS',
        '24 * 60 * 60 * 1000',
      ],
      [
        'src/media/image/TempFileManager.ts',
        'TEMP_FILE_CLEANUP_INTERVAL_MS',
        '5 * 60 * 1000',
      ],
      [
        'src/tools/CanvasTool/CanvasTool.ts',
        'CANVAS_CLEANUP_INTERVAL_MS',
        '5 * 60 * 1000',
      ],
      [
        'src/permission/ApprovedCommandRegistry.ts',
        'APPROVED_COMMAND_CLEANUP_INTERVAL_MS',
        '30_000',
      ],
    ];
    for (const [rel, name, value] of items) {
      const src = read(rel);
      expect(src).not.toMatch(/const CLEANUP_INTERVAL_MS = /);
      expect(src).toContain(`${name} = ${value};`);
    }
    // 同族**前缀名** `RECURRING_`/`DEFAULT_CLEANUP_INTERVAL_MS`（另两个标识符）非本键 ⇒ 有意未动
    expect(
      read('src/chronos/maintenance/ChronosBackgroundHousekeeping.ts')
    ).toContain('RECURRING_CLEANUP_INTERVAL_MS');
    expect(read('src/channels/dedup/index.ts')).toContain(
      'DEFAULT_CLEANUP_INTERVAL_MS'
    );
  });

  test('B5-2⑫：`DEFAULT_IDLE_TIMEOUT_MS` ×2 已按域消歧（取值一字未改）', () => {
    // 2 处同名 `DEFAULT_IDLE_TIMEOUT_MS` 同值 30min 异事实：ACP 会话空闲回收 · 空闲降载监控（P3-5）
    const items: Array<[string, string, string]> = [
      ['src/acp/session.ts', 'ACP_SESSION_IDLE_TIMEOUT_MS', '30 * 60 * 1000'],
      [
        'src/core/idle/IdleScaleMonitor.ts',
        'IDLE_SCALE_TIMEOUT_MS',
        '30 * 60_000',
      ],
    ];
    for (const [rel, name, value] of items) {
      const src = read(rel);
      expect(src).not.toMatch(/const DEFAULT_IDLE_TIMEOUT_MS = /);
      expect(src).toContain(`${name} = ${value};`);
    }
    // 同族**后缀名** `STREAM_IDLE_TIMEOUT_MS`/`REPL_IDLE_TIMEOUT_MS`（另两个标识符）非本键 ⇒ 有意未动
    expect(read('src/channels/routing/messageRouterContract.ts')).toContain(
      'STREAM_IDLE_TIMEOUT_MS'
    );
    expect(read('src/tools/notebook/NotebookToolImpl.ts')).toContain(
      'REPL_IDLE_TIMEOUT_MS'
    );
    // 裸 `IDLE_TIMEOUT_MS`（auth-code-listener，另一标识符）非本键 ⇒ 有意未动
    expect(read('src/system/auth/auth-code-listener.ts')).toContain(
      'const IDLE_TIMEOUT_MS = '
    );
  });

  test('B5-2⑬：`DISPLAY_PREFIX` ×3 已按域消歧（取值一字未改）', () => {
    // 3 处同名 `DISPLAY_PREFIX` **全为文件内私有**（无 export/消费面），取值各异
    const items: Array<[string, string, string]> = [
      [
        'src/tools/AudioUrlHelper.ts',
        'AUDIO_DISPLAY_PREFIX',
        "'/v1/audio/static/'",
      ],
      [
        'src/tools/ImageUrlHelper.ts',
        'IMAGE_DISPLAY_PREFIX',
        "'/v1/images/static/media/'",
      ],
      [
        'src/tools/VideoUrlHelper.ts',
        'VIDEO_DISPLAY_PREFIX',
        "'/v1/videos/static/'",
      ],
    ];
    for (const [rel, name, value] of items) {
      const src = read(rel);
      expect(src).not.toMatch(/const DISPLAY_PREFIX = /);
      expect(src).toContain(`${name} = ${value};`);
    }
  });

  test('B5-2⑭：`MIN_INITIAL_CHARS` ×3 已按渠道消歧（取值一字未改）', () => {
    // 3 处同名 `MIN_INITIAL_CHARS`（最小首包字符数）各受渠道上游约束，取值全不同、全为文件内私有
    const items: Array<[string, string, string]> = [
      [
        'src/channels/discord/streaming-message.ts',
        'DISCORD_MIN_INITIAL_CHARS',
        '10',
      ],
      [
        'src/channels/matrix/streaming-message.ts',
        'MATRIX_MIN_INITIAL_CHARS',
        '15',
      ],
      [
        'src/channels/msteams/streaming-message.ts',
        'MSTEAMS_MIN_INITIAL_CHARS',
        '20',
      ],
    ];
    for (const [rel, name, value] of items) {
      const src = read(rel);
      expect(src).not.toMatch(/const MIN_INITIAL_CHARS = /);
      expect(src).toContain(`${name} = ${value};`);
    }
  });

  test('B5-2⑮：`POLL_INTERVAL_MS` ×3 已按域消歧（取值一字未改）', () => {
    // 3 处同名 `POLL_INTERVAL_MS`（轮询间隔）分属 3 个独立域，取值全不同、全为文件内私有
    const items: Array<[string, string, string]> = [
      [
        'src/channels/bluebubbles/monitor.ts',
        'BLUEBUBBLES_POLL_INTERVAL_MS',
        '8000',
      ],
      [
        '../client/src/components/settings/AgentTaskSettings.tsx',
        'AGENT_TASK_POLL_INTERVAL_MS',
        '5000',
      ],
      [
        'src/ai/providers/ReplicateProvider.ts',
        'REPLICATE_POLL_INTERVAL_MS',
        '2000',
      ],
    ];
    for (const [rel, name, value] of items) {
      const src = read(rel);
      expect(src).not.toMatch(/const POLL_INTERVAL_MS = /);
      expect(src).toContain(`${name} = ${value};`);
    }
    // 同族**非本键**名仍在（不得误伤）：`POLL_INTERVAL` ×3 与 `POLL_INTERVAL_QR_MS` / `POLL_MAX_ATTEMPTS`
    expect(read('src/ai/providers/ReplicateProvider.ts')).toContain(
      'const POLL_MAX_ATTEMPTS = 60;'
    );
    expect(read('../client/src/services/sseService.ts')).toContain(
      'const POLL_INTERVAL = 15000;'
    );
  });

  test('B5-2⑯：`DEFAULT_THROTTLE_MS` ×3 已按渠道消歧（取值一字未改）', () => {
    // 3 处同名 `DEFAULT_THROTTLE_MS`（流式更新节流间隔）各受渠道上游限流约束，取值全不同、全为文件内私有
    const items: Array<[string, string, string]> = [
      [
        'src/channels/discord/streaming-message.ts',
        'DISCORD_DEFAULT_THROTTLE_MS',
        '800',
      ],
      [
        'src/channels/matrix/streaming-message.ts',
        'MATRIX_DEFAULT_THROTTLE_MS',
        '1000',
      ],
      [
        'src/channels/msteams/streaming-message.ts',
        'MSTEAMS_DEFAULT_THROTTLE_MS',
        '1500',
      ],
    ];
    for (const [rel, name, value] of items) {
      const src = read(rel);
      expect(src).not.toMatch(/const DEFAULT_THROTTLE_MS = /);
      expect(src).toContain(`${name} = ${value};`);
    }
    // 同族**非本键**名仍在（不得误伤）：飞书流式卡片节流
    expect(read('src/channels/feishu/streaming-card.ts')).toContain(
      'const STREAMING_UPDATE_THROTTLE_MS = 160;'
    );
  });

  test('B5-2⑰：`MAX_DEPTH` ×3 已按域消歧（取值一字未改）', () => {
    // 3 处同名 `MAX_DEPTH`（深度上限）分属三个独立域，取值 2 种、全为文件内私有
    const items: Array<[string, string, string]> = [
      [
        'src/diagnostics/loopProbe/phaseStack.ts',
        'PHASE_STACK_MAX_DEPTH',
        '64',
      ],
      ['src/commands/builtin/files/Files.ts', 'FILES_MAX_DEPTH', '4'],
      [
        'src/infrastructure/http/handlers/project-artifact-handlers.ts',
        'PROJECT_ARTIFACT_MAX_DEPTH',
        '4',
      ],
    ];
    for (const [rel, name, value] of items) {
      const src = read(rel);
      expect(src).not.toMatch(/const MAX_DEPTH = /);
      expect(src).toContain(`${name} = ${value};`);
    }
    // 同族**非本键**名仍在（不得误伤）：`DEFAULT_ROOT_CAUSE_MAX_DEPTH`（systemgraph 导出真源）
    expect(read('src/core/systemgraph/SystemGraph.ts')).toContain(
      'export const DEFAULT_ROOT_CAUSE_MAX_DEPTH = 5;'
    );
    // tests 侧同名局部别名一并消歧（非门禁扫描面，但全仓不再有同名定义）
    expect(
      read('tests/tools/AgentTool/agentDelegationGrant.test.ts')
    ).toContain(
      'const SUBAGENT_MAX_DEPTH = getTaskConcurrencyLimits().subagentDepth;'
    );
  });

  test('B5-2⑱：`SUBCOMMANDS` ×3 已按域消歧（取值一字未改）', () => {
    // 3 处同名 `SUBCOMMANDS`（各命令自己的子命令清单）分属 3 个命令模块，全为文件内私有
    for (const rel of [
      'src/commands/tools/dev/notebook.ts',
      'src/commands/tools/ai/agents.ts',
      'src/commands/tools/ai/agent.ts',
    ]) {
      expect(read(rel)).not.toMatch(/const SUBCOMMANDS = /);
    }
    expect(read('src/commands/tools/dev/notebook.ts')).toContain(
      'const NOTEBOOK_SUBCOMMANDS = new Set(['
    );
    expect(read('src/commands/tools/ai/agents.ts')).toContain(
      "const AGENTS_SUBCOMMANDS = ['list', 'create', 'delete', 'help'] as const;"
    );
    expect(read('src/commands/tools/ai/agent.ts')).toContain(
      "const AGENT_SUBCOMMANDS = ['run', 'list', 'status', 'stop', 'bg-list'] as const;"
    );
    // 同族**非本键**名仍在（不得误伤）：git 子命令表 / git 只读子命令集
    expect(read('src/security/git/gitSafety.ts')).toContain(
      'const GIT_SUBCOMMANDS: GitSubcommandInfo[] = ['
    );
    expect(read('src/security/readOnlyValidation.ts')).toContain(
      'const GIT_READ_ONLY_SUBCOMMANDS = new Set(['
    );
  });

  test('B5-2⑲：`COLORS` ×3 已按域消歧（取值一字未改）', () => {
    // 3 处同名 `COLORS` 分属 toast 样式表 / 画布调色板 / 头像底色，全为文件内私有
    const toast = '../client/src/components/common/ToastContainer.tsx';
    const canvas =
      '../client/src/components/views/image/canvas-editor/components/CanvasToolbar.tsx';
    const avatar = 'src/components/ui/Avatar.tsx';
    for (const rel of [toast, canvas, avatar]) {
      expect(read(rel)).not.toMatch(/const COLORS = [{\[]/);
    }
    expect(read(toast)).toContain('const TOAST_TYPE_COLORS = {');
    expect(read(toast)).toContain('const c = TOAST_TYPE_COLORS[toast.type];');
    expect(read(canvas)).toContain('const CANVAS_TOOLBAR_COLORS = [');
    expect(read(canvas)).toContain('{CANVAS_TOOLBAR_COLORS.map((c) => (');
    expect(read(avatar)).toContain('const AVATAR_COLORS = [');
    expect(read(avatar)).toContain(
      'return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];'
    );
    // 同族**非本键**名仍在（不得误伤）：`*_COLORS` 语义化命名
    expect(
      read('../client/src/components/modelAdmin/ModelSwitcher.tsx')
    ).toContain('const PROVIDER_COLORS: Record<string, string> = {');
    expect(
      read('../client/src/components/Memory/memoryConstants.ts')
    ).toContain('export const TYPE_COLORS: Record<MemoryType, string> = {');
  });

  test('B5-2⑳：`BINARY_EXTENSIONS` 已收敛为单一真源（内容一字未改）', () => {
    // 真源：`constants/files.ts`（导出 + 自带 `hasBinaryExtension` 助手）—— 本片**有意保留原名**
    expect(read('src/constants/files.ts')).toContain(
      'export const BINARY_EXTENSIONS = new Set(['
    );
    expect(read('src/constants/files.ts')).toContain(
      'return BINARY_EXTENSIONS.has(ext);'
    );
    // knowledge-handlers.ts：原**两处函数级同名副本**⇒ 合一为模块级单一真源
    const kh = read('src/infrastructure/http/handlers/knowledge-handlers.ts');
    expect(kh).toContain(
      'const KNOWLEDGE_CONVERT_BINARY_EXTENSIONS = new Set(['
    );
    expect(kh).not.toMatch(/(^|[^_])BINARY_EXTENSIONS\b/);
    // FileReadTool.ts：该文件自带一份**不同**清单 ⇒ 按域消歧
    const frt = read('src/tools/FileReadTool/FileReadTool.ts');
    expect(frt).toContain('const FILE_READ_BINARY_EXTENSIONS = new Set([');
    expect(frt).toContain('if (FILE_READ_BINARY_EXTENSIONS.has(ext)) {');
    expect(frt).not.toMatch(/(^|[^_])BINARY_EXTENSIONS\b/);
  });

  test('B5-2㉑：`DEFAULT_MAX_RESULT_SIZE_CHARS` 已收敛为单一真源（重复导出面保留）', () => {
    // 真源：`constants/toolLimits.ts`（唯一保留定义处）
    expect(read('src/constants/toolLimits.ts')).toContain(
      'export const DEFAULT_MAX_RESULT_SIZE_CHARS = 50_000;'
    );
    // `context/budget`：删本地私有副本 ⇒ 改引用真源
    const budget = read('src/context/budget/ToolResultBudget.ts');
    expect(budget).not.toMatch(/const DEFAULT_MAX_RESULT_SIZE_CHARS = /);
    expect(budget).toContain(
      "import { DEFAULT_MAX_RESULT_SIZE_CHARS } from '@modules/constants';"
    );
    // `services/toolResultStorage`：仅保留**导出面**（re-export 真源，消费者零改动）
    const storage = read('src/services/toolResultStorage/types.ts');
    expect(storage).not.toMatch(/const DEFAULT_MAX_RESULT_SIZE_CHARS = /);
    expect(storage).toContain(
      "export { DEFAULT_MAX_RESULT_SIZE_CHARS } from '@modules/constants';"
    );
    // 同族**非本键**：`BYTES_PER_TOKEN` 的 B2 收口形态仍在（不得误伤）
    expect(storage).toContain(
      "export { BYTES_PER_TOKEN } from '@modules/constants';"
    );
  });
});
