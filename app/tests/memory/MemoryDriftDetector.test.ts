// MIT License
// Copyright (c) 2026 190615273@qq.com
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { writeFileSync, unlinkSync, existsSync, readFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { MemoryDriftDetector, getMemoryDriftDetector } from '../../src/memory/MemoryDriftDetector';

const testDir = join(tmpdir(), `drift-test-${randomUUID()}.d`);

describe('MemoryDriftDetector', () => {
  beforeEach(() => {
    if (!existsSync(testDir)) mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    try { if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  it('snapshot returns null for non-existent file', () => {
    const detector = new MemoryDriftDetector();
    const snap = detector.snapshot(join(testDir, 'nonexistent.md'));
    expect(snap).toBeNull();
  });

  it('snapshot captures checksum and size', () => {
    const detector = new MemoryDriftDetector();
    const filePath = join(testDir, 'test.md');
    writeFileSync(filePath, 'hello world');

    const snap = detector.snapshot(filePath);
    expect(snap).not.toBeNull();
    expect(snap!.filePath).toBe(filePath);
    expect(snap!.checksum).toHaveLength(64);
    expect(snap!.size).toBe(11);
    expect(snap!.originalContent.toString()).toBe('hello world');
  });

  it('check reports no drift for unchanged file', () => {
    const detector = new MemoryDriftDetector();
    const filePath = join(testDir, 'stable.md');
    writeFileSync(filePath, 'stable content');

    detector.snapshot(filePath);
    const result = detector.check(filePath);

    expect(result.drifted).toBe(false);
    expect(result.reason).toBe('checksum match');
  });

  it('check detects external modification', () => {
    const detector = new MemoryDriftDetector();
    const filePath = join(testDir, 'mod.md');
    writeFileSync(filePath, 'original');

    detector.snapshot(filePath);
    writeFileSync(filePath, 'modified externally!');

    const result = detector.check(filePath);
    expect(result.drifted).toBe(true);
    expect(result.reason).toContain('Checksum mismatch');
  });

  it('check detects file deletion', () => {
    const detector = new MemoryDriftDetector();
    const filePath = join(testDir, 'del.md');
    writeFileSync(filePath, 'content');
    detector.snapshot(filePath);
    unlinkSync(filePath);

    const result = detector.check(filePath);
    expect(result.drifted).toBe(true);
    expect(result.reason).toBe('file deleted externally');
  });

  it('check restores original content on drift', () => {
    const detector = new MemoryDriftDetector();
    const filePath = join(testDir, 'restore.md');
    writeFileSync(filePath, 'original content');

    detector.snapshot(filePath);
    writeFileSync(filePath, 'corrupted!');

    const result = detector.check(filePath);
    expect(result.drifted).toBe(true);

    const restored = readFileSync(filePath, 'utf-8');
    expect(restored).toBe('original content');
  });

  it('check returns no snapshot for untracked file', () => {
    const detector = new MemoryDriftDetector();
    const filePath = join(testDir, 'untracked.md');
    writeFileSync(filePath, 'content');

    const result = detector.check(filePath);
    expect(result.drifted).toBe(false);
    expect(result.reason).toBe('no snapshot');
  });

  it('remove clears snapshot', () => {
    const detector = new MemoryDriftDetector();
    const filePath = join(testDir, 'remove-test.md');
    writeFileSync(filePath, 'content');

    detector.snapshot(filePath);
    detector.remove(filePath);

    const result = detector.check(filePath);
    expect(result.reason).toBe('no snapshot');
  });

  it('getTrackedFiles lists all snapshotted files', () => {
    const detector = new MemoryDriftDetector();
    const f1 = join(testDir, 'f1.md');
    const f2 = join(testDir, 'f2.md');
    writeFileSync(f1, 'a');
    writeFileSync(f2, 'b');

    detector.snapshot(f1);
    detector.snapshot(f2);

    const tracked = detector.getTrackedFiles();
    expect(tracked).toContain(f1);
    expect(tracked).toContain(f2);
    expect(tracked).toHaveLength(2);
  });
});

describe('getMemoryDriftDetector (singleton)', () => {
  it('returns the same instance', () => {
    const a = getMemoryDriftDetector();
    const b = getMemoryDriftDetector();
    expect(a).toBe(b);
  });
});
