import type { Finding, ScanContext } from "../types.js";

/**
 * Secret-shaped strings worth flagging if they show up in console output or
 * dumped framework state. Deliberately high-signal/low-noise: generic
 * "secret"/"password" substring matching produces far too many false
 * positives on normal app chatter, so this only matches known key formats.
 */
const SECRET_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: "AWS Access Key ID", pattern: /AKIA[0-9A-Z]{16}/ },
  { name: "Google API Key", pattern: /AIza[0-9A-Za-z\-_]{35}/ },
  { name: "Stripe Secret Key", pattern: /sk_live_[0-9a-zA-Z]{20,}/ },
  { name: "Generic Bearer token", pattern: /Bearer\s+[A-Za-z0-9\-_.]{30,}/ },
  { name: "Slack token", pattern: /xox[baprs]-[0-9A-Za-z-]{10,}/ },
];

/** Global variables frameworks commonly dump full server-side state into - readable by any script on the page even though it's invisible in raw HTML before hydration. */
const FRAMEWORK_STATE_GLOBALS = [
  "__NEXT_DATA__",
  "__NUXT__",
  "__INITIAL_STATE__",
  "__APOLLO_STATE__",
  "__PRELOADED_STATE__",
  "__REDUX_STATE__",
];

export async function checkBrowser(ctx: ScanContext, baseUrl: string): Promise<Finding[]> {
  const findings: Finding[] = [];

  let playwright: typeof import("playwright");
  try {
    playwright = await import("playwright");
  } catch {
    ctx.log(
      "  --deep requires the optional 'playwright' dependency. Install it with: npm install playwright && npx playwright install chromium"
    );
    return findings;
  }

  ctx.log("Launching headless Chromium for deep inspection (console leaks, framework state dumps)...");
  let browser: import("playwright").Browser;
  try {
    browser = await playwright.chromium.launch({ headless: true });
  } catch (err) {
    ctx.log(
      `  could not launch Chromium (${(err as Error).message.split("\n")[0]}). Run: npx playwright install chromium`
    );
    return findings;
  }

  try {
    const page = await browser.newPage();
    const consoleLeaks: Array<{ secretType: string; text: string }> = [];

    page.on("console", (msg) => {
      const text = msg.text();
      for (const { name, pattern } of SECRET_PATTERNS) {
        if (pattern.test(text)) {
          consoleLeaks.push({ secretType: name, text: redact(text, pattern) });
        }
      }
    });

    try {
      await page.goto(baseUrl, { waitUntil: "networkidle", timeout: ctx.options.timeout });
    } catch (err) {
      ctx.log(`  page load failed or timed out: ${(err as Error).message}`);
    }

    for (const leak of consoleLeaks) {
      findings.push({
        id: `browser.console-secret.${leak.secretType}`,
        category: "browser",
        severity: "high",
        stage: "development",
        fixOwner: "code",
        confidence: "confirmed",
        title: `${leak.secretType} leaked via console logging`,
        description: `A browser console message on ${baseUrl} matched the shape of a ${leak.secretType}. This means debug logging in the client-side bundle is printing a credential - anyone opening devtools sees it.`,
        evidence: leak.text,
        remediation: "Remove the console.log/debug statement that prints this value, and rotate the credential since it has been exposed client-side.",
      });
    }

    // Framework state dumps: not a leak by itself, but worth flagging as an
    // info-level note since these objects often carry more server data than
    // the component actually renders (unused props, internal IDs, etc.).
    for (const globalName of FRAMEWORK_STATE_GLOBALS) {
      let present = false;
      try {
        present = await page.evaluate((name) => Boolean((globalThis as unknown as Record<string, unknown>)[name]), globalName);
      } catch {
        continue;
      }
      if (present) {
        findings.push({
          id: `browser.framework-state.${globalName}`,
          category: "browser",
          severity: "info",
          stage: "development",
          fixOwner: "code",
          confidence: "confirmed",
          title: `Framework state dump present: window.${globalName}`,
          description: `window.${globalName} is present on the page and readable by any script. Framework state dumps like this often carry more server-rendered data than the page actually uses - worth checking it doesn't include fields the client shouldn't see (internal IDs, unpublished content, other users' data).`,
          reproCommand: `(open devtools console on ${baseUrl} and run) JSON.stringify(window.${globalName})`,
        });
      }
    }

    // React/Vue devtools hooks left wired up in a production build is a
    // minor but real signal that this isn't a hardened production bundle.
    let devtoolsHookPresent = false;
    try {
      devtoolsHookPresent = await page.evaluate(
        () => Boolean((globalThis as unknown as Record<string, unknown>).__REACT_DEVTOOLS_GLOBAL_HOOK__)
      );
    } catch {
      // ignore
    }
    if (devtoolsHookPresent) {
      findings.push({
        id: "browser.react-devtools-hook",
        category: "browser",
        severity: "info",
        stage: "development",
        fixOwner: "code",
        confidence: "confirmed",
        title: "React DevTools hook present in production build",
        description: "window.__REACT_DEVTOOLS_GLOBAL_HOOK__ is present, meaning the component tree is inspectable via React DevTools. Not a vulnerability by itself, but a sign this build wasn't fully production-optimized.",
      });
    }

    if (ctx.options.screenshot) {
      try {
        await page.screenshot({ path: ctx.options.screenshot, fullPage: true });
        ctx.log(`  screenshot saved to ${ctx.options.screenshot}`);
      } catch (err) {
        ctx.log(`  screenshot failed: ${(err as Error).message}`);
      }
    }
  } finally {
    await browser.close();
  }

  return findings;
}

/** Keep only enough of a matched secret to prove the finding, without putting the full live credential in a report that might get shared/committed. */
function redact(text: string, pattern: RegExp): string {
  const match = text.match(pattern);
  if (!match) return "(match no longer available)";
  const secret = match[0];
  if (secret.length <= 8) return secret;
  return `${secret.slice(0, 6)}...${secret.slice(-4)} (redacted, ${secret.length} chars)`;
}
