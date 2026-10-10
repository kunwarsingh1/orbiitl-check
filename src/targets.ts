export interface TargetList {
  /** Normalized, de-duplicated targets in file order. */
  targets: string[];
  /** Lines that could not be turned into a scannable URL, with the reason. */
  rejected: Array<{ line: number; value: string; reason: string }>;
}

/**
 * Parses a targets file: one domain, subdomain or URL per line.
 * `#` starts a comment (whole line or trailing), blank lines are ignored,
 * bare hosts get `https://`, and duplicates are dropped.
 */
export function parseTargetList(text: string): TargetList {
  const targets: string[] = [];
  const rejected: TargetList["rejected"] = [];
  const seen = new Set<string>();

  text.split(/\r?\n/).forEach((raw, i) => {
    const value = raw.replace(/^﻿/, "").replace(/\s+#.*$/, "").replace(/^#.*$/, "").trim();
    if (!value) return;
    const line = i + 1;

    if (/\s/.test(value)) {
      rejected.push({ line, value, reason: "contains whitespace (one target per line)" });
      return;
    }
    if (value.includes("*")) {
      rejected.push({ line, value, reason: "wildcards can't be scanned; list concrete hostnames" });
      return;
    }

    const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    let url: URL;
    try {
      url = new URL(withScheme);
    } catch {
      rejected.push({ line, value, reason: "not a valid hostname or URL" });
      return;
    }
    if (!url.hostname || !url.hostname.includes(".") && url.hostname !== "localhost") {
      rejected.push({ line, value, reason: "not a valid hostname or URL" });
      return;
    }

    const normalized = url.toString();
    if (seen.has(normalized)) return;
    seen.add(normalized);
    targets.push(normalized);
  });

  return { targets, rejected };
}
