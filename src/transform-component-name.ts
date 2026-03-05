import type { Plugin, TransformResult } from 'vite';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const pkg: { version?: string } = require('../package.json');

// ─── Virtual module ───────────────────────────────────────────────────────────

/**
 * The module identifier users pass to `build.lib.entry` to get the
 * auto-generated component entry that imports every file discovered in
 * {@link PluginOptions.componentsDir}.
 *
 * @example
 * // vite.config.ts
 * import { VIRTUAL_COMPONENTS_ID } from 'vite-plugin-icl';
 *
 * export default defineConfig({
 *   build: { lib: { entry: VIRTUAL_COMPONENTS_ID } }
 * });
 */
export const VIRTUAL_COMPONENTS_ID = 'virtual:icl-components';
const RESOLVED_VIRTUAL_ID = '\0virtual:icl-components';

// ─── Reserved custom element names (HTML spec) ───────────────────────────────

const RESERVED_CUSTOM_ELEMENT_NAMES = new Set([
  'annotation-xml',
  'color-profile',
  'font-face',
  'font-face-src',
  'font-face-uri',
  'font-face-format',
  'font-face-name',
  'missing-glyph',
]);

// ─── Pure utility functions ───────────────────────────────────────────────────

/**
 * Converts a UUID to a shorter Base36 string using only lowercase alphanumeric characters.
 * @param uuid The input UUID string.
 * @returns The resulting Base36 string.
 */
export function convertUUIDToBase36(uuid: string): string {
  const hex = uuid.replace(/-/g, '');
  const bigIntValue = BigInt('0x' + hex);
  return bigIntValue.toString(36);
}

/**
 * Returns true when {@link name} is a valid custom element name per the HTML spec:
 * - Starts with a lowercase ASCII letter
 * - Contains at least one hyphen
 * - Contains only lowercase letters, digits, hyphens, periods, or underscores
 * - Is not one of the reserved names defined by the spec
 */
export function isValidCustomElementName(name: string): boolean {
  if (!/^[a-z]/.test(name)) return false;
  if (!name.includes('-')) return false;
  if (!/^[a-z0-9\-._]+$/.test(name)) return false;
  if (RESERVED_CUSTOM_ELEMENT_NAMES.has(name)) return false;
  return true;
}

/**
 * Returns true when {@link name} is a valid component file name for use with
 * this plugin. The rules are looser than {@link isValidCustomElementName}
 * because the filename is only used as a key to derive the unique name — the
 * unique name (which always contains hyphens) is what the browser sees.
 *
 * Rules:
 * - Starts with a lowercase ASCII letter
 * - Contains only lowercase letters, digits, hyphens, periods, or underscores
 * - Is not one of the reserved HTML custom element names
 *
 * Note: a hyphen is NOT required — single-word filenames like `summary.ts` or
 * `details.ts` are valid because their unique name is either pre-assigned via
 * `config/config.json` or generated with a `px-int-...-name-vX-Y-Z` pattern
 * that always includes hyphens.
 */
export function isValidComponentFileName(name: string): boolean {
  if (!/^[a-z]/.test(name)) return false;
  if (!/^[a-z0-9\-._]+$/.test(name)) return false;
  if (RESERVED_CUSTOM_ELEMENT_NAMES.has(name)) return false;
  return true;
}

/**
 * Derives a custom element tag name from a file path relative to the
 * web-components base directory.
 *
 * Rules:
 * - The `.ts` extension is stripped.
 * - Path separators (`/` or `\`) are replaced with `--` (double-hyphen) to
 *   distinguish directory boundaries from hyphens in the filename itself.
 *   e.g. `modals/save-modal.ts` → `modals--save-modal`
 * - The result is lowercased.
 *
 * @param relativePath Path relative to the base directory, e.g. `key-value.ts`
 *   or `modals/save-modal.ts`.
 * @returns The derived tag name, e.g. `key-value` or `modals--save-modal`.
 */
export function filePathToComponentName(relativePath: string): string {
  const normalised = relativePath.replace(/\\/g, '/');
  const withoutExt = normalised.replace(/\.ts$/, '');
  return withoutExt.replace(/\//g, '--').toLowerCase();
}

/**
 * Converts a kebab-case custom element name to the expected PascalCase class
 * name with a `Component` suffix.
 *
 * Both single hyphens (filename separators) and double hyphens (directory
 * separators) are treated as word boundaries.
 *
 * @example
 * componentNameToClassName('key-value')         // → 'KeyValueComponent'
 * componentNameToClassName('modals--save-modal') // → 'ModalsSaveModalComponent'
 */
export function componentNameToClassName(componentName: string): string {
  return (
    componentName
      .split(/--|-/)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join('') + 'Component'
  );
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

interface IntegrationConfig {
  acronym?: string;
  webComponents?: {
    components?: Array<{ type?: unknown; element?: unknown }>;
  };
}

/**
 * Reads and parses `config/config.json` from the project root (process.cwd()).
 * Returns an empty object if the file does not exist or cannot be parsed.
 */
function readProjectConfig(): IntegrationConfig {
  const configPath = path.resolve(process.cwd(), 'config', 'config.json');
  if (!existsSync(configPath)) return {};
  try {
    return JSON.parse(readFileSync(configPath, 'utf-8')) as IntegrationConfig;
  } catch {
    return {};
  }
}

/**
 * Resolves the acronym from the project config.
 * Falls back to 'icl' if absent or empty.
 */
function resolveAcronym(config: IntegrationConfig): string {
  const acronym = config.acronym;
  if (typeof acronym === 'string' && acronym.trim().length > 0) {
    return acronym.trim().toLowerCase();
  }
  return 'icl';
}

/**
 * Reads the `webComponents.components` array from the project config and
 * returns a map of component type → pre-assigned unique element name.
 *
 * Only entries where both `type` and `element` are non-empty strings are
 * included. These components have externally assigned unique names (supplied
 * by the Polarity framework) and bypass the plugin's hash generation, but
 * still go through class export verification and `customElements.define`
 * injection exactly like auto-discovered components.
 */
function resolvePredefinedComponents(config: IntegrationConfig): Map<string, string> {
  const map = new Map<string, string>();
  const components = config.webComponents?.components;
  if (!Array.isArray(components)) return map;
  for (const entry of components) {
    if (
      typeof entry.type === 'string' && entry.type.trim().length > 0 &&
      typeof entry.element === 'string' && entry.element.trim().length > 0
    ) {
      map.set(entry.type.trim(), entry.element.trim());
    }
  }
  return map;
}

/**
 * Walk up from {@link startDir} looking for
 * `node_modules/integration-component-library/package.json`.
 * Returns the resolved path, or throws if not found.
 */
function resolveLibraryPackageJson(startDir: string): string {
  let dir = path.resolve(startDir);
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  while (true) {
    const candidate = path.join(dir, 'node_modules', 'integration-component-library', 'package.json');
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error('integration-component-library is not installed');
    }
    dir = parent;
  }
}

/**
 * Recursively collects all `.ts` files under {@link dir}, returning their
 * absolute paths.
 */
function collectTsFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...collectTsFiles(full));
    } else if (entry.endsWith('.ts')) {
      results.push(full);
    }
  }
  return results;
}

// ─── Plugin options ───────────────────────────────────────────────────────────

export interface PluginOptions {
  /**
   * The absolute path to the directory containing your web component source
   * files. The plugin uses this path for two purposes:
   *
   * 1. **Filesystem scanning** — at build start, every `.ts` file found
   *    recursively under this directory is registered as a component. The tag
   *    name is derived from the file path relative to this base:
   *    - The `.ts` extension is stripped.
   *    - Path separators are replaced with `--` (double-hyphen) to distinguish
   *      directory nesting from hyphens in the filename itself.
   *    - The result is lowercased.
   *
   *    Examples (base = `/src/web-components`):
   *    - `key-value.ts`         → tag `key-value`
   *    - `modals/save-modal.ts` → tag `modals--save-modal`
   *
   * 2. **Transform filter** — only `.ts` files whose absolute path contains
   *    this directory path will be processed by the plugin.
   *
   * Each discovered file must export a class named in PascalCase with a
   * `Component` suffix (e.g. `key-value.ts` → `KeyValueComponent`). The build
   * will fail with a clear error if the export is missing or the derived name
   * is invalid.
   *
   * @example resolve(__dirname, 'src/web-components')
   */
  componentsDir: string;

  /**
   * When `true` (the default), the plugin makes the {@link VIRTUAL_COMPONENTS_ID}
   * virtual module available as a Vite build entry point. That module generates
   * a side-effect import for every component file discovered in
   * {@link componentsDir}, pulling them all into the bundle automatically
   * without a hand-written `index.ts`.
   *
   * Set to `false` to opt out of the virtual module. In this mode the plugin
   * still discovers components, rewrites tag names, and injects
   * `customElements.define(...)` registration calls — but you are responsible
   * for ensuring each component file is reachable from your own entry point
   * (e.g. via explicit imports in `index.ts`).
   *
   * @default true
   */
  autoImport?: boolean;

  /**
   * The absolute path to a hand-written entry file (e.g. `index.ts`) that
   * exports anything beyond the auto-discovered components — utilities, types,
   * constants, etc.
   *
   * When provided alongside `autoImport: true`, pass both this file and
   * {@link VIRTUAL_COMPONENTS_ID} to `build.lib.entry` as an array so Vite
   * produces two separate output chunks. The build will fail immediately if
   * this file does not exist.
   *
   * @example
   * // vite.config.ts
   * import { VIRTUAL_COMPONENTS_ID } from 'vite-plugin-icl';
   * import { resolve } from 'node:path';
   *
   * export default defineConfig({
   *   plugins: [
   *     transformComponentNames({
   *       componentsDir: resolve(__dirname, 'src/web-components'),
   *       additionalEntry: resolve(__dirname, 'src/index.ts'),
   *     }),
   *   ],
   *   build: {
   *     lib: {
   *       entry: [VIRTUAL_COMPONENTS_ID, resolve(__dirname, 'src/index.ts')],
   *     },
   *   },
   * });
   */
  additionalEntry?: string;

  /**
   * When `true` (the default), the plugin rewrites tags from
   * `integration-component-library` (e.g. `<object-to-table>`) into their
   * resolved versioned names at build time, and injects the corresponding
   * `import` and `customElements.define(...)` calls automatically.
   *
   * Set to `false` if you prefer to handle library components yourself — for
   * example by using `staticHtml` / `unsafeStatic` with the exported name
   * variable, or by referencing the long-form tag name directly.
   *
   * @default true
   */
  rewriteLibraryComponents?: boolean;
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

/**
 * Vite plugin that:
 * 1. Scans {@link PluginOptions.componentsDir} to auto-discover web component
 *    files, validate their names, verify their class exports, and inject
 *    self-contained `customElements.define(...)` registration calls.
 * 2. Transforms component tag names and string literals into globally unique,
 *    versioned names at build time.
 * 3. Optionally serves a virtual entry module ({@link VIRTUAL_COMPONENTS_ID})
 *    that pulls all discovered components into the bundle automatically.
 */
export function transformComponentNames(options: PluginOptions): Plugin {
  const {
    componentsDir,
    autoImport = true,
    additionalEntry,
    rewriteLibraryComponents = true,
  } = options;

  // ── File-matching setup ──────────────────────────────────────────────────
  // Normalise the components directory to forward slashes for cross-platform
  // substring matching against Vite's normalised file ids.
  const normalisedComponentsDir = componentsDir.replace(/\\/g, '/');

  const isMatch = (normalisedId: string): boolean =>
    normalisedId.includes(normalisedComponentsDir);

  // ── Build-time state (populated in buildStart) ───────────────────────────
  const hash = convertUUIDToBase36(randomUUID());
  const version: string = pkg.version ?? '1.0.0';
  const versionSlug = `v${version.replace(/\./g, '-')}`;

  // componentMap: derived name → unique tag name
  let componentMap: Record<string, string> = {};

  // fileComponentMap: absolute file path → { componentName, uniqueName, className }
  const fileComponentMap = new Map<
    string,
    { componentName: string; uniqueName: string; className: string }
  >();

  // Library component definitions: short name → class export from integration-component-library
  const libraryComponentDefs: Record<string, { className: string }> = {
    'object-to-table': { className: 'ObjectToTable' },
  };

  // Resolved at build time: short name → { resolvedTagName, className }
  const resolvedLibraryMap = new Map<
    string,
    { resolvedTagName: string; className: string }
  >();

  return {
    name: 'transform-component-names',
    enforce: 'pre',
    apply: 'build',

    // ── buildStart: scan filesystem, validate, build maps ──────────────────
    buildStart() {
      const projectConfig = readProjectConfig();
      const basePrefix = `px-int-${hash}-${resolveAcronym(projectConfig)}`;
      const predefined = resolvePredefinedComponents(projectConfig);

      if (additionalEntry && !existsSync(additionalEntry)) {
        throw new Error(
          `[vite-plugin-icl] additionalEntry file not found.\n` +
          `  Path: ${additionalEntry}\n` +
          `  Ensure the path is absolute and the file exists.`,
        );
      }

      const base = path.resolve(componentsDir);
      const tsFiles = collectTsFiles(base);

      for (const absPath of tsFiles) {
        const relativePath = path.relative(base, absPath).replace(/\\/g, '/');
        const componentName = filePathToComponentName(relativePath);

        if (!isValidComponentFileName(componentName)) {
          throw new Error(
            `[vite-plugin-icl] Invalid component file name derived from file.\n` +
            `  File:      ${absPath}\n` +
            `  Derived:   "${componentName}"\n` +
            `  Component file names must start with a lowercase letter and consist ` +
            `only of lowercase letters, digits, hyphens, periods, or underscores. ` +
            `They must not be one of the reserved HTML names (annotation-xml, ` +
            `color-profile, etc.).\n` +
            `  Rename the file so its derived name meets these requirements.`,
          );
        }

        const uniqueName = predefined.get(componentName) ?? `${basePrefix}-${componentName}-${versionSlug}`;
        const className = componentNameToClassName(componentName);

        componentMap[componentName] = uniqueName;
        fileComponentMap.set(path.normalize(absPath), { componentName, uniqueName, className });
      }

      // Resolve library component names at build time.
      // Read the library's package.json version and compute tag names using the
      // same deterministic formula the library uses, avoiding executing the
      // library code (which may reference browser APIs unavailable in Node).
      if (rewriteLibraryComponents) {
        try {
          // Walk up from the project root to find the library's package.json
          // in node_modules. We cannot use require.resolve because the library's
          // "exports" field may not expose package.json or may be ESM-only.
          const libPkgPath = resolveLibraryPackageJson(process.cwd());
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          const libPkg: { version?: string } = JSON.parse(readFileSync(libPkgPath, 'utf-8'));
          const libVersion = libPkg.version ?? '0.0.0';
          const normalizedVersion = libVersion.replace(/\./g, '-');
          for (const [shortName, { className }] of Object.entries(libraryComponentDefs)) {
            const resolvedTagName = `px-lib-${shortName.toLowerCase()}-v${normalizedVersion}`;
            componentMap[shortName] = resolvedTagName;
            resolvedLibraryMap.set(shortName, { resolvedTagName, className });
          }
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          console.warn(
            `[vite-plugin-icl] integration-component-library not found; ` +
            `library component rewrites (e.g. object-to-table) will be skipped.\n` +
            `  Reason: ${msg}`,
          );
        }
      }
    },

    // ── transform: rewrite tags, verify exports, inject registration ───────
    transform(code: string, id: string): TransformResult | null {
      if (!id.endsWith('.ts') || !isMatch(id.replace(/\\/g, '/'))) {
        return null;
      }

      let transformedCode = code;
      let hasChanges = false;

      // ── 1. Registration injection for file-discovered components ──────────
      const fileEntry = fileComponentMap.get(path.normalize(id));
      if (fileEntry) {
        const { uniqueName, className } = fileEntry;

        const classExportPattern = new RegExp(
          `\\bclass\\s+${className}\\b|\\bexport\\s*\\{[^}]*\\b${className}\\b|\\b${className}\\s*=`,
        );
        if (!classExportPattern.test(code)) {
          throw new Error(
            `[vite-plugin-icl] Missing expected class export in component file.\n` +
            `  File:     ${id}\n` +
            `  Expected: a class or export named "${className}"\n` +
            `  The component name "${fileEntry.componentName}" was derived from the ` +
            `file path. The plugin expects the file to export a class named ` +
            `"${className}" (PascalCase of the component name + "Component" suffix).\n` +
            `  Either rename the class to "${className}" or rename the file to match ` +
            `the existing class name.`,
          );
        }

        const registrationBlock = `if (customElements.get('${uniqueName}') === undefined) {\n  customElements.define('${uniqueName}', ${className} as unknown as CustomElementConstructor);\n}`;
        if (!transformedCode.includes(`customElements.get('${uniqueName}')`)) {
          transformedCode = `${transformedCode}\n${registrationBlock}\n`;
          hasChanges = true;
        }
      }

      // ── 2. Tag + string literal rewrites for all known components ─────────
      for (const [simple, unique] of Object.entries(componentMap)) {
        const openTagRegex = new RegExp(`<${simple}(\\s|>)`, 'g');
        const newOpen = transformedCode.replace(openTagRegex, `<${unique}$1`);
        if (newOpen !== transformedCode) {
          transformedCode = newOpen;
          hasChanges = true;
        }

        const closeTagRegex = new RegExp(`</${simple}>`, 'g');
        const newClose = transformedCode.replace(closeTagRegex, `</${unique}>`);
        if (newClose !== transformedCode) {
          transformedCode = newClose;
          hasChanges = true;
        }

        const constRegex = new RegExp(`(['"\`])${simple}\\1`, 'g');
        const newConst = transformedCode.replace(constRegex, `$1${unique}$1`);
        if (newConst !== transformedCode) {
          transformedCode = newConst;
          hasChanges = true;
        }
      }

      // ── 3. Library component import + registration injection ──────────────
      for (const [, { resolvedTagName, className }] of resolvedLibraryMap) {
        if (transformedCode.includes(resolvedTagName)) {
          const importStatement = `import { ${className} } from 'integration-component-library';`;
          if (!transformedCode.includes(importStatement)) {
            transformedCode = `${importStatement}\n${transformedCode}`;
            hasChanges = true;
          }

          const registrationBlock = `if (customElements.get('${resolvedTagName}') === undefined) {\n  customElements.define('${resolvedTagName}', ${className} as unknown as CustomElementConstructor);\n}`;
          if (!transformedCode.includes(`customElements.get('${resolvedTagName}')`)) {
            transformedCode = `${transformedCode}\n${registrationBlock}\n`;
            hasChanges = true;
          }
        }
      }

      if (hasChanges) {
        return { code: transformedCode, map: null };
      }

      return null;
    },

    // ── resolveId: virtual module resolution ────────────────────────────────
    resolveId(id: string) {
      if (
        autoImport &&
        (id === VIRTUAL_COMPONENTS_ID || id.endsWith('/' + VIRTUAL_COMPONENTS_ID))
      ) {
        return RESOLVED_VIRTUAL_ID;
      }
      return null;
    },

    // ── load: virtual module implementation ─────────────────────────────────
    load(id: string) {
      if (id === RESOLVED_VIRTUAL_ID) {
        if (!autoImport) {
          return null;
        }
        const lines = Array.from(fileComponentMap.keys()).map(
          (absPath) => `import '${absPath.replace(/\\/g, '/')}';`,
        );
        return {
          code: lines.join('\n') + '\nexport {};',
          map: null,
        };
      }
      return null;
    },
  };
}

