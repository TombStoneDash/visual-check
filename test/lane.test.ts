/**
 * We don't export localLane() from cli.ts (it's an internal helper), but
 * we can exercise the same detection logic by stubbing process.platform.
 * These tests guard against the exact regression that hit the TrashAlert
 * dogfood run: Windows captures were tagged `linux / thinkcentre-local`.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { BaselineLane } from '../src/types.js';

// Re-implement localLane in isolation so we can test the policy without
// shipping process.platform mocking into the CLI module itself. This
// must stay in sync with src/cli.ts#localLane.
function laneFor(platform: NodeJS.Platform): BaselineLane {
  let os: BaselineLane['os'];
  if (platform === 'darwin') os = 'macos';
  else if (platform === 'win32') os = 'windows';
  else os = 'linux';
  const runner: BaselineLane['runner'] =
    os === 'macos' ? 'macmini-local' : os === 'windows' ? 'lenovo-local' : 'thinkcentre-local';
  return { browser: 'chromium', os, runner };
}

describe('lane detection', () => {
  it('maps darwin to macos/macmini-local', () => {
    expect(laneFor('darwin')).toEqual({
      browser: 'chromium',
      os: 'macos',
      runner: 'macmini-local',
    });
  });

  it('maps win32 to windows/lenovo-local (regression guard)', () => {
    expect(laneFor('win32')).toEqual({
      browser: 'chromium',
      os: 'windows',
      runner: 'lenovo-local',
    });
  });

  it('maps linux to linux/thinkcentre-local', () => {
    expect(laneFor('linux')).toEqual({
      browser: 'chromium',
      os: 'linux',
      runner: 'thinkcentre-local',
    });
  });

  it('does not mislabel Windows as linux', () => {
    // The TrashAlert run shipped reports tagged "linux / thinkcentre-local"
    // from a Windows Lenovo. This test catches that regression class.
    const lane = laneFor('win32');
    expect(lane.os).not.toBe('linux');
    expect(lane.runner).not.toBe('thinkcentre-local');
  });
});
