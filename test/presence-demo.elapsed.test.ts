import { describe, expect, it } from 'vitest';
import {
  elapsedLabel,
  offlineSnapshot,
  renderPresencePanel,
  type PresenceSnapshot,
} from '../src/presence-demo.js';

function snapshot(referenceEventAt: string | null): PresenceSnapshot {
  return {
    state: 'IDLE',
    task: 'DEMO-TASK-0001',
    project: 'DEMO',
    worker: 'daisy-demo-worker',
    model: 'demo-model',
    machine: 'demo-machine.local',
    lastHeartbeat: referenceEventAt,
    referenceEventAt,
    latestAction: 'daisy-demo-worker reported IDLE',
    blocker: null,
    nextAction: 'Assign or start a task',
    proofCitation: 'demo://receipts/idle',
    isStale: false,
    isUnverified: false,
    freshnessReason: null,
  };
}

function elapsedValues(html: string): string[] {
  return [...html.matchAll(/Elapsed<\/span><span class="v">([^<]*)<\/span>/g)].map((m) => m[1]!);
}

describe('elapsedLabel (own-list reference clock)', () => {
  it('measures a two-snapshot list 90 seconds apart against the latest snapshot in that list', () => {
    const older = snapshot('2026-09-22T00:00:00.000Z');
    const newer = snapshot('2026-09-22T00:01:30.000Z');
    const html = renderPresencePanel([older, newer]);
    const values = elapsedValues(html);
    expect(values).toEqual(['1m 30s', '0s']);
  });

  it('no longer produces the six-figure minute count from the unrelated demo clock', () => {
    const older = snapshot('2026-09-22T00:00:00.000Z');
    const newer = snapshot('2026-09-22T00:01:30.000Z');
    const html = renderPresencePanel([older, newer]);
    for (const value of elapsedValues(html)) {
      expect(value).not.toMatch(/\d{4,}m/);
    }
  });

  it('renders the em-dash placeholder, not 0s, for a snapshot with no referenceEventAt', () => {
    const offline = offlineSnapshot('demo: no Hermes state files on this machine — fail closed');
    const html = renderPresencePanel([offline]);
    const values = elapsedValues(html);
    expect(values).toEqual(['—']);
  });

  it('leaves the default panel unchanged: 5m 0s for IDLE, 0s for DONE', () => {
    const html = renderPresencePanel();
    const values = elapsedValues(html);
    expect(values[1]).toBe('5m 0s');
    expect(values[values.length - 1]).toBe('0s');
  });

  it('the exported helper returns 0s when the reference is the snapshot itself, and null with no referenceEventAt', () => {
    const s = snapshot('2026-09-22T00:00:00.000Z');
    expect(elapsedLabel(s, null)).toBe('0s');
    const offline = offlineSnapshot('demo: no Hermes state files on this machine — fail closed');
    expect(elapsedLabel(offline, null)).toBeNull();
  });
});
