#!/usr/bin/env bash
# Install Playwright Chromium (plus its system packages on Linux) with a
# deadline per attempt and a few retries.
#
# `playwright install --with-deps` runs apt-get on Linux runners. When the
# mirror or the runner disk stalls, apt can sit on "Reading database ..."
# until the whole job hits its timeout and is cancelled with no test result.
# A bounded attempt that is retried turns that into a short delay instead.
#
# Env: PW_INSTALL_ATTEMPTS (default 3), PW_INSTALL_TIMEOUT_S (default 180).
set -uo pipefail

attempts="${PW_INSTALL_ATTEMPTS:-3}"
deadline="${PW_INSTALL_TIMEOUT_S:-180}"
case "$attempts" in ''|*[!0-9]*|0) attempts=3 ;; esac
case "$deadline" in ''|*[!0-9]*|0) deadline=180 ;; esac

run_install() {
  # GNU coreutils `timeout` is on every Linux runner; macOS runners lack it,
  # and there --with-deps installs nothing, so run unbounded.
  if command -v timeout >/dev/null 2>&1; then
    timeout --kill-after=15 "$deadline" npx --no-install playwright install --with-deps chromium
  else
    npx --no-install playwright install --with-deps chromium
  fi
}

for i in $(seq 1 "$attempts"); do
  if run_install; then
    exit 0
  fi
  echo "::warning::playwright install attempt $i/$attempts failed or exceeded ${deadline}s" >&2
  if [ "$i" -lt "$attempts" ]; then
    # A killed apt-get can leave dpkg half-configured; the next attempt
    # would refuse to start until it is repaired.
    if [ "$(uname -s)" = "Linux" ] && command -v sudo >/dev/null 2>&1; then
      sudo -n dpkg --configure -a >/dev/null 2>&1 || true
    fi
    sleep "${PW_INSTALL_RETRY_SLEEP_S:-$((i * 10))}"
  fi
done

echo "::error::playwright install failed after $attempts attempt(s)" >&2
exit 1
