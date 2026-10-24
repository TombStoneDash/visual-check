import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { htmlReportPathFor } from '../src/html-report.js';
import { receiptPathFor } from '../src/receipt.js';
import { assertDistinctOutputPaths, UsageError } from '../src/cli-args.js';

describe('htmlReportPathFor', () => {
  it('puts the HTML report next to the JSON report', () => {
    expect(htmlReportPathFor(path.join('reports', 'latest.json'))).toBe(path.join('reports', 'latest.html'));
    expect(htmlReportPathFor('report')).toBe('report.html');
  });

  it('never returns the JSON path itself', () => {
    expect(htmlReportPathFor(path.join('out', 'r.html'))).toBe(path.join('out', 'r.report.html'));
    const json = path.join('out', 'r.html');
    expect(path.resolve(htmlReportPathFor(json))).not.toBe(path.resolve(json));
    expect(path.resolve(receiptPathFor(json))).not.toBe(path.resolve(htmlReportPathFor(json)));
  });
});

describe('assertDistinctOutputPaths', () => {
  it('accepts distinct paths and skips disabled outputs', () => {
    expect(() =>
      assertDistinctOutputPaths([
        ['--json', 'r.json'],
        ['--html', null],
        ['--receipt', undefined],
        ['--other', 'r.html'],
      ]),
    ).not.toThrow();
  });

  it('names both flags when two resolve to the same file', () => {
    expect(() =>
      assertDistinctOutputPaths([
        ['--json', 'out/r.json'],
        ['--html', path.resolve('out', 'r.json')],
      ]),
    ).toThrow(UsageError);
    expect(() =>
      assertDistinctOutputPaths([
        ['--json', 'out/r.json'],
        ['--receipt', './out/../out/r.json'],
      ]),
    ).toThrow(/--json and --receipt both point at/);
  });
});
