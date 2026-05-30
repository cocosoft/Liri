import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import {
  setUserDataDirOverride,
  getUserDataDirOverride,
  resolvePyappHome,
  resolveProjectRoot,
  resolveDataDir,
  resolveDocsDir,
  resolveConfigDir,
  resolveDbPath,
  resolveSessionsDir,
  resolveTranscriptsDir,
  resolveMemoryDir,
  resolveCacheDir,
  resolveLogsDir,
  resolveArtifactsDir,
  resolveUserConfigPath,
  resolveUserSettingsPath,
  resolveSoulPath,
  resolveDataSubDir,
  resolveSessionFilePath,
  resolveTranscriptFilePath,
  ensureDir,
  ensureDataDirectories,
  PYAPP_HOME,
  PROJECT_ROOT,
} from '../../src/config/paths.js';

describe('setUserDataDirOverride / getUserDataDirOverride', () => {

  afterEach(() => {
    setUserDataDirOverride(null);
  });

  it('should default to null', () => {
    expect(getUserDataDirOverride()).toBeNull();
  });

  it('should set and get override value', () => {
    setUserDataDirOverride('/custom/path');
    expect(getUserDataDirOverride()).toBe('/custom/path');
  });

  it('should reset to null when set to null', () => {
    setUserDataDirOverride('/custom/path');
    setUserDataDirOverride(null);
    expect(getUserDataDirOverride()).toBeNull();
  });

});

describe('resolvePyappHome', () => {

  it('should use override when set', () => {
    setUserDataDirOverride('/override/path');
    const result = resolvePyappHome({});
    expect(result).toContain('override');
    expect(result).toContain('path');
    setUserDataDirOverride(null);
  });

  it('should use PYAPP_HOME env var', () => {
    const result = resolvePyappHome({ PYAPP_HOME: '/env/pyapp' });
    expect(result).toContain('env');
    expect(result).toContain('pyapp');
  });

  it('should resolve to an absolute path', () => {
    const result = resolvePyappHome({});
    expect(result).toBeTruthy();
    expect(typeof result).toBe('string');
  });

});

describe('resolveProjectRoot', () => {

  it('should use PYAPP_PROJECT_DIR env var', () => {
    const result = resolveProjectRoot({ PYAPP_PROJECT_DIR: '/project/path' });
    expect(result).toContain('project');
    expect(result).toContain('path');
  });

  it('should resolve to a non-empty string', () => {
    const result = resolveProjectRoot({});
    expect(result).toBeTruthy();
    expect(typeof result).toBe('string');
  });

});

describe('resolveDataDir', () => {

  it('should use PYAPP_DATA_DIR env var', () => {
    const result = resolveDataDir({ PYAPP_DATA_DIR: '/data/path' });
    expect(result).toContain('data');
    expect(result).toContain('path');
  });

  it('should include app/data in path', () => {
    const result = resolveDataDir({
      PYAPP_PROJECT_DIR: '/test/project',
    });
    expect(result).toContain('app');
    expect(result).toContain('data');
  });

});

describe('path resolvers', () => {

  const testEnv = { PYAPP_PROJECT_DIR: '/test/project' };

  it('should resolve docs dir under project/app/docs', () => {
    const result = resolveDocsDir(testEnv);
    expect(result).toContain('app');
    expect(result).toContain('docs');
  });

  it('should resolve config dir', () => {
    const result = resolveConfigDir(testEnv);
    expect(result).toContain('config');
  });

  it('should resolve db path', () => {
    const result = resolveDbPath(testEnv);
    expect(result).toContain('app.db');
  });

  it('should resolve sessions dir', () => {
    const result = resolveSessionsDir(testEnv);
    expect(result).toContain('sessions');
  });

  it('should resolve transcripts dir', () => {
    const result = resolveTranscriptsDir(testEnv);
    expect(result).toContain('transcripts');
  });

  it('should resolve memory dir', () => {
    const result = resolveMemoryDir(testEnv);
    expect(result).toContain('memory');
  });

  it('should resolve cache dir', () => {
    const result = resolveCacheDir(testEnv);
    expect(result).toContain('cache');
  });

  it('should resolve logs dir', () => {
    const result = resolveLogsDir(testEnv);
    expect(result).toContain('logs');
  });

  it('should resolve artifacts dir', () => {
    const result = resolveArtifactsDir(testEnv);
    expect(result).toContain('artifacts');
  });

});

describe('user path resolvers', () => {

  it('should resolve user config path', () => {
    const result = resolveUserConfigPath({ PYAPP_HOME: '/home/user/.pyapp' });
    expect(result).toContain('pyapp');
    expect(result).toContain('config.json');
  });

  it('should resolve user settings path', () => {
    const result = resolveUserSettingsPath({
      PYAPP_HOME: '/home/user/.pyapp',
    });
    expect(result).toContain('pyapp');
    expect(result).toContain('settings.json');
  });

  it('should resolve soul path', () => {
    const result = resolveSoulPath({ PYAPP_HOME: '/home/user/.pyapp' });
    expect(result).toContain('pyapp');
    expect(result).toContain('SOUL.md');
  });

});

describe('convenience path constructors', () => {

  const testEnv = { PYAPP_PROJECT_DIR: '/p' };

  it('resolveDataSubDir should join subdirectory', () => {
    const result = resolveDataSubDir('custom', testEnv);
    expect(result).toContain('custom');
  });

  it('resolveSessionFilePath should include session id', () => {
    const result = resolveSessionFilePath('sess-123', '.json', testEnv);
    expect(result).toContain('sess-123.json');
  });

  it('resolveSessionFilePath should use .json default ext', () => {
    const result = resolveSessionFilePath('sess-abc', undefined, testEnv);
    expect(result).toContain('sess-abc.json');
  });

  it('resolveTranscriptFilePath should include session id', () => {
    const result = resolveTranscriptFilePath('trans-456', '.json', testEnv);
    expect(result).toContain('trans-456.json');
  });

});

describe('ensureDir', () => {

  it('should create non-existent directory', () => {
    const tmpDir = join(tmpdir(), `test-ensure-dir-${Date.now()}`);
    try {
      ensureDir(tmpDir);
      expect(existsSync(tmpDir)).toBe(true);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('should not throw on existing directory', () => {
    const tmpDir = join(tmpdir(), `test-existing-dir-${Date.now()}`);
    try {
      mkdirSync(tmpDir, { recursive: true });
      expect(() => ensureDir(tmpDir)).not.toThrow();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

});

describe('ensureDataDirectories', () => {

  it('should create all data directories without error', async () => {
    const tmpDir = join(tmpdir(), `test-data-dirs-${Date.now()}`);
    try {
      ensureDataDirectories({
        PYAPP_PROJECT_DIR: tmpDir,
        PYAPP_HOME: join(tmpDir, 'home'),
        PYAPP_DATA_DIR: join(tmpDir, 'app', 'data'),
      });
      expect(existsSync(tmpDir)).toBe(true);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 30000);

});

describe('constants', () => {

  it('should export PYAPP_HOME as a string', () => {
    expect(typeof PYAPP_HOME).toBe('string');
    expect(PYAPP_HOME.length).toBeGreaterThan(0);
  });

  it('should export PROJECT_ROOT as a string', () => {
    expect(typeof PROJECT_ROOT).toBe('string');
    expect(PROJECT_ROOT.length).toBeGreaterThan(0);
  });

});
