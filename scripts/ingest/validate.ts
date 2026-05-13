/**
 * validate.ts — applies the Zod facility schema to raw YAML data.
 *
 * Collects all validation errors with file + field context so a single run
 * reports every broken file rather than stopping at the first failure.
 */

import { FacilityYamlSchema, type FacilityYaml } from '@/lib/zod-facility-schema.js';
import type { YamlFile } from './yaml-loader.js';

export interface ValidFacility {
  filePath: string;
  relativePath: string;
  data: FacilityYaml;
}

export interface ValidationFailure {
  filePath: string;
  relativePath: string;
  errors: Array<{ field: string; message: string }>;
}

export interface ValidationResult {
  valid: ValidFacility[];
  failures: ValidationFailure[];
}

/**
 * Validates each YamlFile against FacilityYamlSchema.
 * Continues past failures so all errors are surfaced in one pass.
 */
export function validateFacilities(files: YamlFile[]): ValidationResult {
  const valid: ValidFacility[] = [];
  const failures: ValidationFailure[] = [];

  for (const file of files) {
    const result = FacilityYamlSchema.safeParse(file.raw);
    if (result.success) {
      valid.push({ filePath: file.filePath, relativePath: file.relativePath, data: result.data });
    } else {
      // Zod v4 uses .issues (not .errors)
      const issues = result.error.issues ?? [];
      failures.push({
        filePath: file.filePath,
        relativePath: file.relativePath,
        errors: issues.map((issue) => ({
          field: issue.path.length > 0 ? issue.path.join('.') : '(root)',
          message: issue.message,
        })),
      });
    }
  }

  return { valid, failures };
}

/**
 * Prints validation failures to stderr in a human-readable format.
 * Returns the number of files that failed.
 */
export function reportFailures(failures: ValidationFailure[]): number {
  if (failures.length === 0) return 0;

  console.error(`\n${failures.length} YAML file(s) failed validation:\n`);
  for (const f of failures) {
    console.error(`  ${f.relativePath}`);
    for (const e of f.errors) {
      console.error(`    field: ${e.field}`);
      console.error(`    error: ${e.message}`);
    }
    console.error('');
  }
  return failures.length;
}
