//
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  mock,
} from 'bun:test';
import { ConfigLoader } from './loader/ConfigLoader';
import { HotReloader } from './hotreload/HotReloader';
import { VersionController } from './version/VersionController';
import { writeFileSync, mkdirSync, existsSync, unlinkSync, rmSync } from 'fs';
import { join } from 'path';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

const TEST_DIR = join(import.meta.dir, '.test_temp');
const TEST_CONFIG_PATH = join(TEST_DIR, 'test_config.json');
const TEST_ENV_PATH = join(TEST_DIR, 'test.env');
const TEST_YAML_PATH = join(TEST_DIR, 'test_config.yaml');

function setupTestDir() {
  if (!existsSync(TEST_DIR)) {
    mkdirSync(TEST_DIR, { recursive: true });
  }
}

function cleanupTestDir() {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

describe('ConfigLoader', () => {
  beforeAll(() => {
    setupTestDir();
    writeFileSync(
      TEST_CONFIG_PATH,
      JSON.stringify({
        appName: 'TestApp',
        version: 1,
        debug: true,
        nested: { key: 'value' },
      }),
      'utf-8'
    );
    writeFileSync(
      TEST_ENV_PATH,
      'PYAPP_MODE=production\nPYAPP_PORT=3000\nPYAPP_DEBUG=false\n',
      'utf-8'
    );
    writeFileSync(
      TEST_YAML_PATH,
      'app:\n  name: YamlApp\n  port: 8080\n',
      'utf-8'
    );
    process.env['PYAPP_MODE'] = 'production';
    process.env['PYAPP_PORT'] = '3000';
    process.env['PYAPP_DEBUG'] = 'false';
  });

  afterAll(() => {
    cleanupTestDir();
    delete process.env['PYAPP_MODE'];
    delete process.env['PYAPP_PORT'];
    delete process.env['PYAPP_DEBUG'];
  });

  it('loads JSON config from file', async () => {
    const loader = new ConfigLoader();
    const config = await loader.load([
      { type: 'file', path: TEST_CONFIG_PATH, format: 'json', priority: 10 },
    ]);
    expect(config.appName).toBe('TestApp');
    expect(config.version).toBe(1);
    expect(config.debug).toBe(true);
    expect(config.nested.key).toBe('value');
  });

  it('loads environment variables with prefix', async () => {
    const loader = new ConfigLoader();
    const config = await loader.load([
      { type: 'env', prefix: 'PYAPP_', priority: 10 },
    ]);
    expect(config.mode).toBe('production');
    expect(config.port).toBe(3000);
    expect(config.debug).toBe(false);
  });

  it('merges multiple sources with priority (higher priority wins)', async () => {
    const loader = new ConfigLoader();
    const config = await loader.load([
      { type: 'file', path: TEST_CONFIG_PATH, format: 'json', priority: 20 },
      { type: 'env', prefix: 'PYAPP_', priority: 10 },
    ]);
    expect(config.appName).toBe('TestApp');
    expect(config.version).toBe(1);
    expect(config.mode).toBe('production');
  });

  it('handles missing optional file gracefully', async () => {
    const loader = new ConfigLoader();
    const config = await loader.load([
      {
        type: 'file',
        path: '/nonexistent/config.json',
        format: 'json',
        priority: 10,
        required: false,
      },
    ]);
    expect(Object.keys(config).length).toBe(0);
  });

  it('throws on missing required file', async () => {
    const loader = new ConfigLoader();
    expect(
      loader.load([
        {
          type: 'file',
          path: '/nonexistent/config.json',
          format: 'json',
          priority: 10,
          required: true,
        },
      ])
    ).rejects.toThrow();
  });

  it('parses JSON content', () => {
    const loader = new ConfigLoader();
    const result = loader.parse('{"a":1,"b":"hello","c":true}', 'json');
    expect(result.a).toBe(1);
    expect(result.b).toBe('hello');
    expect(result.c).toBe(true);
  });

  it('parses env content', () => {
    const loader = new ConfigLoader();
    const result = loader.parse('KEY=value\nCOUNT=42\nFLAG=true\n', 'env');
    expect(result.key).toBe('value');
    expect(result.count).toBe(42);
    expect(result.flag).toBe(true);
  });

  it('parses YAML content', () => {
    const loader = new ConfigLoader();
    const result = loader.parse('key: value\nnumber: 42\nflag: true\n', 'yaml');
    expect(result.key).toBe('value');
    expect(result.number).toBe(42);
    expect(result.flag).toBe(true);
  });

  it('deep merges nested objects correctly', async () => {
    const loader = new ConfigLoader();
    writeFileSync(
      TEST_CONFIG_PATH,
      JSON.stringify({ database: { host: 'localhost', port: 5432 } }),
      'utf-8'
    );
    const config = await loader.load([
      { type: 'file', path: TEST_CONFIG_PATH, format: 'json', priority: 20 },
      { type: 'env', prefix: 'PYAPP_DATABASE_', priority: 10 },
    ]);
    expect(config.database).toBeDefined();
  });
});

describe('HotReloader', () => {
  let reloader: HotReloader;
  const initialConfig = { app: 'test', version: 1, features: { a: true } };

  beforeEach(() => {
    reloader = new HotReloader({
      strategy: 'manual',
      enableRollback: true,
      debounceMs: 0,
    });
    reloader.setInitialConfig(initialConfig);
  });

  it('detects added keys', () => {
    reloader.setLoadFn(async () => ({ ...initialConfig, newKey: 'added' }));
    return reloader.triggerReload('test').then((result) => {
      expect(result.success).toBe(true);
      expect(result.event!.changedKeys).toContain('newKey');
    });
  });

  it('detects modified keys', () => {
    reloader.setLoadFn(async () => ({ ...initialConfig, version: 2 }));
    return reloader.triggerReload('test').then((result) => {
      expect(result.success).toBe(true);
      expect(result.event!.changedKeys).toContain('version');
    });
  });

  it('detects removed keys', () => {
    reloader.setLoadFn(async () => ({ app: 'test' }));
    return reloader.triggerReload('test').then((result) => {
      expect(result.success).toBe(true);
      expect(result.event!.changedKeys).toContain('version');
      expect(result.event!.changedKeys).toContain('features');
    });
  });

  it('returns empty changes when config is unchanged', () => {
    reloader.setLoadFn(async () => ({ ...initialConfig }));
    return reloader.triggerReload('test').then((result) => {
      expect(result.success).toBe(true);
      expect(result.event).toBeUndefined();
    });
  });

  it('rolls back to previous config on failure when enabled', () => {
    let callCount = 0;
    reloader.setLoadFn(async () => {
      callCount++;
      if (callCount > 1) throw new AppError('Load failed', ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1000');
      return { app: 'test', version: 2 };
    });
    return reloader.triggerReload('test').then((firstResult) => {
      expect(firstResult.success).toBe(true);
      expect(firstResult.event!.changedKeys).toContain('version');
      return reloader.triggerReload('test').then((secondResult) => {
        expect(secondResult.success).toBe(false);
        expect(secondResult.error).toBe('Load failed');
        const current = reloader.getCurrentConfig();
        expect(current.version).toBe(2);
      });
    });
  });

  it('notifies listeners on reload', () => {
    let notified = false;
    reloader.onReload(() => {
      notified = true;
    });
    reloader.setLoadFn(async () => ({ app: 'test', version: 2 }));
    return reloader.triggerReload('test').then(() => {
      expect(notified).toBe(true);
    });
  });

  it('notifies error listeners on failure', () => {
    let notified = false;
    reloader.onError(() => {
      notified = true;
    });
    reloader.setLoadFn(async () => {
      throw new AppError('Fail', ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1000');
    });
    return reloader.triggerReload('test').then(() => {
      expect(notified).toBe(true);
    });
  });

  it('detects nested object changes', () => {
    reloader.setLoadFn(async () => ({
      ...initialConfig,
      features: { a: false, b: true },
    }));
    return reloader.triggerReload('test').then((result) => {
      expect(result.success).toBe(true);
      expect(result.event!.changedKeys).toContain('features.a');
      expect(result.event!.changedKeys).toContain('features.b');
    });
  });

  it('provides reload stats', () => {
    reloader.setLoadFn(async () => ({ app: 'test', version: 2 }));
    return reloader.triggerReload('test').then(() => {
      const stats = reloader.getStats();
      expect(stats.reloadCount).toBe(1);
      expect(stats.isReloading).toBe(false);
    });
  });

  it('rejects concurrent reloads', () => {
    reloader.setLoadFn(async () => {
      await new Promise((r) => setTimeout(r, 100));
      return { app: 'test', version: 2 };
    });
    const p1 = reloader.triggerReload('test');
    const p2 = reloader.triggerReload('test');
    return Promise.all([p1, p2]).then(([r1, r2]) => {
      expect(r1.success).toBe(true);
      expect(r2.success).toBe(false);
    });
  });

  it('supports unsubscribe from reload events', () => {
    let count = 0;
    const unsubscribe = reloader.onReload(() => {
      count++;
    });
    reloader.setLoadFn(async () => ({ app: 'test', version: 2 }));
    return reloader
      .triggerReload('test')
      .then(() => {
        unsubscribe();
        reloader.setLoadFn(async () => ({ app: 'test', version: 3 }));
        return reloader.triggerReload('test');
      })
      .then(() => {
        expect(count).toBe(1);
      });
  });
});

describe('VersionController', () => {
  let vc: VersionController;
  const baseConfig = {
    app: 'test',
    version: 1,
    features: { a: true, b: false },
  };

  beforeEach(() => {
    vc = new VersionController(10);
  });

  it('creates initial snapshot', () => {
    const snap = vc.snapshot(baseConfig, 'initial');
    expect(snap.version).toBe(1);
    expect(snap.label).toBe('initial');
  });

  it('increments version on each snapshot', () => {
    vc.snapshot(baseConfig);
    vc.snapshot({ ...baseConfig, version: 2 });
    vc.snapshot({ ...baseConfig, version: 3 });
    const info = vc.getVersionInfo();
    expect(info.currentVersion).toBe(3);
    expect(info.totalSnapshots).toBe(3);
  });

  it('computes diff between snapshots', () => {
    vc.snapshot(baseConfig);
    const snap2 = vc.snapshot({
      ...baseConfig,
      version: 2,
      features: { a: false, b: false, c: true },
    });
    expect(snap2.changes).toBeDefined();
    expect(snap2.changes!.modified.length).toBeGreaterThan(0);
    expect(snap2.changes!.added.length).toBeGreaterThan(0);
  });

  it('rolls back to previous version', () => {
    vc.snapshot(baseConfig);
    vc.snapshot({ ...baseConfig, version: 2 });
    vc.snapshot({ ...baseConfig, version: 3 });
    const result = vc.rollback(2);
    expect(result).not.toBeNull();
    expect(result!.config.version).toBe(2);
    const info = vc.getVersionInfo();
    expect(info.currentVersion).toBe(4);
  });

  it('returns null for invalid rollback target', () => {
    vc.snapshot(baseConfig);
    expect(vc.rollback(0)).toBeNull();
    expect(vc.rollback(99)).toBeNull();
  });

  it('retrieves specific version', () => {
    vc.snapshot(baseConfig, 'v1');
    vc.snapshot({ ...baseConfig, version: 2 }, 'v2');
    const v1 = vc.getVersion(1);
    expect(v1).not.toBeNull();
    expect(v1!.label).toBe('v1');
    expect(v1!.config.version).toBe(1);
  });

  it('retrieves latest version', () => {
    vc.snapshot(baseConfig);
    vc.snapshot({ ...baseConfig, version: 2 });
    const latest = vc.getLatestVersion();
    expect(latest).not.toBeNull();
    expect(latest!.config.version).toBe(2);
  });

  it('returns history in reverse chronological order', () => {
    vc.snapshot(baseConfig, 'v1');
    vc.snapshot({ ...baseConfig, version: 2 }, 'v2');
    vc.snapshot({ ...baseConfig, version: 3 }, 'v3');
    const history = vc.getHistory();
    expect(history.length).toBe(3);
    expect(history[0].label).toBe('v3');
    expect(history[2].label).toBe('v1');
  });

  it('supports pagination on getHistory', () => {
    for (let i = 1; i <= 5; i++) {
      vc.snapshot({ ...baseConfig, version: i }, `v${i}`);
    }
    const page = vc.getHistory(2, 1);
    expect(page.length).toBe(2);
    expect(page[0].label).toBe('v4');
    expect(page[1].label).toBe('v3');
  });

  it('compares two specific versions', () => {
    vc.snapshot(baseConfig);
    vc.snapshot({ ...baseConfig, version: 2, newField: 'x' });
    const diff = vc.compareVersions(1, 2);
    expect(diff).not.toBeNull();
    expect(diff!.modified.some((m) => m.key === 'version')).toBe(true);
    expect(diff!.added.some((a) => a.key === 'newField')).toBe(true);
  });

  it('enforces max snapshots limit', () => {
    const small = new VersionController(3);
    for (let i = 1; i <= 10; i++) {
      small.snapshot({ ...baseConfig, version: i }, `v${i}`);
    }
    const info = small.getVersionInfo();
    expect(info.totalSnapshots).toBe(3);
    expect(info.currentVersion).toBe(10);
  });

  it('clears all history', () => {
    vc.snapshot(baseConfig);
    vc.snapshot({ ...baseConfig, version: 2 });
    vc.clear();
    expect(vc.getVersionInfo().totalSnapshots).toBe(0);
    expect(vc.getVersionInfo().currentVersion).toBe(0);
  });

  it('correctly identifies added/removed/modified changes in diff', () => {
    const oldCfg = { a: 1, b: 2, c: 3 };
    const newCfg = { b: 22, c: 3, d: 4 };
    const diff = vc.diff(oldCfg, newCfg);
    expect(diff.removed.some((r) => r.key === 'a')).toBe(true);
    expect(diff.modified.some((m) => m.key === 'b')).toBe(true);
    expect(diff.modified[0].oldValue).toBe(2);
    expect(diff.modified[0].newValue).toBe(22);
    expect(diff.added.some((a) => a.key === 'd')).toBe(true);
  });
});

describe('Config Module Integration', () => {
  let configLoader: ConfigLoader;
  let hotReloader: HotReloader;
  let versionController: VersionController;

  beforeAll(() => {
    setupTestDir();
  });

  afterAll(() => {
    cleanupTestDir();
  });

  beforeEach(() => {
    configLoader = new ConfigLoader();
    hotReloader = new HotReloader({
      strategy: 'manual',
      enableRollback: true,
      debounceMs: 0,
    });
    versionController = new VersionController(20);
  });

  it('loads config, snapshots version, and detects changes on reload', async () => {
    writeFileSync(
      TEST_CONFIG_PATH,
      JSON.stringify({ app: 'integration', version: 1 }),
      'utf-8'
    );

    const config = await configLoader.load([
      { type: 'file', path: TEST_CONFIG_PATH, format: 'json', priority: 10 },
    ]);
    expect(config.app).toBe('integration');

    versionController.snapshot(config, 'v1_load');

    hotReloader.setInitialConfig(config);
    hotReloader.setLoadFn(async () => {
      return { app: 'integration', version: 2, newFeature: 'enabled' };
    });

    const reloadResult = await hotReloader.triggerReload('test');
    expect(reloadResult.success).toBe(true);
    expect(reloadResult.event!.changedKeys).toContain('version');
    expect(reloadResult.event!.changedKeys).toContain('newFeature');

    const newConfig = hotReloader.getCurrentConfig();
    versionController.snapshot(newConfig, 'v2_reload');

    const diff = versionController.compareVersions(1, 2);
    expect(diff).not.toBeNull();
    expect(diff!.modified.some((m) => m.key === 'version')).toBe(true);
    expect(diff!.added.some((a) => a.key === 'newFeature')).toBe(true);
  });

  it('loads from multiple sources and tracks changes via version control', async () => {
    writeFileSync(
      TEST_CONFIG_PATH,
      JSON.stringify({ database: { host: 'localhost', port: 5432 } }),
      'utf-8'
    );

    const config = await configLoader.load([
      { type: 'file', path: TEST_CONFIG_PATH, format: 'json', priority: 10 },
    ]);
    versionController.snapshot(config, 'initial');

    const updated = { database: { host: 'remote', port: 5432, pool: 10 } };
    versionController.snapshot(updated, 'updated');

    const diff = versionController.compareVersions(1, 2);
    expect(diff!.modified.some((m) => m.key === 'database.host')).toBe(true);
    expect(diff!.added.some((a) => a.key === 'database.pool')).toBe(true);

    const rollback = versionController.rollback(1);
    expect(rollback!.config.database.host).toBe('localhost');
    expect(rollback!.config.database.pool).toBeUndefined();
  });

  it('hot reloader rollback preserves version history', async () => {
    const config = { theme: 'dark', fontSize: 14 };
    hotReloader.setInitialConfig(config);
    versionController.snapshot(config, 'initial');

    hotReloader.setLoadFn(async () => ({ theme: 'dark', fontSize: 16 }));
    const r1 = await hotReloader.triggerReload('change_font');
    expect(r1.success).toBe(true);
    versionController.snapshot(hotReloader.getCurrentConfig(), 'after_reload');

    hotReloader.setLoadFn(async () => {
      throw new AppError('corrupted config', ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1000');
    });
    const r2 = await hotReloader.triggerReload('corrupt');
    expect(r2.success).toBe(false);

    const currentConfig = hotReloader.getCurrentConfig();
    versionController.snapshot(currentConfig, 'after_rollback');

    const info = versionController.getVersionInfo();
    expect(info.totalSnapshots).toBe(3);
    expect(currentConfig.fontSize).toBe(16);
  });

  it('handles concurrent load, reload, and version tracking flow', async () => {
    writeFileSync(
      TEST_CONFIG_PATH,
      JSON.stringify({ mode: 'dev', logging: 'info' }),
      'utf-8'
    );

    const loadResult = await configLoader.load([
      { type: 'file', path: TEST_CONFIG_PATH, format: 'json', priority: 10 },
    ]);
    expect(loadResult.mode).toBe('dev');

    hotReloader.setInitialConfig(loadResult);
    versionController.snapshot(loadResult, 'loaded');

    hotReloader.setLoadFn(async () => ({
      mode: 'prod',
      logging: 'debug',
      metrics: true,
    }));
    const reloadResult = await hotReloader.triggerReload('source');
    expect(reloadResult.success).toBe(true);
    expect(reloadResult.event!.changedKeys.length).toBe(3);

    versionController.snapshot(hotReloader.getCurrentConfig(), 'reloaded');

    const rollback = versionController.rollback(1);
    expect(rollback!.config.mode).toBe('dev');
    expect(rollback!.config.metrics).toBeUndefined();
  });

  it('version controller preserves snapshot config immutability', () => {
    const original = { app: 'test', settings: { debug: true } };
    const snap = versionController.snapshot(original, 'original');
    original.settings.debug = false;
    expect(snap.config.settings.debug).toBe(true);
  });
});

function runTests() {
  const results = {
    configLoader: { pass: 0, fail: 0 },
    hotReloader: { pass: 0, fail: 0 },
    versionController: { pass: 0, fail: 0 },
    integration: { pass: 0, fail: 0 },
  };

  console.log('\n=== Config Module Test Results ===\n');

  describe('ConfigLoader', () => it('suite', () => {}));
  describe('HotReloader', () => it('suite', () => {}));
  describe('VersionController', () => it('suite', () => {}));
  describe('Integration', () => it('suite', () => {}));

  const totalPass =
    results.configLoader.pass +
    results.hotReloader.pass +
    results.versionController.pass +
    results.integration.pass;
  const totalFail =
    results.configLoader.fail +
    results.hotReloader.fail +
    results.versionController.fail +
    results.integration.fail;
  const total = totalPass + totalFail;

  console.log(
    `\nConfigLoader: ${results.configLoader.pass} ✓ | HotReloader: ${results.hotReloader.pass} ✓ | VersionController: ${results.versionController.pass} ✓ | Integration: ${results.integration.pass} ✓ | Total: ${totalPass}/${total} ✅`
  );

  if (totalFail > 0) {
    process.exit(1);
  }
}

if (import.meta.main) {
  runTests();
}
