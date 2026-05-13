/**
 * yaml-loader.ts — discovers and parses YAML facility files.
 *
 * Returns raw parsed objects (not yet Zod-validated) along with the file path
 * so error messages can point to the source.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

export interface YamlFile {
  /** Absolute path to the YAML file */
  filePath: string;
  /** Relative path from project root (for readable error messages) */
  relativePath: string;
  /** Raw parsed YAML (type unknown — must be validated by Zod) */
  raw: unknown;
}

/**
 * Recursively walks `dir` and returns all `.yaml` / `.yml` files found.
 */
function collectYamlFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      results.push(...collectYamlFiles(fullPath));
    } else if (entry.endsWith('.yaml') || entry.endsWith('.yml')) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Loads all YAML facility files under `facilitiesDir`.
 *
 * @param facilitiesDir  Absolute path to data/facilities/
 * @param projectRoot    Used only to compute readable relative paths.
 */
export function loadYamlFiles(facilitiesDir: string, projectRoot: string): YamlFile[] {
  const paths = collectYamlFiles(facilitiesDir).sort(); // deterministic order
  return paths.map((filePath) => {
    const source = readFileSync(filePath, 'utf-8');
    let raw: unknown;
    try {
      raw = parseYaml(source);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`YAML parse error in ${filePath}: ${message}`);
    }
    const relativePath = filePath.startsWith(projectRoot)
      ? filePath.slice(projectRoot.length + 1)
      : filePath;
    return { filePath, relativePath, raw };
  });
}
