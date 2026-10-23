import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { Capturer } from '../src/capture.js';

/** A localhost port with nothing listening, so navigation fails fast. */
async function closedPort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as net.AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

describe('Capturer.capture with a reused output path', () => {
  let capturer: Capturer;
  let dir: string;

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vc-stale-shot-'));
    capturer = new Capturer({ headless: true, navigationTimeoutMs: 10_000 });
    await capturer.start();
  }, 60_000);

  afterAll(async () => {
    await capturer?.stop();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('does not leave the previous run\'s screenshot behind when the page fails to load', async () => {
    const out = path.join(dir, 'example-mobile.png');
    await fs.writeFile(out, 'previous run screenshot');

    const port = await closedPort();
    const artifact = await capturer.capture(
      `http://127.0.0.1:${port}/`,
      { name: 'mobile', width: 390, height: 844 },
      out,
    );

    expect(artifact.error).toBeTruthy();
    await expect(fs.access(out)).rejects.toThrow();
  }, 30_000);
});
