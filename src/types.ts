export type RedirectMode = "none" | "append" | "overwrite" | "both";

export interface CommandEntry {
  glob: string;
  description?: string;
  pipe: boolean;
  embedded: boolean;
  redirect: RedirectMode;
}

export interface TrustPolicyGroup {
  name: string;
  description: string;
  includes?: string[];
  commands: CommandEntry[];
}

export interface PolicyManifest {
  active: string[];
}

export interface ResolvedPolicy {
  commands: CommandEntry[];
  groups: Map<string, { description: string; commands: CommandEntry[] }>;
  warnings: string[];
}

export interface ValidationResult {
  allowed: boolean;
  matchedGroup?: string;
  matchedGlob?: string;
  reason?: string;
}

export interface CommandSegment {
  command: string;
  requiresPipe: boolean;
  requiresEmbedded: boolean;
  redirect: "none" | "append" | "overwrite";
}
