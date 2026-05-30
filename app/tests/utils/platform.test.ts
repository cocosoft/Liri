import { describe, it, expect } from 'bun:test';
import {
  getPlatform,
  isWindows,
  isMacOS,
  isLinux,
  isWSL,
  getWslVersion,
} from '../../src/utils/platform.js';

describe('getPlatform', () => {

  it('should return a valid platform string', () => {
    const platform = getPlatform();
    expect(['win32', 'darwin', 'linux', 'wsl', 'unknown']).toContain(platform);
  });

});

describe('isWindows', () => {

  it('should return a boolean', () => {
    expect(typeof isWindows()).toBe('boolean');
  });

  it('should match process.platform check', () => {
    expect(isWindows()).toBe(process.platform === 'win32');
  });

});

describe('isMacOS', () => {

  it('should return a boolean', () => {
    expect(typeof isMacOS()).toBe('boolean');
  });

  it('should match process.platform check', () => {
    expect(isMacOS()).toBe(process.platform === 'darwin');
  });

});

describe('isLinux', () => {

  it('should return a boolean', () => {
    expect(typeof isLinux()).toBe('boolean');
  });

  it('should match process.platform check', () => {
    expect(isLinux()).toBe(process.platform === 'linux');
  });

});

describe('isWSL', () => {

  it('should return a boolean', () => {
    expect(typeof isWSL()).toBe('boolean');
  });

});

describe('getWslVersion', () => {

  it('should return null when not on WSL', () => {
    if (process.platform !== 'linux') {
      expect(getWslVersion()).toBeNull();
    }
  });

});
