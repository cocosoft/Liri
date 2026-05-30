import { describe, it, expect, spyOn, afterEach } from 'bun:test';
import {
  StartupProfiler,
  createStartupProfiler,
} from '../../src/utils/startupProfiler.js';

describe('StartupProfiler', () => {

  afterEach(() => {
    spyOn(console, 'log').mockRestore();
  });

  it('should create instance without errors', () => {
    const profiler = new StartupProfiler();
    expect(profiler).toBeDefined();
  });

  it('should start with empty checkpoints', () => {
    const profiler = new StartupProfiler();
    expect(profiler.getCheckpoints()).toEqual([]);
  });

  it('should record checkpoint with duration', () => {
    const profiler = new StartupProfiler();
    profiler.checkpoint('init');
    const checkpoints = profiler.getCheckpoints();
    expect(checkpoints).toHaveLength(1);
    expect(checkpoints[0].name).toBe('init');
    expect(checkpoints[0].duration).toBeGreaterThanOrEqual(0);
  });

  it('should record multiple checkpoints in order', () => {
    const profiler = new StartupProfiler();
    profiler.checkpoint('first');
    profiler.checkpoint('second');
    const checkpoints = profiler.getCheckpoints();
    expect(checkpoints).toHaveLength(2);
    expect(checkpoints[0].name).toBe('first');
    expect(checkpoints[1].name).toBe('second');
    expect(checkpoints[1].duration).toBeGreaterThanOrEqual(
      checkpoints[0].duration
    );
  });

  it('should generate report with total duration', () => {
    const profiler = new StartupProfiler();
    profiler.checkpoint('step1');
    profiler.checkpoint('step2');
    const report = profiler.generateReport();
    expect(report.totalDuration).toBeGreaterThanOrEqual(0);
    expect(report.checkpoints).toHaveLength(2);
  });

  it('should use end time from last checkpoint when stopped', () => {
    const profiler = new StartupProfiler();
    profiler.checkpoint('step1');
    profiler.stop();
    const report = profiler.generateReport();
    expect(report.totalDuration).toBeGreaterThanOrEqual(0);
    expect(report.checkpoints[0].name).toBe('step1');
  });

  it('should handle stop before any checkpoints', () => {
    const profiler = new StartupProfiler();
    profiler.stop();
    const report = profiler.generateReport();
    expect(report.totalDuration).toBeGreaterThanOrEqual(0);
    expect(report.checkpoints).toHaveLength(0);
  });

  it('should start fresh when start() is called', () => {
    const profiler = new StartupProfiler();
    profiler.checkpoint('old');
    profiler.start();
    expect(profiler.getCheckpoints()).toEqual([]);
  });

  it('should print report via console.log', () => {
    const spy = spyOn(console, 'log').mockImplementation(() => {});
    const profiler = new StartupProfiler();
    profiler.checkpoint('test');
    profiler.printReport();
    expect(spy).toHaveBeenCalled();
  });

  it('should return checkpoints copy (immutable)', () => {
    const profiler = new StartupProfiler();
    profiler.checkpoint('test');
    const checkpoints = profiler.getCheckpoints();
    checkpoints.push({ name: 'fake', timestamp: 0, duration: 0 });
    expect(profiler.getCheckpoints()).toHaveLength(1);
  });

});

describe('createStartupProfiler', () => {

  it('should create StartupProfiler instance', () => {
    const profiler = createStartupProfiler();
    expect(profiler).toBeInstanceOf(StartupProfiler);
  });

});
