import { describe, expect, it } from 'vitest';
import vm from 'node:vm';
import {
  DEMO_SNAPSHOTS,
  elapsedLabel,
  renderDemoSite,
  renderPresencePanel,
  type PresenceSnapshot,
} from '../src/presence-demo.js';

function snapshot(referenceEventAt: string | null): PresenceSnapshot {
  return { ...DEMO_SNAPSHOTS[1]!, lastHeartbeat: referenceEventAt, referenceEventAt };
}

describe('elapsedLabel with an unparseable referenceEventAt', () => {
  it('returns null instead of "NaNs", with or without a reference clock', () => {
    const bad = snapshot('not-a-timestamp');
    expect(elapsedLabel(bad, null)).toBeNull();
    expect(elapsedLabel(bad, '2026-09-22T00:01:30.000Z')).toBeNull();
  });

  it('renders the em dash in the panel and never "NaN"', () => {
    const html = renderPresencePanel([snapshot('not-a-timestamp'), snapshot('2026-09-22T00:01:30.000Z')]);
    expect(html).not.toContain('NaN');
    const values = [...html.matchAll(/Elapsed<\/span><span class="v">([^<]*)<\/span>/g)].map((m) => m[1]);
    expect(values).toEqual(['—', '0s']);
  });
});

// Runs the page's inline <script> against a tiny DOM stub so the keyboard
// handler can be exercised without a browser.
function loadDemoScript() {
  const html = renderDemoSite({
    presence: DEMO_SNAPSHOTS,
    compare: [],
    dmgUrl: '#',
    dmgSha256: null,
    presenceRepoUrl: '#',
    visualCheckRepoUrl: '#',
    daisyDeskSpecUrl: '#',
    builtAt: '2026-09-18T00:00:00Z',
  });
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)![1]!;
  const pops = DEMO_SNAPSHOTS.map((_, i) => ({ hidden: i !== 0 }));
  const btns = DEMO_SNAPSHOTS.map((_, i) => ({
    dataset: { index: String(i) },
    setAttribute() {},
    addEventListener() {},
  }));
  const glyph = { textContent: '', style: { color: '' } };
  let onKeydown: ((e: unknown) => void) | undefined;
  const document = {
    querySelectorAll: (sel: string) => (sel === '.popover' ? pops : btns),
    getElementById: (id: string) =>
      id === 'menubar-word' ? { textContent: '' } : { querySelector: () => glyph },
    addEventListener: (type: string, fn: (e: unknown) => void) => {
      if (type === 'keydown') onKeydown = fn;
    },
  };
  vm.runInNewContext(script, { document });
  const press = (init: { key: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean }) => {
    let prevented = false;
    onKeydown!({ target: { tagName: 'BODY' }, preventDefault: () => (prevented = true), ...init });
    return prevented;
  };
  const visibleIndex = () => pops.findIndex((p) => !p.hidden);
  return { press, visibleIndex };
}

describe('demo site keyboard stepping', () => {
  it('a plain digit still steps to that state', () => {
    const { press, visibleIndex } = loadDemoScript();
    expect(press({ key: '3' })).toBe(true);
    expect(visibleIndex()).toBe(2);
  });

  it('Cmd/Ctrl+digit and Alt+ArrowLeft are left to the browser', () => {
    const { press, visibleIndex } = loadDemoScript();
    expect(press({ key: '3', metaKey: true })).toBe(false);
    expect(press({ key: '4', ctrlKey: true })).toBe(false);
    expect(press({ key: 'ArrowLeft', altKey: true })).toBe(false);
    expect(visibleIndex()).toBe(0);
  });
});
