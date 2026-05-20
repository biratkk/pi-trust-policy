/**
 * Trust Policy Types
 */

export interface CommandEntry {
  glob: string;
  description?: string;
  pipe: boolean;
  embedded: boolean;
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
  /** All command entries flattened from active groups and their includes */
  commands: CommandEntry[];
  /** Map of group name to its resolved commands (for UI display) */
  groups: Map<string, GroupSummary>;
  /** Warnings encountered during loading */
  warnings: string[];
}

export interface GroupSummary {
  description: string;
  commands: CommandEntry[];
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
}
