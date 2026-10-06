/**
 * U7/§21.6（2026-10-06）：`SessionRouter` **接线**守卫。
 *
 * 背景：`SessionGateway` 有 `setSessionRouter()`/`getSessionRouter()` 与使用点
 * （`createSession` 的 `sessionSource` 分支），但全仓**无 `new SessionRouter`、无 `setSessionRouter` 调用**
 * ⇒ `sessionRouter` **恒为 `null`** ⇒ 该分支永不生效（用户裁定「接线」）。
 *
 * 本用例锁定三件事：
 *  ① keyFactory 就绪 + `wireServices` ⇒ **已注入**（原恒 null）；
 *  ② 无 keyFactory ⇒ 不注入（无法构造 router，保持旧行为）；
 *  ③ `wireWithRealServices()` 亦注入且**幂等**（重复调用同一实例）；
 *  ④ `route()` 产出**结构化**键（`sess:<userId>:<chatType>:…`）且 **`resolve()` 可反解**；
 *     并如实锁住"**非确定性**"（键内含 timestamp+uuid ⇒ 同来源两次调用不同 id），
 *     防止把该能力误读为"按来源去重/复用同一 id"。
 */
import {
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
  beforeAll,
} from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SessionGateway } from '../../src/session/SessionGateway';
import { StorageType } from '../../src/session/storage/UnifiedStorage';
import { resetFTS5SearchEngine } from '../../src/session/FTS5SearchEngine';
import { SessionRouter } from '../../src/session/key/SessionRouter';
import { SessionKeyFactory } from '../../src/session/key/SessionKeyFactory';
import { setCoreApiAppDeps } from '../../src/runtime/api/CoreAPIImpl';

const WORKTREE_HASH = 'testhash';
const gateways: SessionGateway[] = [];
let dataDir: string;

/**
 * `wireServices` / `wireWithRealServices()` 会经 `createWiredCompactionBridge()` 取
 * `createAutoCompactService`（组合根端口）⇒ 单测须先注入**最小可用** app deps，
 * 否则抛「app 层依赖未注入」。字段形状见 `CoreApiAppDeps`（全部 `unknown` + 3 个路由方法）。
 */
beforeAll(() => {
  setCoreApiAppDeps({
    chatManager: {},
    toolManager: {},
    converterEngine: {},
    fileTypeDetector: {},
    router: {
      resolveDefault: () => '',
      resolveWithPhase: () => null,
      resolveChat: async () => '',
    },
    getCheckpointService: () => ({}),
    createAutoCompactService: () => ({}),
    globalEmbeddingManager: {},
  } as never);
});

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'gw-router-'));
  process.env.LIRI_DATA_DIR = dataDir;
  resetFTS5SearchEngine();
});

afterEach(async () => {
  for (const gw of gateways.splice(0)) {
    try {
      await gw.close();
    } catch {
      // 关闭失败不影响断言
    }
  }
  delete process.env.LIRI_DATA_DIR;
  resetFTS5SearchEngine();
  try {
    rmSync(dataDir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  } catch {
    // 临时目录清理失败不影响断言（Windows SQLite 句柄可能未即时释放）
  }
});

function makeGateway(config: Record<string, unknown> = {}): SessionGateway {
  const gw = new SessionGateway({
    storageConfig: {
      type: StorageType.FILESYSTEM,
      basePath: join(dataDir, 'sessions', WORKTREE_HASH),
    },
    ...config,
  } as never);
  gateways.push(gw);
  return gw;
}

describe('SessionRouter 接线（U7/§21.6）', () => {
  test('① keyFactory 就绪 + wireServices ⇒ sessionRouter 已注入（原恒 null）', () => {
    const gw = makeGateway({
      keyFactoryConfig: { userId: 'u1', chatType: 'repl' },
      wireServices: true,
    });
    expect(gw.getSessionRouter()).not.toBeNull();
  });

  test('② 未配置 keyFactory ⇒ 不注入（无 keyFactory 无法构造 router，保持旧行为）', () => {
    const gw = makeGateway({ wireServices: true });
    expect(gw.getSessionRouter()).toBeNull();
  });

  test('③ wireWithRealServices() 亦注入，且**幂等**（重复调用同一实例）', () => {
    const gw = makeGateway({
      keyFactoryConfig: { userId: 'u1', chatType: 'repl' },
    });
    expect(gw.getSessionRouter()).toBeNull(); // 默认不 wire

    gw.wireWithRealServices();
    const first = gw.getSessionRouter();
    expect(first).not.toBeNull();

    gw.wireWithRealServices();
    expect(gw.getSessionRouter()).toBe(first); // 幂等：不重建
  });

  test('④ route() 产出结构化键且 resolve() 可反解；如实锁定**非确定性**', () => {
    const router = new SessionRouter(
      new SessionKeyFactory({ userId: 'u', chatType: 'repl' })
    );
    const source = {
      userId: 'alice',
      platform: 'telegram',
      chatType: 'dm',
    } as never;

    const k1 = router.route(source);
    const k2 = router.route(source);

    // 结构化：前缀 + userId 段（可被 resolve 反解）
    expect(k1.startsWith('sess:alice:')).toBe(true);
    // 非确定性（键内含 timestamp + uuid）⇒ 同一来源两次不同 id，**不是**"按来源去重"
    expect(k1).not.toBe(k2);
    // 反解可用（这正是"结构化键"的收益）
    expect(router.resolve(k1)?.userId).toBe('alice');
  });
});
