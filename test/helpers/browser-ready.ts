import { chromium } from 'playwright';

export const browserReady: boolean = await (async () => {
  try {
    const b = await chromium.launch();
    await b.close();
    return true;
  } catch {
    return false;
  }
})();

export const mustRunBrowserTests = Boolean(process.env.CI);
