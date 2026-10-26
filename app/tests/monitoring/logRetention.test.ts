/**
 * LRO-14（2026-10-26）：日志轮转**保留上限**的选择逻辑
 *
 * 背景：`rotateLogs()` 此前只把超阈值文件改名、**从不删除** ⇒ 实测已积 10 个轮转文件（≈130MB）。
 * 本用例钉住"只删最旧、保留最近 N 个"，并守住三条安全边界：
 * 不误删当前 `app.log`、不误删非轮转文件、`keep<=0` 时一个都不删。
 */

import { describe, expect, it } from 'bun:test';

import { selectRotatedLogsToDelete } from '../../src/monitoring/MonitoringService';

const rotated = (iso: string): string => `app.log.${iso}`;

describe('selectRotatedLogsToDelete（日志保留上限）', () => {
  it('保留最近 N 个，删除更旧的（按文件名内 ISO 排序）', () => {
    const names = [
      rotated('2026-10-24T09-46-01-530Z'),
      rotated('2026-10-25T22-49-26-782Z'),
      rotated('2026-10-26T05-49-26-792Z'),
      rotated('2026-10-23T10-01-09-188Z'),
    ];
    expect(selectRotatedLogsToDelete(names, 2)).toEqual([
      rotated('2026-10-23T10-01-09-188Z'),
      rotated('2026-10-24T09-46-01-530Z'),
    ]);
  });

  it('数量未超上限 ⇒ 不删任何文件', () => {
    const names = [rotated('2026-10-26T05-49-26-792Z')];
    expect(selectRotatedLogsToDelete(names, 10)).toEqual([]);
    expect(selectRotatedLogsToDelete([], 10)).toEqual([]);
  });

  it('`keep <= 0` 视为不限 ⇒ 一个都不删（防误配清空日志）', () => {
    const names = [
      rotated('2026-10-24T09-46-01-530Z'),
      rotated('2026-10-26T05-49-26-792Z'),
    ];
    expect(selectRotatedLogsToDelete(names, 0)).toEqual([]);
    expect(selectRotatedLogsToDelete(names, -1)).toEqual([]);
  });

  it('不误删当前 app.log 与非轮转文件', () => {
    const names = [
      'app.log',
      'startup-error.log',
      'other.txt',
      'app.log.2026-10-26T05-49-26-792Z',
    ];
    // 只有 1 个轮转文件 ⇒ keep=1 时无删除；keep=0（不限）也不删
    expect(selectRotatedLogsToDelete(names, 1)).toEqual([]);
    expect(selectRotatedLogsToDelete(names, 0)).toEqual([]);
  });

  it('多个轮转文件时只针对轮转名（当前文件永远不在删除集里）', () => {
    const names = [
      'app.log',
      rotated('2026-10-24T09-46-01-530Z'),
      rotated('2026-10-25T22-49-26-782Z'),
      rotated('2026-10-26T05-49-26-792Z'),
    ];
    const del = selectRotatedLogsToDelete(names, 1);
    expect(del).toEqual([
      rotated('2026-10-24T09-46-01-530Z'),
      rotated('2026-10-25T22-49-26-782Z'),
    ]);
    expect(del).not.toContain('app.log');
  });
});
