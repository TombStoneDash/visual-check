import { describe, expect, it } from 'vitest';
import {
  DEMO_SNAPSHOTS,
  PRESENCE_STATES,
  miniMood,
  offlineSnapshot,
  renderDemoSite,
  renderPresencePanel,
  stateColor,
  type PresenceSnapshot,
} from '../src/presence-demo.js';

describe('presence demo snapshot', () => {
  it('covers every one of the seven states exactly once', () => {
    const states = DEMO_SNAPSHOTS.map((s) => s.state);
    expect(states.length).toBe(PRESENCE_STATES.length);
    expect(new Set(states)).toEqual(new Set(PRESENCE_STATES));
  });

  it('starts with the fail-closed OFFLINE snapshot and never invents fields for it', () => {
    const first = DEMO_SNAPSHOTS[0]!;
    expect(first.state).toBe('OFFLINE');
    expect(first.isStale).toBe(true);
    expect(first.isUnverified).toBe(true);
    expect(first.task).toBeNull();
    expect(first.worker).toBeNull();
    expect(first.model).toBeNull();
    expect(first.proofCitation).toBeNull();
    expect(first.freshnessReason).toMatch(/fail closed/);
  });

  it('marks every non-OFFLINE demo snapshot as synthetic and verified', () => {
    for (const s of DEMO_SNAPSHOTS.slice(1)) {
      expect(s.isUnverified).toBe(false);
      expect(s.isStale).toBe(false);
      expect(s.proofCitation).toMatch(/^demo:\/\//);
      expect(s.worker).toBe('daisy-demo-worker');
    }
  });

  it('only BLOCKED carries a blocker', () => {
    for (const s of DEMO_SNAPSHOTS) {
      if (s.state === 'BLOCKED') expect(s.blocker).toBeTruthy();
      else expect(s.blocker).toBeNull();
    }
  });
});

describe('miniMood', () => {
  it('reads offline for any unverified snapshot regardless of state', () => {
    const fake: PresenceSnapshot = { ...DEMO_SNAPSHOTS[3]!, isUnverified: true };
    expect(fake.state).toBe('BUILDING');
    expect(miniMood(fake)).toEqual({ glyph: '○', word: 'offline' });
  });

  it('matches the PulseSummary glyph table for verified states', () => {
    const byState = Object.fromEntries(DEMO_SNAPSHOTS.map((s) => [s.state, miniMood(s)]));
    expect(byState.BUILDING).toEqual({ glyph: '●', word: 'building' });
    expect(byState.THINKING).toEqual({ glyph: '◐', word: 'thinking' });
    expect(byState.BLOCKED).toEqual({ glyph: '■', word: 'blocked' });
    expect(byState.WAITING_FOR_HUDSON).toEqual({ glyph: '◔', word: 'waiting' });
    expect(byState.DONE).toEqual({ glyph: '✓', word: 'done' });
    expect(byState.IDLE).toEqual({ glyph: '○', word: 'idle' });
    expect(byState.OFFLINE).toEqual({ glyph: '○', word: 'offline' });
  });

  it('assigns a distinct colour to every state', () => {
    const colours = PRESENCE_STATES.map(stateColor);
    expect(new Set(colours).size).toBe(PRESENCE_STATES.length);
  });
});

describe('renderPresencePanel', () => {
  const html = renderPresencePanel();

  it('renders one popover per state, the first visible and the rest hidden', () => {
    const popovers = html.match(/<article class="popover"/g) ?? [];
    expect(popovers.length).toBe(PRESENCE_STATES.length);
    expect(html.match(/<article class="popover"[^>]*\shidden/g)?.length).toBe(PRESENCE_STATES.length - 1);
    for (const state of PRESENCE_STATES) expect(html).toContain(`data-state="${state}"`);
  });

  it('shows the honesty flag and reason on the OFFLINE card', () => {
    expect(html).toContain('Stale &amp; unverified');
    expect(html).toContain('fail closed');
  });

  it('escapes untrusted text', () => {
    const evil = offlineSnapshot('<script>alert(1)</script>');
    const out = renderPresencePanel([evil]);
    expect(out).not.toContain('<script>alert(1)</script>');
    expect(out).toContain('&lt;script&gt;');
  });
});

describe('renderDemoSite', () => {
  const html = renderDemoSite({
    presence: DEMO_SNAPSHOTS,
    compare: [
      {
        name: 'pass',
        verdict: 'pass',
        diffLabel: '0%',
        threshold: '5%',
        reportHref: 'reports/pass.html',
        screenshots: [{ label: 'desktop current', src: 'shots/pass-desktop-current.png' }],
      },
      {
        name: 'fail',
        verdict: 'fail',
        diffLabel: '30.5%',
        threshold: '5%',
        reportHref: 'reports/fail.html',
        screenshots: [],
      },
    ],
    dmgUrl: 'https://example.com/DaisyPresence.dmg',
    dmgSha256: 'abc123',
    presenceRepoUrl: 'https://github.com/TombStoneDash/daisy-personal-assistant',
    visualCheckRepoUrl: 'https://github.com/TombStoneDash/visual-check',
    daisyDeskSpecUrl: 'https://github.com/TombStoneDash/daisy-personal-assistant/blob/main/docs/DAISY_DESK.md',
    builtAt: '2026-09-18T00:00:00Z',
  });

  it('is a complete standalone document with no external assets', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).not.toMatch(/<link[^>]+href="https?:/);
  });

  it('links the DMG, both repos, the spec, and both reports', () => {
    expect(html).toContain('href="https://example.com/DaisyPresence.dmg"');
    expect(html).toContain('abc123');
    expect(html).toContain('href="reports/pass.html"');
    expect(html).toContain('href="reports/fail.html"');
    expect(html).toContain('DAISY_DESK.md');
  });

  it('renders the PASS and FAIL badges and the presence panel', () => {
    expect(html).toContain('>PASS<');
    expect(html).toContain('>FAIL<');
    expect(html).toContain('id="presence"');
  });

  it('keeps the honesty table', () => {
    expect(html).toContain('What is real, what is not');
    expect(html).toContain('Not connected to a live fleet');
  });
});
