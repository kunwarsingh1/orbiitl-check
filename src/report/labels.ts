import type { Finding, Stage } from "../types.js";

/** Short per-finding tag: which layer the problem lives in. */
export const LEVEL_TAG: Record<Stage, string> = {
  development: "code level",
  deployment: "deployment level",
  infrastructure: "infra level",
};

/** Summary-line label: the level plus what it covers. */
export const LEVEL_LABEL: Record<Stage, string> = {
  development: "code level (app source / build)",
  deployment: "deployment level (server config)",
  infrastructure: "infra level (DNS / CDN / network)",
};

/** All layers a finding can be fixed at, primary first, e.g. "code level + deployment level". */
export function levelTag(f: Pick<Finding, "stage" | "alsoFixableAt">): string {
  const levels = [f.stage, ...(f.alsoFixableAt ?? []).filter((s) => s !== f.stage)];
  return levels.map((s) => LEVEL_TAG[s]).join(" + ");
}
