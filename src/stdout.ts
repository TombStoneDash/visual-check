/**
 * Exit only after everything already written to stdout has reached the OS.
 *
 * When stdout is a pipe (`visual-check run --quiet | jq`), Node writes to it
 * asynchronously on macOS and Windows. A bare `process.exit()` right after a
 * large `process.stdout.write()` drops whatever the pipe has not accepted
 * yet — in practice everything past the first 64 KiB — so an agent reading
 * the JSON report gets a truncated, unparseable document. An empty write is
 * queued behind the pending data; its callback fires once that data is out.
 */
export function flushStdout(stream: NodeJS.WriteStream = process.stdout): Promise<void> {
  return new Promise((resolve) => {
    if (stream.destroyed || !stream.writable) {
      resolve();
      return;
    }
    // The callback also runs (with an error) on EPIPE, so a reader that
    // went away can never keep the process alive.
    stream.write('', () => resolve());
  });
}

export async function exitAfterStdout(code: number): Promise<never> {
  await flushStdout();
  process.exit(code);
}
