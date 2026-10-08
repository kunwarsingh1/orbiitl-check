import { createHash } from "node:crypto";

/** Cheap, dependency-free content hash used to compare response bodies (e.g. real site vs. candidate origin IP, or probe hit vs. baseline 404). */
export function simpleHash(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}

export function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return match ? match[1].trim() : "";
}
