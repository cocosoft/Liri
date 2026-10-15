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
    // 同族**非本键**名仍在（不得误伤）：`POLL_MAX_ATTEMPTS`（app）/ `POLL_INTERVAL_QR_MS`（wechat）
    // 注：原先此处钉的 `POLL_INTERVAL` ×3 已于 **B5-2㉓** 消歧 ⇒ 改钉其余同族名
    expect(read('src/ai/providers/ReplicateProvider.ts')).toContain(
      'const POLL_MAX_ATTEMPTS = 60;'
    );
    expect(read('src/channels/wechat/cli-manager.ts')).toContain(
      'const POLL_INTERVAL_QR_MS = 1_500;'
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

  test('B5-2㉒：`CURRENT_SCHEMA_VERSION` ×3 已按域消歧（真源保留 + 两处私有副本改名）', () => {
    // memory：导出真源，被 `MemorySchemaRegistry` 消费 ⇒ **有意保留原名**
    expect(read('src/memory/types/MemoryMetadata.ts')).toContain(
      'export const CURRENT_SCHEMA_VERSION = 2;'
    );
    expect(read('src/memory/types/MemorySchemaRegistry.ts')).toContain(
      "import { CURRENT_SCHEMA_VERSION } from './MemoryMetadata';"
    );
    // knowledge：文件私有（值 1）⇒ 按域消歧
    const kh = read('src/knowledge/KnowledgeSchemaMigration.ts');
    expect(kh).not.toMatch(/const CURRENT_SCHEMA_VERSION = /);
    expect(kh).toContain('const KNOWLEDGE_SCHEMA_VERSION = 1;');
    // context：文件私有，且为**字符串**版本（'1.0'）⇒ 按域消歧
    const ctx = read('src/context/persistence/ContextPersistence.ts');
    expect(ctx).not.toMatch(/const CURRENT_SCHEMA_VERSION = /);
    expect(ctx).toContain("const CONTEXT_PERSISTENCE_SCHEMA_VERSION = '1.0';");
  });

  test('B5-2㉓：`POLL_INTERVAL` ×3 已按域消歧（取值一字未改）', () => {
    // 3 处同名 `POLL_INTERVAL` 全在 client 侧、全为文件内私有，取值各异、分属独立域
    const items: Array<[string, string, string]> = [
      [
        '../client/src/components/Knowledge/useCompilePolling.ts',
        'COMPILE_POLL_INTERVAL_MS',
        '1000',
      ],
      [
        '../client/src/hooks/useVideoTaskPolling.ts',
        'VIDEO_TASK_POLL_INTERVAL_MS',
        '2000',
      ],
      [
        '../client/src/services/sseService.ts',
        'SSE_FALLBACK_POLL_INTERVAL_MS',
        '15000',
      ],
    ];
    for (const [rel, name, value] of items) {
      const src = read(rel);
      expect(src).not.toMatch(/(^|[^_])POLL_INTERVAL\b/);
      expect(src).toContain(`${name} = ${value};`);
    }
    // 消费点与**注释**同步改指新名（防"只改定义、未改用法/注释"）
    const sse = read('../client/src/services/sseService.ts');
    expect(sse).toContain('}, SSE_FALLBACK_POLL_INTERVAL_MS);');
    expect(sse).toContain('每隔 SSE_FALLBACK_POLL_INTERVAL_MS 调用');
  });

  test('B5-2㉔：`ENABLED` ×3 已按域消歧（取值表达式一字未改）', () => {
    // 3 处同名 `ENABLED`（各模块自己的开关）全为文件内私有，取值均为 env 表达式
    const items: Array<[string, string, string]> = [
      [
        'src/monitoring/memProfile.ts',
        'MEM_PROFILE_ENABLED',
        "configManager.env('MEM_PROFILE') === '1'",
      ],
      [
        'src/monitoring/memoryPressure/MemoryPressureMonitor.ts',
        'MEM_PRESSURE_ENABLED',
        "configManager.env('MEM_PRESSURE') !== '0'",
      ],
      [
        'src/query/queryProfiler.ts',
        'QUERY_PROFILER_ENABLED',
        "process.env?.Liri_PROFILE_QUERY === '1'",
      ],
    ];
    for (const [rel, name, value] of items) {
      const src = read(rel);
      expect(src).not.toMatch(/(^|[^_A-Za-z])const ENABLED\b/);
      expect(src).toContain(`const ${name}`);
      expect(src).toContain(value);
    }
    // tests 侧同名别名一并消歧（非门禁扫描面，但全仓不再有同名定义）
    const e2e = read('tests/evals/pathShieldSandboxE2E.test.ts');
    expect(e2e).not.toMatch(/(^|[^_A-Za-z])const ENABLED\b/);
    expect(e2e).toContain(
      "const PATH_SHIELD_E2E_ENABLED = process.env.PERMISSION_SHIELD_E2E === '1';"
    );
  });

  test('B5-2㉕：`DEFAULT_CONFIG` ×3 已按域消歧（内容一字未改）', () => {
    // 门禁口径为 `^\s*(export )?const NAME =`（**无类型标注**、同行 `=`）
    // ⇒ 本键的 3 个命中文件 = 三家 STT 提供者的默认配置
    const items: Array<[string, string, string]> = [
      [
        'src/services/voice/services/cloudSTTProvider.ts',
        'CLOUD_STT_DEFAULT_CONFIG',
        "model: 'whisper-1'",
      ],
      [
        'src/services/voice/services/localSTTProvider.ts',
        'LOCAL_STT_DEFAULT_CONFIG',
        "model: 'base'",
      ],
      [
        'src/services/voice/services/senseVoiceSTTProvider.ts',
        'SENSE_VOICE_STT_DEFAULT_CONFIG',
        "model: 'SenseVoiceSmall'",
      ],
    ];
    for (const [rel, name, value] of items) {
      const src = read(rel);
      expect(src).not.toMatch(/(^|[^_A-Za-z])const DEFAULT_CONFIG\s*=/);
      expect(src).toContain(`const ${name} = {`);
      expect(src).toContain(value);
      expect(src).toContain(`{ ...${name}, ...config }`);
    }
    // ⚠️ 同族**盲区观察**（仅登记，本片未动）：带类型写法 ⇒ 门禁正则看不见
    expect(read('src/services/voice/services/streamSTTProvider.ts')).toContain(
      'const DEFAULT_CONFIG: StreamSTTConfig = {'
    );
  });

  test('B5-2㉖：`DEFAULT_TIMEOUT` ×3 已按域消歧（取值一字未改）', () => {
    // **声明处保留**：client services 层通用 HTTP 超时（零外部消费者，保留原语义位）
    expect(read('../client/src/services/httpUtils.ts')).toContain(
      'export const DEFAULT_TIMEOUT = 30_000;'
    );
    // toolService：工具调用超时 ⇒ 消歧（不引入行为耦合）
    const tool = read('../client/src/services/toolService.ts');
    expect(tool).not.toMatch(/(^|[^_A-Za-z])const DEFAULT_TIMEOUT\s*=/);
    expect(tool).toContain('const TOOL_CALL_DEFAULT_TIMEOUT_MS = 30_000;');
    expect(tool).toContain('opts?.timeout ?? TOOL_CALL_DEFAULT_TIMEOUT_MS');
    // SessionLock（`app/src/session/**` = **CD07 关键域** ⇒ 仅改名、不删实现）：
    // 取锁超时 ⇒ 消歧；名字**避开**既有 `SESSION_LOCK_DEFAULT_TIMEOUT_MS`（免生新同名键）
    const lock = read('src/session/SessionLock.ts');
    expect(lock).not.toMatch(/(^|[^_A-Za-z])const DEFAULT_TIMEOUT\s*=/);
    expect(lock).toContain('const SESSION_LOCK_ACQUIRE_TIMEOUT_MS = 30000;');
    expect(read('src/session/lock/PrioritySessionLock.ts')).toContain(
      'const SESSION_LOCK_DEFAULT_TIMEOUT_MS = 30_000;'
    );
  });

  test('B5-2㉗：`MAX_MESSAGES` ×3 已按域消歧（取值一字未改）', () => {
    // 3 处同名 `MAX_MESSAGES` 取值各异、分属独立域（UI 回放 50 / LRO 取尾 12 / teammate 容量 500）
    const items: Array<[string, string, string]> = [
      [
        '../client/src/components/views/office/OfficeChatPanel.tsx',
        'OFFICE_CHAT_MAX_MESSAGES',
        '50',
      ],
      ['src/tasks/LongRunningTaskOrchestrator.ts', 'LRO_MAX_MESSAGES', '12'],
      ['src/tasks/InProcessTeammateTask.ts', 'TEAMMATE_MAX_MESSAGES', '500'],
    ];
    for (const [rel, name, value] of items) {
      const src = read(rel);
      expect(src).not.toMatch(/(^|[^_A-Za-z])const MAX_MESSAGES\s*=/);
      expect(src).toContain(`const ${name} = ${value};`);
    }
    // 同族**非本键**名仍在（不得误伤）：session 裁剪的 `DEFAULT_MAX_MESSAGES`
    expect(read('src/session/pruning/CountBasedPruner.ts')).toContain(
      'const DEFAULT_MAX_MESSAGES = 500;'
    );
  });

  test('B5-2㉘：`MAGIC_GUID` 已合一到 core 层真源（RFC 6455；取值一字未改）', () => {
    // 真源：core 层（纯常量、零 import ⇒ 满足 core 只依赖 core）
    const src = read('src/core/protocol/websocket.ts');
    expect(src).toContain(
      "export const WEBSOCKET_MAGIC_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';"
    );
    expect(src).toContain("export const SEC_WEBSOCKET_VERSION = '13';");
    expect(src).not.toMatch(/^import /m); // 零 import（不读 config / 不引上层）
    // 规范出口（R03-002）：经 core barrel 导出
    expect(read('src/core/index.ts')).toContain(
      "export * from './protocol/websocket';"
    );
    // 4 处副本全部改为引用真源（含曾 `export` 的 acp，其**零消费者** ⇒ 一并收掉导出）
    const consumers: Array<[string, string]> = [
      ['src/acp/websocket.ts', 'MAGIC_GUID'],
      ['src/voice/upgrade.ts', 'MAGIC_GUID'],
      ['src/voice/WakeWebSocketServer.ts', 'MAGIC_GUID'],
      ['src/services/voice/services/edgeTTSTransport.ts', 'WS_GUID'],
    ];
    for (const [rel, oldName] of consumers) {
      const consumer = read(rel);
      expect(consumer).not.toMatch(
        new RegExp(`(^|[^_A-Za-z])const ${oldName}\\s*=`)
      );
      expect(consumer).toContain(
        "import { WEBSOCKET_MAGIC_GUID } from '@modules/core';"
      );
      expect(consumer).toContain('WEBSOCKET_MAGIC_GUID');
    }
    // 测试侧同名字面量一并消歧（避免全仓再出现 `const MAGIC_GUID =`）
    const testSrc = read('tests/voice/upgrade.test.ts');
    expect(testSrc).not.toMatch(/(^|[^_A-Za-z])const MAGIC_GUID\s*=/);
    expect(testSrc).toContain(
      "const RFC6455_MAGIC_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';"
    );
  });

  test('B5-2㉙：`FILE_EDIT_TOOL_NAME` / `FILE_WRITE_TOOL_NAME` 已合一到 constants 真源', () => {
    // 真源：constants（带 `satisfies ToolName` 编译期约束）
    const src = read('src/constants/tools.ts');
    expect(src).toContain(
      "export const FILE_EDIT_TOOL_NAME = 'file_edit' satisfies ToolName;"
    );
    expect(src).toContain(
      "export const FILE_WRITE_TOOL_NAME = 'file_write' satisfies ToolName;"
    );
    // 副本消失：两处 prompt.ts 只**转发导出**（保留消费面），parseAgent 改为导入
    const edit = read('src/tools/FileEditTool/prompt.ts');
    expect(edit).not.toMatch(/(^|[^_A-Za-z])const FILE_EDIT_TOOL_NAME\s*=/);
    expect(edit).toContain(
      "export { FILE_EDIT_TOOL_NAME } from '@modules/constants';"
    );
    const write = read('src/tools/FileWriteTool/prompt.ts');
    expect(write).not.toMatch(/(^|[^_A-Za-z])const FILE_WRITE_TOOL_NAME\s*=/);
    expect(write).toContain(
      "export { FILE_WRITE_TOOL_NAME } from '@modules/constants';"
    );
    const agent = read('src/services/agent/parseAgent.ts');
    expect(agent).not.toMatch(
      /(^|[^_A-Za-z])const FILE_(EDIT|WRITE)_TOOL_NAME\s*=/
    );
    expect(agent).toContain('FILE_EDIT_TOOL_NAME,');
    expect(agent).toContain('FILE_WRITE_TOOL_NAME,');
    expect(agent).toMatch(
      // B5-2-65 起该 import 由单行变多行（三个 `FILE_*` 名同引真源）⇒ 放宽为「同名同源」形态断言
      /import\s*\{[\s\S]*?FILE_EDIT_TOOL_NAME[\s\S]*?FILE_WRITE_TOOL_NAME[\s\S]*?\}\s*from '@modules\/constants';/
    );
    expect(agent).toContain("} from '@modules/constants';");
    // 既有「桶 ↔ 真源 同值契约」守卫**必须保留**（不得为消键而删测试）
    expect(read('tests/tools/toolNameLists.test.ts')).toContain(
      'BARREL_FILE_WRITE_TOOL_NAME'
    );
  });

  test('B5-2㉚：`ACTIVE_NAV_KEY` 三处按域消歧（异值异域，取值一字未改）', () => {
    const items: Array<[string, string, string]> = [
      [
        '../client/src/components/views/UserPage.tsx',
        'USER_PAGE_ACTIVE_NAV_KEY',
        'liri-user-active-nav',
      ],
      [
        '../client/src/components/views/SettingsPage.tsx',
        'SETTINGS_PAGE_ACTIVE_NAV_KEY',
        'liri-settings-active-nav',
      ],
      [
        '../client/src/components/views/HelpPage.tsx',
        'HELP_PAGE_ACTIVE_NAV_KEY',
        'liri-help-active-nav',
      ],
    ];
    for (const [rel, name, value] of items) {
      const src = read(rel);
      // 旧同名常量不得回流
      expect(src).not.toMatch(/(^|[^_A-Za-z])const ACTIVE_NAV_KEY\s*=/);
      // 新名 + 取值钉住
      expect(src).toContain(`const ${name} = "${value}";`);
      // 用法同步（读写各一处）
      expect(src).toContain(`localStorage.getItem(${name})`);
      expect(src).toContain(`localStorage.setItem(${name}, id)`);
    }
  });

  test('B5-2㉛：`UUID_RE` 已合一到 core 层真源（8 份同值副本 → 1；取值一字未改）', () => {
    // 真源：core 层 `core/ids.ts`（归属 core ⇒ 各层可引用；`core → infra` 倒挂禁止）
    // 实测原为 8 份副本（2 `const` + 6 内联，内联对 `lint:consts` 不可见）且取值逐字相同 ⇒ 合一
    const truth = read('src/core/ids.ts');
    expect(truth).toContain('export const UUID_RE =');
    expect(truth).toContain(
      '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;'
    );
    // 规范出口（R03-002）：经 core barrel 导出
    expect(read('src/core/index.ts')).toContain("export * from './ids';");
    // 7 个消费文件：不再有本地 `const UUID_RE` / 内联正则，一律引用真源
    const consumers = [
      'src/ai/models/orphanModels.ts',
      'src/infrastructure/http/handlers/chat-handlers.ts',
      'src/ai/modelRouter.ts',
      'src/session/key/LegacyKeyAdapter.ts',
      'src/tools/VideoGenerateTool/VideoGenerateTool.ts',
      'src/tools/ImageGenerateTool/ImageGenerationRouter.ts',
      'src/tools/ImageGenerateTool/ImageGenerateTool.ts',
    ];
    for (const rel of consumers) {
      const src = read(rel);
      expect(src).not.toMatch(/(^|[^_A-Za-z])const UUID_RE\s*=/);
      expect(src).not.toMatch(/\[0-9a-f\]\{8\}-/); // 内联正则不得回流
      expect(src).toContain('UUID_RE');
      expect(src).toContain("from '@modules/core'");
      expect(src).toContain('UUID_RE.test('); // 用法确实落到真源
    }
  });

  test('B5-2㉜：`MAX_POLL_TIME` ×3 已按域消歧（异值异域，取值一字未改）', () => {
    // 3 处同名 `MAX_POLL_TIME` 各属独立 provider 的视频轮询超时（FAL 5min / SiliconFlow 30min / OpenAI 兼容 5min）
    // 按文件分组断言（OpenAIProvider 含两处 ⇒ 不能逐文件断言"无同名"，需按文件断言）
    const fal = read('src/ai/providers/FALProvider.ts');
    expect(fal).not.toMatch(/(^|[^_A-Za-z])const MAX_POLL_TIME\s*=/);
    expect(fal).toContain('const FAL_POLL_TIME = 5 * 60 * 1000;');
    expect(fal).toContain('while (Date.now() - startTime < FAL_POLL_TIME) {');
    const oai = read('src/ai/providers/OpenAIProvider.ts');
    expect(oai).not.toMatch(/(^|[^_A-Za-z])const MAX_POLL_TIME\s*=/);
    expect(oai).toContain('const SILICONFLOW_POLL_TIME = 30 * 60 * 1000;');
    expect(oai).toContain('const OPENAI_POLL_TIME = 5 * 60 * 1000;');
    // 三处 while 用法全部落到新名（防"只改定义、未改用法"）
    expect(oai).toContain(
      'while (Date.now() - startTime < SILICONFLOW_POLL_TIME) {'
    );
    expect(oai).toContain(
      'while (Date.now() - startTime < OPENAI_POLL_TIME) {'
    );
    // 超时报错文案同样落新名（SiliconFlow 30min 处）
    expect(oai).toContain('${SILICONFLOW_POLL_TIME / 60000} 分钟');
  });

  test('B5-2㉝：`DEFAULT_INTERVAL_MS` ×2 已按域消歧（异值异域，取值一字未改）', () => {
    // 2 处同名 `DEFAULT_INTERVAL_MS` 各属独立调度域：TopologyWatcher 轮询 5s / DataArchivalStrategy 归档 1h
    const topo = read('src/ai/providers/TopologyWatcher.ts');
    expect(topo).not.toMatch(/(^|[^_A-Za-z])const DEFAULT_INTERVAL_MS\s*=/);
    expect(topo).toContain('const TOPOLOGY_WATCH_INTERVAL_MS = 5000;');
    expect(topo).toContain(
      'private intervalMs: number = TOPOLOGY_WATCH_INTERVAL_MS'
    );
    const archival = read('src/monitoring/archival/DataArchivalStrategy.ts');
    expect(archival).not.toMatch(/(^|[^_A-Za-z])const DEFAULT_INTERVAL_MS\s*=/);
    expect(archival).toContain('const ARCHIVAL_INTERVAL_MS = 60 * 60 * 1000;');
    expect(archival).toContain(
      'intervalMs: config?.intervalMs ?? ARCHIVAL_INTERVAL_MS,'
    );
  });

  test('B5-2㉞：`DEFAULT_REQUEST_TIMEOUT_MS` ×2 已按域消歧（同值异域，取值一字未改）', () => {
    // 2 处同名均 30s 请求超时但属独立域：JsonRpcBridge（AI Python JSON-RPC 桥）/ LspSidecarConnection（LSP 侧车）
    // 注：lspConnection 受用户 2026-10-13 裁定 A 约束（不引用 tools/lsp/**）⇒ 不可合一到 LSPClient 真源，只能按域改名
    const bridge = read('src/ai/python/JsonRpcBridge.ts');
    expect(bridge).not.toMatch(
      /(^|[^_A-Za-z])const DEFAULT_REQUEST_TIMEOUT_MS\s*=/
    );
    expect(bridge).toContain('const JSON_RPC_REQUEST_TIMEOUT_MS = 30000;');
    expect(bridge).toContain('requestTimeoutMs: JSON_RPC_REQUEST_TIMEOUT_MS,');
    const conn = read('src/tools/sidecar/lspConnection.ts');
    expect(conn).not.toMatch(
      /(^|[^_A-Za-z])const DEFAULT_REQUEST_TIMEOUT_MS\s*=/
    );
    expect(conn).toContain('const LSP_SIDECAR_REQUEST_TIMEOUT_MS = 30_000;');
    expect(conn).toContain(
      'opts.requestTimeoutMs ?? LSP_SIDECAR_REQUEST_TIMEOUT_MS'
    );
  });

  test('B5-2㉟：`HEARTBEAT_INTERVAL` ×2 已按域消歧（异值异域，取值一字未改）', () => {
    // 2 处同名各属独立域：AppCoreOTelHelper OTel 心跳 4min / constants/common.ts 通用 30s（该导出无消费方，属「假真源」待裁定项，本次只消歧不删）
    const otel = read('src/bootstrap/AppCoreOTelHelper.ts');
    expect(otel).not.toMatch(/(^|[^_A-Za-z])const HEARTBEAT_INTERVAL\s*=/);
    expect(otel).toContain('const OTEL_HEARTBEAT_INTERVAL = 4 * 60 * 1000;');
    expect(otel).toContain('}, OTEL_HEARTBEAT_INTERVAL);');
    const common = read('src/constants/common.ts');
    expect(common).not.toMatch(/(^|[^_A-Za-z])const HEARTBEAT_INTERVAL\s*=/);
    expect(common).toContain(
      'export const COMMON_HEARTBEAT_INTERVAL = 30 * 1000;'
    );
  });

  test('B5-2㊱：`IMAGE_EXTENSIONS` ×3 已按域消歧（异值异域，取值一字未改）', () => {
    // 3 处同名各属独立域且值集不同：MediaCache（8 项，媒体类型推断）/ BriefTool attachments（7 项，附件验证）/ FileReadTool imageProcessor（13 项，图片处理）
    const media = read('src/channels/cache/MediaCache.ts');
    expect(media).not.toMatch(/(^|[^_A-Za-z])const IMAGE_EXTENSIONS\s*=/);
    expect(media).toContain('const MEDIA_CACHE_IMAGE_EXTENSIONS = new Set([');
    expect(media).toContain('MEDIA_CACHE_IMAGE_EXTENSIONS.has(ext)');
    const brief = read('src/tools/BriefTool/attachments.ts');
    expect(brief).not.toMatch(/(^|[^_A-Za-z])const IMAGE_EXTENSIONS\s*=/);
    expect(brief).toContain('const BRIEF_IMAGE_EXTENSIONS = new Set([');
    expect(brief).toContain('BRIEF_IMAGE_EXTENSIONS.has(ext)');
    const img = read('src/tools/FileReadTool/imageProcessor.ts');
    expect(img).not.toMatch(/(^|[^_A-Za-z])const IMAGE_EXTENSIONS\s*=/);
    expect(img).toContain(
      'const FILE_READ_IMAGE_EXTENSIONS: Set<string> = new Set(['
    );
    expect(img).toContain('FILE_READ_IMAGE_EXTENSIONS.has(`.${ext}`)');
    // 导出面 IMAGE_EXTENSIONS_LIST 保留，其数据源改为新名（prettier 可能折行 ⇒ 只断前缀）
    expect(img).toContain('IMAGE_EXTENSIONS_LIST = Array.from(');
    expect(img).toContain('FILE_READ_IMAGE_EXTENSIONS\n).sort();');
  });

  test('B5-2㊲：`IMAGE_EXTS` ×2 已按域消歧（异值异域，取值一字未改）', () => {
    // 2 处同名各属独立域且值集不同：files-handlers（7 项，文件预览 base64）/ ToolExecutionService（5 项，沙箱图片收集）
    const files = read('src/infrastructure/http/handlers/files-handlers.ts');
    expect(files).not.toMatch(/(^|[^_A-Za-z])const IMAGE_EXTS\s*=/);
    expect(files).toContain('const FILES_IMAGE_EXTS = new Set([');
    expect(files).toContain('FILES_IMAGE_EXTS.has(ext)');
    const tool = read('src/chat/services/ToolExecutionService.ts');
    expect(tool).not.toMatch(/(^|[^_A-Za-z])const IMAGE_EXTS\s*=/);
    // prettier 可能把数组折行 ⇒ 只断声明首行
    expect(tool).toContain('const SANDBOX_IMAGE_EXTS = [');
    expect(tool).toContain("'.webp',");
    expect(tool).toContain('SANDBOX_IMAGE_EXTS.some((x) =>');
  });

  test('B5-2㊳：`SAFE_ID_PATTERN` 已合一（同值同事实；真源在 BridgeApi.ts，BridgeApiClient 改别名引用）', () => {
    // 2 处同名同值 `/^[a-zA-Z0-9_-]+$/`、同为 bridge/api 域 ID 校验 ⇒ 合一，非消歧
    const truth = read('src/bridge/api/BridgeApi.ts');
    expect(truth).toContain('SAFE_ID_PATTERN 唯一真源');
    expect(truth).toContain('const SAFE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;');
    expect(truth).toContain('export function validateBridgeId');
    const client = read('src/bridge/api/BridgeApiClient.ts');
    expect(client).not.toMatch(/(^|[^_A-Za-z])const SAFE_ID_PATTERN\s*=/);
    // prettier 可能折行 import 块 ⇒ 分片段断言（空白容忍）
    expect(client).toContain('validateBridgeId as importedValidateBridgeId');
    expect(client).toContain("} from './BridgeApi';");
    expect(client).toContain('return importedValidateBridgeId(id, label);');
  });

  test('B5-2㊴：`EMPTY_POLL_LOG_INTERVAL` 已合一（同值同事实；真源在 BridgeApi.ts，BridgeApiClient 改引用）', () => {
    // 2 处同名同值 100、同为 bridge/api 域空轮询日志节流判定 ⇒ 合一，非消歧
    const truth = read('src/bridge/api/BridgeApi.ts');
    expect(truth).toContain('EMPTY_POLL_LOG_INTERVAL 唯一真源');
    expect(truth).toContain('export const EMPTY_POLL_LOG_INTERVAL = 100;');
    const client = read('src/bridge/api/BridgeApiClient.ts');
    expect(client).not.toMatch(
      /(^|[^_A-Za-z])const EMPTY_POLL_LOG_INTERVAL\s*=/
    );
    expect(client).toContain('EMPTY_POLL_LOG_INTERVAL,');
    expect(client).toContain(
      'consecutiveEmptyPolls % EMPTY_POLL_LOG_INTERVAL === 0'
    );
  });

  test('B5-2㊵：`EYES` 已按域消歧（client/app 异域同值，取值一字未改）', () => {
    // 真源：app/src/buddy/types.ts（导出 + 派生 Eye 类型）；client BuddyAvatar 私有副本消歧为 BUDDY_EYES
    const truth = read('src/buddy/types.ts');
    expect(truth).toContain('export const EYES = [');
    expect(truth).toContain('export type Eye = (typeof EYES)[number];');
    const avatar = read('../client/src/components/Buddy/BuddyAvatar.tsx');
    expect(avatar).not.toMatch(/(^|[^_A-Za-z])const EYES\s*=/);
    expect(avatar).toContain('const BUDDY_EYES = [');
    expect(avatar).toContain('frame % BUDDY_EYES.length');
    expect(avatar).toContain('setDisplayEye(BUDDY_EYES[idx] as BuddyEye)');
  });

  test('B5-2㊶：`STREAM_IDLE_TIMEOUT_MS` 已按域消歧（client/app 异域同值，取值一字未改）', () => {
    // 真源：app/src/channels/routing/messageRouterContract.ts（架构收容地，streamConsumption 消费）
    // client 副本 readWithIdleTimeout 消歧改名 SSE_IDLE_TIMEOUT_MS（chatService 两处使用）
    const truth = read('src/channels/routing/messageRouterContract.ts');
    expect(truth).toContain('STREAM_IDLE_TIMEOUT_MS 唯一真源');
    expect(truth).toContain('export const STREAM_IDLE_TIMEOUT_MS = 300_000;');
    const util = read('../client/src/utils/readWithIdleTimeout.ts');
    expect(util).not.toMatch(/(^|[^_A-Za-z])const STREAM_IDLE_TIMEOUT_MS\s*=/);
    expect(util).toContain('const SSE_IDLE_TIMEOUT_MS = 300_000;');
    expect(util).toContain('timeoutMs: number = SSE_IDLE_TIMEOUT_MS,');
    const svc = read('../client/src/services/chatService.ts');
    expect(svc).not.toContain('STREAM_IDLE_TIMEOUT_MS');
    expect(svc).toContain('SSE_IDLE_TIMEOUT_MS,');
    expect(svc).toContain(': SSE_IDLE_TIMEOUT_MS,');
  });

  test('B5-2㊷：`CHANNEL_ARROW` 已按域消歧（figures ← / parser → 异值，取值一字未改）', () => {
    // 异值异域 ⇒ 消歧：figures.ts 为通用 UI 图形字符库（←）保留真源；
    // chat/ChannelMessageParser 的「消息来源箭头」（→）改名 MSG_SOURCE_ARROW
    const figures = read('src/constants/figures.ts');
    expect(figures).toContain('CHANNEL_ARROW 唯一真源');
    expect(figures).toContain("export const CHANNEL_ARROW = '←';");
    const parser = read('src/chat/ChannelMessageParser.ts');
    expect(parser).not.toMatch(/(^|[^_A-Za-z])const CHANNEL_ARROW\s*=/);
    expect(parser).toContain("export const MSG_SOURCE_ARROW = '→';");
    expect(parser).toContain('MSG_SOURCE_ARROW} ${parsed.displaySource}');
  });

  test('B5-2㊸：`THINKING_BATCH_SIZE` 已合一（同值同事实；真源在 streamingLlm.ts 顶层，streamMessageFlow 改引用）', () => {
    // 2 处同值 50、同属 chat 域 thinking 事件防抖（KB-EVENT-BATCH）⇒ 合一
    const llm = read('src/chat/streamingLlm.ts');
    expect(llm).toContain('THINKING_BATCH_SIZE 唯一真源');
    expect(llm).toContain('export const THINKING_BATCH_SIZE = 50;');
    // 方法体内不得残留裸定义（应引用模块级真源）
    expect(llm).not.toMatch(/(^|\n)\s+const THINKING_BATCH_SIZE\s*=/);
    const flow = read('src/chat/orchestrator/streamMessageFlow.ts');
    expect(flow).not.toMatch(/(^|[^_A-Za-z])const THINKING_BATCH_SIZE\s*=/);
    // prettier 可能折行/合并 import 块 ⇒ 分片段断言（空白容忍）
    expect(flow).toContain('THINKING_BATCH_SIZE');
    expect(flow).toContain("from '../streamingLlm.js';");
  });

  test('B5-2㊹：`THINKING_BATCH_MS` 已合一（同值同事实；真源在 streamingLlm.ts 顶层，streamMessageFlow 改引用）', () => {
    // 2 处同值 2000、同属 chat 域 thinking 事件防抖时间窗（KB-EVENT-BATCH）⇒ 合一
    const llm = read('src/chat/streamingLlm.ts');
    expect(llm).toContain('THINKING_BATCH_MS 唯一真源');
    expect(llm).toContain('export const THINKING_BATCH_MS = 2000;');
    // 方法体内不得残留裸定义（应引用模块级真源）
    expect(llm).not.toMatch(/(^|\n)\s+const THINKING_BATCH_MS\s*=/);
    const flow = read('src/chat/orchestrator/streamMessageFlow.ts');
    expect(flow).not.toMatch(/(^|[^_A-Za-z])const THINKING_BATCH_MS\s*=/);
    expect(flow).toContain(
      "THINKING_BATCH_SIZE, THINKING_BATCH_MS } from '../streamingLlm.js';"
    );
  });

  test('B5-2㊺：`REVIEW_GUIDELINES` 已按域消歧（异值异域，取值一字未改）', () => {
    // query 侧「研究方案评审」模板字符串 → RESEARCH_REVIEW_GUIDELINES
    // chat 侧「回复正文复核」数组 → TURN_REVIEW_GUIDELINES
    const q = read('src/query/CompetitiveStrategyOrchestrator.ts');
    expect(q).not.toMatch(/(^|[^_A-Za-z])const REVIEW_GUIDELINES\s*=/);
    expect(q).toContain('RESEARCH_REVIEW_GUIDELINES = `审查对象');
    expect(q).toContain('reviewGuidelines: RESEARCH_REVIEW_GUIDELINES,');
    const c = read('src/chat/quality/turnQualityReviewer.ts');
    expect(c).not.toMatch(/(^|[^_A-Za-z])const REVIEW_GUIDELINES\s*=/);
    expect(c).toContain('const TURN_REVIEW_GUIDELINES = [');
    expect(c).toContain('reviewGuidelines: TURN_REVIEW_GUIDELINES,');
  });

  test('B5-2㊻：`EXPLORATION_SENTENCE_PATTERNS` 已按域消歧（client/app 异域同值，取值一字未改）', () => {
    // 同值（3 条正则逐字一致）但属 client/app 异域双轨（裁定 A）⇒ 消歧：
    // app 服务端 bareExplorationStripper.ts 保留原名真源；client chat-toolcall.slice.ts 改名 TOOLCALL_EXPLORATION_SENTENCE_PATTERNS
    const app = read('src/chat/services/bareExplorationStripper.ts');
    expect(app).toContain('EXPLORATION_SENTENCE_PATTERNS 唯一真源');
    expect(app).toContain('const EXPLORATION_SENTENCE_PATTERNS = [');
    expect(app).toContain(
      'EXPLORATION_SENTENCE_PATTERNS.some((re) => re.test(sentence))'
    );
    const cli = read('../client/src/stores/chat/chat-toolcall.slice.ts');
    expect(cli).not.toMatch(
      /(^|[^_A-Za-z])const EXPLORATION_SENTENCE_PATTERNS\s*=/
    );
    expect(cli).toContain('const TOOLCALL_EXPLORATION_SENTENCE_PATTERNS = [');
    expect(cli).toContain(
      'return TOOLCALL_EXPLORATION_SENTENCE_PATTERNS.some((re) => re.test(sentence));'
    );
  });

  test('B5-2㊼：`MARKDOWN_STRUCTURE_RE` 已按域消歧（client/app 异域同值，取值一字未改）', () => {
    // 同值（正则逐字一致）但属 client/app 异域双轨（裁定 A）⇒ 消歧：
    // app 服务端 bareExplorationStripper.ts 保留原名真源；client chat-toolcall.slice.ts 改名 CHAT_TOOLCALL_MARKDOWN_STRUCTURE_RE
    const app = read('src/chat/services/bareExplorationStripper.ts');
    expect(app).toContain('MARKDOWN_STRUCTURE_RE 唯一真源');
    expect(app).toContain('const MARKDOWN_STRUCTURE_RE =');
    expect(app).toContain(
      'if (MARKDOWN_STRUCTURE_RE.test(sentence)) return false;'
    );
    const cli = read('../client/src/stores/chat/chat-toolcall.slice.ts');
    expect(cli).not.toMatch(/(^|[^_A-Za-z])const MARKDOWN_STRUCTURE_RE\s*=/);
    expect(cli).toContain('const CHAT_TOOLCALL_MARKDOWN_STRUCTURE_RE =');
    expect(cli).toContain(
      'if (CHAT_TOOLCALL_MARKDOWN_STRUCTURE_RE.test(sentence)) return false;'
    );
  });

  test('B5-2㊽：`DEFAULT_CACHE_TTL_MS` 已按域消歧（异值异域：图片下载 24h / 市场 1h，取值一字未改）', () => {
    // chat 域图片下载缓存（24h，env 可覆盖）→ IMAGE_DOWNLOAD_CACHE_TTL_MS
    // plugins 域市场元数据缓存（1h）→ MARKETPLACE_CACHE_TTL_MS
    const img = read('src/chat/services/ImageDownloader.ts');
    expect(img).not.toMatch(/(^|[^_A-Za-z])const DEFAULT_CACHE_TTL_MS\s*=/);
    expect(img).toContain('const IMAGE_DOWNLOAD_CACHE_TTL_MS = envInt(');
    expect(img).toContain("'IMAGE_DOWNLOAD_CACHE_TTL_MS',");
    expect(img).toContain('config.cacheTtlMs ?? IMAGE_DOWNLOAD_CACHE_TTL_MS');
    const mkt = read('src/plugins/marketplace/PluginMarketplace.ts');
    expect(mkt).not.toMatch(/(^|[^_A-Za-z])const DEFAULT_CACHE_TTL_MS\s*=/);
    expect(mkt).toContain('const MARKETPLACE_CACHE_TTL_MS = 3600 * 1000;');
    expect(mkt).toContain('ttlMs: MARKETPLACE_CACHE_TTL_MS,');
  });

  test('B5-2㊾：`CACHE_MAX_SIZE` 已按域消歧（异值异域：议会 15 / 路径校验 200，取值一字未改）', () => {
    // workspace 域议会缓存上限（15）→ COUNCIL_CACHE_MAX_SIZE
    // chat 域路径校验缓存上限（200）→ PATH_GUARD_CACHE_MAX_SIZE
    const council = read('src/workspace/CouncilOrchestrator.ts');
    expect(council).not.toMatch(/(^|[^_A-Za-z])const CACHE_MAX_SIZE\s*=/);
    expect(council).toContain('const COUNCIL_CACHE_MAX_SIZE = 15;');
    expect(council).toContain(
      'if (councilCache.size >= COUNCIL_CACHE_MAX_SIZE) {'
    );
    const guard = read('src/chat/services/PathGuardService.ts');
    expect(guard).not.toMatch(/(^|[^_A-Za-z])const CACHE_MAX_SIZE\s*=/);
    expect(guard).toContain('const PATH_GUARD_CACHE_MAX_SIZE = 200;');
    expect(guard).toContain(
      'if (pathCheckCache.size >= PATH_GUARD_CACHE_MAX_SIZE) {'
    );
  });

  test('B5-2㊿：`META_KEY` 已按域消歧（异值异域：流式/普通检查点元数据键，取值一字未改）', () => {
    // 两处 metadata 键名不同 ⇒ 按用途消歧：流式检查点 / 普通对话检查点
    const streaming = read('src/chat/services/StreamingAutoCheckpoint.ts');
    expect(streaming).not.toMatch(/(^|[^_A-Za-z])const META_KEY\s*=/);
    expect(streaming).toContain(
      "const STREAMING_CHECKPOINT_META_KEY = 'streamingAutoCheckpoint';"
    );
    expect(streaming).toContain('[STREAMING_CHECKPOINT_META_KEY]: true,');
    const plain = read('src/chat/services/PlainTextCheckpoint.ts');
    expect(plain).not.toMatch(/(^|[^_A-Za-z])const META_KEY\s*=/);
    expect(plain).toContain(
      "const PLAIN_TEXT_CHECKPOINT_META_KEY = 'plainTextAutoCheckpoint';"
    );
    expect(plain).toContain('[PLAIN_TEXT_CHECKPOINT_META_KEY]: true,');
    expect(plain).toContain(
      'if (!meta?.[PLAIN_TEXT_CHECKPOINT_META_KEY]) return null;'
    );
  });

  // 51+ 无圈码字形 ⇒ 沿用台账 ASCII 编号（`B5-2-<n>-<SLUG>`）
  test('B5-2-51：`TABLE` ×2 已按域消歧（异值异域：定时任务表 / 人设绑定表，取值一字未改）', () => {
    const cron = read('src/chronos/service/SqliteCronStore.ts');
    expect(cron).not.toMatch(/(^|[^_A-Za-z])const TABLE\s*=/);
    expect(cron).toContain("const SCHEDULED_TASKS_TABLE = 'scheduled_tasks';");
    expect(cron).toContain(
      'CREATE TABLE IF NOT EXISTS ${SCHEDULED_TASKS_TABLE} ('
    );
    const persona = read('src/core/persona/PersonaService.ts');
    expect(persona).not.toMatch(/(^|[^_A-Za-z])const TABLE\s*=/);
    expect(persona).toContain(
      "const PERSONA_BINDINGS_TABLE = 'persona_bindings';"
    );
    expect(persona).toContain(
      'CREATE TABLE IF NOT EXISTS ${PERSONA_BINDINGS_TABLE} ('
    );
  });

  test('B5-2-52：`SKIP_DIRS` ×2 已按域消歧（异值异域：插件安全扫描 / files 递归守卫；搜索工具另有真源 searchSkipDirs.ts）', () => {
    const plugin = read('src/plugins/utils/pluginSecurityScanner.ts');
    expect(plugin).not.toMatch(/(^|[^_A-Za-z])const SKIP_DIRS\s*=/);
    expect(plugin).toContain('const PLUGIN_SCAN_SKIP_DIRS = [');
    expect(plugin).toContain('!PLUGIN_SCAN_SKIP_DIRS.includes(entry.name)');
    const files = read('src/commands/builtin/files/Files.ts');
    expect(files).not.toMatch(/(^|[^_A-Za-z])const SKIP_DIRS\s*=/);
    expect(files).toContain('const FILES_SKIP_DIRS = new Set([');
    expect(files).toContain('FILES_SKIP_DIRS.has(name)');
  });

  test('B5-2-53：`AGENT_TYPES` ×2 已合一到真源（`BUILTIN_AGENTS` 的键；CLI 两命令改引用，取值/顺序一字未改）', () => {
    const constants = read('src/tools/AgentTool/constants.ts');
    expect(constants).toContain(
      'export const AGENT_TYPES = Object.keys(BUILTIN_AGENTS);'
    );
    const barrel = read('src/tools/index.ts');
    expect(barrel).toContain(
      "export { AGENT_TYPES } from './AgentTool/constants';"
    );
    for (const rel of [
      'src/commands/tools/ai/agent.ts',
      'src/commands/tools/ai/agents.ts',
    ]) {
      const src = read(rel);
      expect(src).not.toMatch(/(^|[^_A-Za-z])const AGENT_TYPES\s*=/);
      expect(src).toContain("import { AGENT_TYPES } from '@modules/tools';");
    }
  });

  test('B5-2-54：`AUTOCOMPACT_BUFFER_TOKENS` 已合一到真源（同值同事实：13000；策略侧改引用）', () => {
    const core = read('src/compaction/autoCompact.ts');
    expect(core).toContain('export const AUTOCOMPACT_BUFFER_TOKENS = 13_000;');
    const strategy = read('src/compaction/strategies/AutoCompactStrategy.ts');
    expect(strategy).not.toMatch(
      /(^|[^_A-Za-z])const AUTOCOMPACT_BUFFER_TOKENS\s*=/
    );
    expect(strategy).toContain(
      "import { AUTOCOMPACT_BUFFER_TOKENS } from '../autoCompact';"
    );
  });

  test('B5-2-55：`SAFE_ENV_VARS` ×2 已按域消歧（托管设置白名单 / bash 继承白名单，异值异域）', () => {
    const managed = read('src/config/managedEnv.ts');
    expect(managed).not.toMatch(/(^|[^_A-Za-z])const SAFE_ENV_VARS\s*=/);
    expect(managed).toContain('export const SAFE_MANAGED_ENV_VARS = new Set([');
    expect(read('src/config/index.ts')).toContain('SAFE_MANAGED_ENV_VARS,');
    const bash = read('src/utils/bash/ast.ts');
    expect(bash).not.toMatch(/(^|[^_A-Za-z])const SAFE_ENV_VARS\s*=/);
    expect(bash).toContain('export const BASH_SAFE_ENV_VARS = new Set([');
    expect(read('src/utils/bash/index.ts')).toContain('BASH_SAFE_ENV_VARS,');
  });

  test('B5-2-56：`VALID_STATUSES` ×2 已按域消歧（task 五态 / todo 三态，异值异域）', () => {
    const task = read('src/commands/tools/task/task.ts');
    expect(task).not.toMatch(/(^|[^_A-Za-z])const VALID_STATUSES\s*=/);
    expect(task).toContain('const TASK_VALID_STATUSES = [');
    expect(task).toContain("'cancelled',");
    const todo = read('src/commands/tools/task/todo.ts');
    expect(todo).not.toMatch(/(^|[^_A-Za-z])const VALID_STATUSES\s*=/);
    expect(todo).toContain(
      "const TODO_VALID_STATUSES = ['pending', 'in_progress', 'completed'] as const;"
    );
  });

  test('B5-2-57：`MDM_SUBPROCESS_TIMEOUT_MS` 已合一到真源（同值同事实 5000；MdmPrefetch 改桶引用）', () => {
    const truth = read('src/config/settings/mdm/constants.ts');
    expect(truth).toContain('export const MDM_SUBPROCESS_TIMEOUT_MS = 5000;');
    expect(read('src/config/index.ts')).toContain('MDM_SUBPROCESS_TIMEOUT_MS,');
    const prefetch = read('src/infrastructure/startup/MdmPrefetch.ts');
    expect(prefetch).not.toMatch(
      /(^|[^_A-Za-z])const MDM_SUBPROCESS_TIMEOUT_MS\s*=/
    );
    expect(prefetch).toContain(
      "import { MDM_SUBPROCESS_TIMEOUT_MS } from '@modules/config';"
    );
  });

  test('B5-2-58：`DEFAULT_SESSION_TIMEOUT` ×2 已按域消歧（通用 30min 真源保留 / voice 10min 改名，取值一字未改）', () => {
    expect(read('src/constants/common.ts')).toContain(
      'export const DEFAULT_SESSION_TIMEOUT = 30 * 60 * 1000;'
    );
    const voice = read('src/voice/VoiceSession.ts');
    expect(voice).not.toMatch(
      /(^|[^_A-Za-z])const DEFAULT_SESSION_TIMEOUT\s*=/
    );
    expect(voice).toContain('const VOICE_SESSION_TIMEOUT = 10 * 60 * 1000;');
    expect(voice).toContain('}, VOICE_SESSION_TIMEOUT);');
  });

  test('B5-2-59：`MAX_FILENAME_LENGTH` ×2 已按域消歧（app 文件系统 255 真源保留 / client 导出名 120 改名，取值一字未改）', () => {
    expect(read('src/constants/common.ts')).toContain(
      'export const MAX_FILENAME_LENGTH = 255;'
    );
    const client = read('../client/src/utils/exportMessage.ts');
    expect(client).not.toMatch(/(^|[^_A-Za-z])const MAX_FILENAME_LENGTH\s*=/);
    expect(client).toContain('const EXPORT_FILENAME_MAX_LENGTH = 120;');
    expect(client).toContain('> EXPORT_FILENAME_MAX_LENGTH)');
    expect(client).toContain('slice(0, EXPORT_FILENAME_MAX_LENGTH)');
  });

  test('B5-2-60：`DEFAULT_MODEL` 已合一到真源（同值同事实：空串；voice 适配器改桶引用）', () => {
    expect(read('src/constants/common.ts')).toContain(
      "export const DEFAULT_MODEL = '';"
    );
    const voice = read('src/voice/OpenAIRealtimeAdapter.ts');
    expect(voice).not.toMatch(/(^|[^_A-Za-z])const DEFAULT_MODEL\s*=/);
    expect(voice).toContain(
      "import { DEFAULT_MODEL } from '@modules/constants';"
    );
    expect(voice).toContain('this.model = model ?? DEFAULT_MODEL;');
  });

  test('B5-2-61：`DEFAULT_MAX_TOKENS` ×2 已按域消歧（通用 4096 真源保留 / evals 红队 16384 改名，取值一字未改）', () => {
    expect(read('src/constants/common.ts')).toContain(
      'export const DEFAULT_MAX_TOKENS = 4096;'
    );
    const evals = read('src/evals/adversarialProposer.ts');
    expect(evals).not.toMatch(/(^|[^_A-Za-z])const DEFAULT_MAX_TOKENS\s*=/);
    expect(evals).toContain(
      'export const ADVERSARIAL_DEFAULT_MAX_TOKENS = 16_384;'
    );
    expect(evals).toContain('opts.maxTokens ?? ADVERSARIAL_DEFAULT_MAX_TOKENS');
  });

  test('B5-2-62：`MAX_TOOL_RESULT_BYTES` ×2 已按域消歧（上下文 400KB 上限 / 存储 1MB 落盘阈值，异值异域）', () => {
    const limits = read('src/constants/toolLimits.ts');
    expect(limits).not.toMatch(/(^|[^_A-Za-z])const MAX_TOOL_RESULT_BYTES\s*=/);
    expect(limits).toContain('export const CONTEXT_MAX_TOOL_RESULT_BYTES =');
    const storage = read('src/services/toolResultStorage/types.ts');
    expect(storage).toContain(
      'export const MAX_TOOL_RESULT_BYTES = 1_000_000;'
    );
  });

  test('B5-2-63：`MAX_TOOL_RESULTS_PER_MESSAGE_CHARS` 的 toolLimits 死副本已删（同名同义却值漂移：200_000 vs 活值 250_000）', () => {
    const limits = read('src/constants/toolLimits.ts');
    expect(limits).not.toMatch(
      /(^|[^_A-Za-z])const MAX_TOOL_RESULTS_PER_MESSAGE_CHARS\s*=/
    );
    const storage = read('src/services/toolResultStorage/types.ts');
    expect(storage).toContain(
      'export const MAX_TOOL_RESULTS_PER_MESSAGE_CHARS = 250_000;'
    );
    expect(
      read('src/services/toolResultStorage/ContentReplacementStore.ts')
    ).toContain("configManager.env('MAX_TOOL_RESULTS_PER_MESSAGE_CHARS')");
  });

  test('B5-2-64：`lint:consts` 增 vendored 目录排除（`ink/ink` 上游副本不参与重复事实源治理）', () => {
    const gate = read('../scripts/lint-consts.ts');
    expect(gate).toContain("const VENDORED_FRAGMENTS = ['app/src/ink/ink/'];");
    expect(gate).toContain(
      'if (matchesWhitelist(rel, VENDORED_FRAGMENTS)) continue;'
    );
    // 仓内真源仍在（只是不再与 vendored 同名冲突）
    expect(read('src/constants/figures.ts')).toContain(
      "export const ELLIPSIS = '…';"
    );
  });

  test('B5-2-65：`FILE_READ_TOOL_NAME` 已合一到真源（同值同事实：`file_read`；parseAgent 补齐第三个 `FILE_*` 名）', () => {
    expect(read('src/constants/tools.ts')).toContain(
      "export const FILE_READ_TOOL_NAME = 'file_read' satisfies ToolName;"
    );
    const parse = read('src/services/agent/parseAgent.ts');
    expect(parse).not.toMatch(/(^|[^_A-Za-z])const FILE_READ_TOOL_NAME\s*=/);
    expect(parse).toContain('FILE_READ_TOOL_NAME,');
    expect(parse).toContain("} from '@modules/constants';");
  });

  test('B5-2-66：`TOOL_NAMES` ×2 已按域消歧（后端生成真源保留 / client 图像视图注册表改名）', () => {
    expect(read('src/constants/toolNames.generated.ts')).toContain(
      'export const TOOL_NAMES = ['
    );
    const client = read('../client/src/components/views/image/toolRegistry.ts');
    expect(client).not.toMatch(/(^|[^_A-Za-z])const TOOL_NAMES\s*=/);
    expect(client).toContain(
      'export const IMAGE_REGISTRY_TOOL_NAMES = Object.keys(TOOL_REGISTRY)'
    );
  });

  test('B5-2-67：`FORK_BOILERPLATE_TAG` 的 `constants/xml.ts` 死副本已删（同义异值：`fork-boilerplate` vs 活值 `[fork-subagent]`）', () => {
    expect(read('src/constants/xml.ts')).not.toMatch(
      /(^|[^_A-Za-z])const FORK_BOILERPLATE_TAG\s*=/
    );
    expect(read('src/tools/AgentTool/ForkSubagent.ts')).toContain(
      "export const FORK_BOILERPLATE_TAG = '[fork-subagent]';"
    );
  });

  test('B5-2B1：`DIR_EXISTS_GUIDANCE` 已按域消歧（异值异域：dream 目录清单 / memory 已存在提示）', () => {
    // memory 域导出真源（中文「目录已存在」提示，被 teamMemPrompts 引用）保留原名
    const mem = read('src/memory/services/MemoryPromptBuilder.ts');
    expect(mem).toContain('唯一真源（memory 域');
    expect(mem).toContain('export const DIR_EXISTS_GUIDANCE =');
    expect(mem).toContain('该目录已存在 —— 直接用 Write 工具写入即可');
    // chronos 域（dream 整合的目录内容清单）改名
    const dream = read('src/chronos/autoDream/ConsolidationPrompt.ts');
    expect(dream).not.toMatch(/(^|[^_A-Za-z])const DIR_EXISTS_GUIDANCE\s*=/);
    expect(dream).toContain('const DREAM_DIR_CONTENT_GUIDANCE =');
    expect(dream).toContain('${DREAM_DIR_CONTENT_GUIDANCE}');
    // 跨文件消费者仍引用 memory 真源
    const team = read('src/memory/services/teamMemPrompts.ts');
    expect(team).toContain("from './MemoryPromptBuilder.js';");
  });

  test('B5-2B2：`ENTRYPOINT_NAME` 已按域消歧（异值异域：index.md / MEMORY.md，取值一字未改）', () => {
    // memory 域导出真源（'MEMORY.md'，被 MemoryFileService 引用）保留原名
    const mem = read('src/memory/services/MemoryPromptBuilder.ts');
    expect(mem).toContain("export const ENTRYPOINT_NAME = 'MEMORY.md';");
    // chronos 域（dream 记忆根，'index.md'）改名
    const dream = read('src/chronos/autoDream/ConsolidationPrompt.ts');
    expect(dream).not.toMatch(/(^|[^_A-Za-z])const ENTRYPOINT_NAME\s*=/);
    expect(dream).toContain("const DREAM_ENTRYPOINT_NAME = 'index.md';");
    expect(dream).toContain('${DREAM_ENTRYPOINT_NAME}');
    expect(dream).toContain('return DREAM_ENTRYPOINT_NAME;');
    // 跨文件消费者仍引用 memory 真源
    const fileSvc = read('src/memory/services/MemoryFileService.ts');
    expect(fileSvc).toContain('ENTRYPOINT_NAME,');
  });

  test('B5-2B3：`MAX_ENTRYPOINT_LINES` 已按域消歧（异值异域：50 / 200，取值一字未改）', () => {
    const mem = read('src/memory/services/MemoryPromptBuilder.ts');
    expect(mem).toContain('export const MAX_ENTRYPOINT_LINES = 200;');
    const dream = read('src/chronos/autoDream/ConsolidationPrompt.ts');
    expect(dream).not.toMatch(/(^|[^_A-Za-z])const MAX_ENTRYPOINT_LINES\s*=/);
    expect(dream).toContain('const DREAM_MAX_ENTRYPOINT_LINES = 50;');
    expect(dream).toContain('return DREAM_MAX_ENTRYPOINT_LINES;');
    const fileSvc = read('src/memory/services/MemoryFileService.ts');
    expect(fileSvc).toContain('MAX_ENTRYPOINT_LINES,');
  });
});
