export type Severity = "info" | "low" | "medium" | "high";

export interface Finding {
  id: string;
  title: string;
  severity: Severity;
  category: "origin-ip" | "exposed-artifacts" | "headers";
  description: string;
  evidence?: string;
  remediation?: string;
  url?: string;
}

export interface ScanOptions {
  app: string;
  json: boolean;
  output?: string;
  concurrency: number;
  delay: number;
  timeout: number;
  maxRequests: number;
  skipOriginIp: boolean;
  skipArtifacts: boolean;
  skipHeaders: boolean;
  color: boolean;
  verbose: boolean;
}

export interface ScanResult {
  target: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  findings: Finding[];
  requestsMade: number;
}

export interface ScanContext {
  options: ScanOptions;
  log: (msg: string) => void;
  requestCounter: { count: number };
}
