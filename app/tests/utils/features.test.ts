import { describe, it, expect } from 'bun:test';
import {
  isAntUser,
  isSimpleMode,
} from '../../src/utils/features.js';

describe('isAntUser', () => {

  it('should return false when USER_TYPE is not set', () => {
    const orig = process.env.USER_TYPE;
    delete process.env.USER_TYPE;
    expect(isAntUser()).toBe(false);
    process.env.USER_TYPE = orig;
  });

  it('should return true when USER_TYPE is ant', () => {
    const orig = process.env.USER_TYPE;
    process.env.USER_TYPE = 'ant';
    expect(isAntUser()).toBe(true);
    process.env.USER_TYPE = orig;
  });

});

describe('isSimpleMode', () => {

  it('should return false when env not set', () => {
    const orig = process.env.PYAPP_SIMPLE_MODE;
    delete process.env.PYAPP_SIMPLE_MODE;
    expect(isSimpleMode()).toBe(false);
    process.env.PYAPP_SIMPLE_MODE = orig;
  });

  it('should return true when PYAPP_SIMPLE_MODE is true', () => {
    const orig = process.env.PYAPP_SIMPLE_MODE;
    process.env.PYAPP_SIMPLE_MODE = 'true';
    expect(isSimpleMode()).toBe(true);
    process.env.PYAPP_SIMPLE_MODE = orig;
  });

  it('should return false when PYAPP_SIMPLE_MODE is false', () => {
    const orig = process.env.PYAPP_SIMPLE_MODE;
    process.env.PYAPP_SIMPLE_MODE = 'false';
    expect(isSimpleMode()).toBe(false);
    process.env.PYAPP_SIMPLE_MODE = orig;
  });

});
