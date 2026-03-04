# Development

This document covers the internal architecture of `vite-plugin-icl`, how to set up a development environment, and how to run tests and contribute changes.

---

## Table of Contents

- [Project Structure](#project-structure)
- [Setup](#setup)
- [Available Scripts](#available-scripts)
- [Architecture](#architecture)
  - [Unique Name Format](#unique-name-format)
  - [Filename → Tag Name Derivation](#filename--tag-name-derivation)
  - [Class Name Convention](#class-name-convention)
  - [Virtual Entry Module](#virtual-entry-module)
  - [Vite Plugin Hooks](#vite-plugin-hooks)
  - [Component Registration](#component-registration)
  - [Predefined Components](#predefined-components)
  - [Library Component Aliases](#library-component-aliases)
- [Validation Rules](#validation-rules)
- [Config File Integration](#config-file-integration)
- [Testing](#testing)
- [Adding a Library Component Alias](#adding-a-library-component-alias)

---

## Project Structure

```
vite-plugin-icl/
  src/
    index.ts                      ← public exports
    transform-component-name.ts   ← plugin implementation
    transform-component-name.test.ts
  dist/                           ← built output (not committed)
  package.json
  tsup.config.ts
  vite.config.ts
  tsconfig.json
  eslint.config.js
```

---

## Setup

Requires Node.js 24. If you use [asdf](https://asdf-vm.com/), run:

```bash
asdf shell nodejs 24.1.0
```

Then install dependencies:

```bash
npm install
```

---

## Available Scripts

| Command | Description |
|---|---|
| `npm run build` | Compile to `dist/` via tsup (CJS + ESM + type declarations) |
| `npm test` | Run the full test suite with Vitest |
| `npm run test:watch` | Run tests in watch mode |
| `npm run lint` | Run ESLint |
| `npm run format` | Run Prettier |

---

## Architecture

The plugin is implemented in a single file: `src/transform-component-name.ts`. It exports:

- `transformComponentNames(options)` — the Vite plugin factory
- `VIRTUAL_COMPONENTS_ID` — the virtual entry point identifier (`'virtual:icl-components'`)
- `PluginOptions` — the TypeScript interface for plugin configuration
- Several pure utility functions used internally and exported for testing

### Unique Name Format

Every auto-discovered component gets a unique name in this format:

```
px-int-{hash}-{acronym}-{component-name}-{version}
```

| Part | Source |
|---|---|
| `px-int` | Fixed namespace prefix |
| `{hash}` | Base-36 encoded UUID generated once per plugin instantiation via `convertUUIDToBase36(randomUUID())` |
| `{acronym}` | Lowercased value of `acronym` from `config/config.json`, defaulting to `icl` |
| `{component-name}` | Derived from the file path relative to `componentsDir` (see below) |
| `{version}` | `version` from `package.json` with dots replaced by dashes, prefixed with `v` (e.g. `v1-0-0`) |

The hash is stable within a single build but changes between builds, ensuring that two separately built integrations loaded on the same page never collide.

### Filename → Tag Name Derivation

`filePathToComponentName(relativePath: string): string`

Given a path relative to `componentsDir`:

1. Strip the `.ts` extension
2. Replace all path separators (`/` or `\`) with `--` (double-hyphen)
3. Lowercase the result

Examples (base = `src/web-components`):

| File | Derived name |
|---|---|
| `key-value.ts` | `key-value` |
| `summary.ts` | `summary` |
| `modals/save-modal.ts` | `modals--save-modal` |
| `forms/inputs/text-input.ts` | `forms--inputs--text-input` |

The double-hyphen separator distinguishes directory nesting from hyphens within a filename. For example, `modals-save/modal.ts` → `modals-save--modal`, which is distinct from `modals/save-modal.ts` → `modals--save-modal`.

### Class Name Convention

`componentNameToClassName(componentName: string): string`

The derived component name is converted to the expected PascalCase class name with a `Component` suffix. Both single hyphens (filename word separators) and double hyphens (directory separators) are treated as word boundaries.

| Component name | Expected class |
|---|---|
| `key-value` | `KeyValueComponent` |
| `summary` | `SummaryComponent` |
| `modals--save-modal` | `ModalsSaveModalComponent` |
| `forms--inputs--text-input` | `FormsInputsTextInputComponent` |

### Virtual Entry Module

`VIRTUAL_COMPONENTS_ID = 'virtual:icl-components'`

When `autoImport` is `true` (the default), the plugin registers a virtual Rollup module via the standard `resolveId` + `load` hook pair:

- `resolveId` intercepts requests for `VIRTUAL_COMPONENTS_ID` and returns the internal sentinel id `'\0virtual:icl-components'` (the `\0` prefix is a Rollup convention for virtual modules)
- `load` generates the module content on demand — a list of side-effect imports, one per discovered file, plus `export {}`

```ts
// generated in memory — never written to disk
import '/abs/path/src/web-components/key-value.ts';
import '/abs/path/src/web-components/modals/save-modal.ts';
export {};
```

Rollup follows those imports, hands each file to `transform`, and the plugin processes them normally. When `autoImport` is `false`, `resolveId` returns `null` and `load` returns `null`, making the virtual module invisible to Rollup entirely.

### Vite Plugin Hooks

The plugin uses three Vite/Rollup hooks:

#### `buildStart`

Runs once at the beginning of each build. It:

1. Reads `config/config.json` to resolve the acronym and any predefined component names
2. Validates `additionalEntry` exists (if provided)
3. Recursively scans `componentsDir` using `collectTsFiles`
4. For each `.ts` file found:
   - Derives the component name via `filePathToComponentName`
   - Validates it with `isValidComponentFileName` (throws a clear error if invalid)
   - Looks up a predefined unique name from config, or generates one
   - Stores the mapping in `componentMap` (name → unique name) and `fileComponentMap` (abs path → metadata)

#### `transform(code, id)`

Runs on every file that Vite processes. It:

1. **Guards** — returns `null` immediately if the file is not a `.ts` file inside `componentsDir`
2. **Registration injection** — if the file is in `fileComponentMap`, verifies the expected class export exists (throws clearly if missing), then appends an inline `customElements.define(...)` block if not already present
3. **Tag rewriting** — for every entry in `componentMap`, rewrites `<name>`, `</name>`, and string literals `'name'` to their unique equivalents
4. **Library alias rewriting** — rewrites known library component aliases to their imported constant variable names
5. Returns the transformed code and a `null` source map, or `null` if nothing changed

#### `resolveId` / `load`

Handle the virtual entry module as described above.

### Component Registration

Instead of depending on an external helper, the plugin injects a self-contained registration block directly into each component file:

```ts
if (customElements.get('px-int-...') === undefined) {
  customElements.define('px-int-...', KeyValueComponent as unknown as CustomElementConstructor);
}
```

This uses the standard browser `CustomElementRegistry` API and has no external dependencies. The guard prevents errors if a component is somehow registered twice. The injection is idempotent — if the `customElements.get(...)` call is already present in the file (e.g. from a previous transform pass), the block is not appended again.

### Predefined Components

Some components have externally assigned unique names supplied by the Polarity framework (e.g. `summary`, `details`). These are stored in the `components` array in `config/config.json`.

During `buildStart`, `resolvePredefinedComponents` reads this array and builds a `Map<string, string>` of `type → element`. When the scanner encounters a file whose derived name matches a key in this map, it uses the pre-assigned `element` value instead of generating one.

Predefined components:
- **Skip** the `isValidCustomElementName` hyphen requirement (single-word names like `summary` are allowed)
- Still go through `isValidComponentFileName` validation
- Still require the expected class export in `transform`
- Still have `customElements.define(...)` injected — using the pre-assigned unique name

### Library Component Aliases

The `libraryComponentMap` in the plugin is a hardcoded `Record<string, string>` mapping short alias names to imported constant variable names:

```ts
const libraryComponentMap: Record<string, string> = {
  'object-to-table': 'ObjectToTableName',
};
```

Tags matching an alias are rewritten to template expression syntax:

- `<object-to-table>` → `<${ObjectToTableName}>`
- `</object-to-table>` → `</${ObjectToTableName}>`

This allows Lit's `staticHtml` to use the constant as a tag name without `unsafeStatic`. See [Adding a Library Component Alias](#adding-a-library-component-alias) to extend this map.

---

## Validation Rules

### `isValidComponentFileName(name)`

Used to validate the name derived from a filename before it is registered. Accepts:
- Starts with a lowercase ASCII letter
- Contains only `[a-z0-9\-._]`
- Is not a reserved HTML name

A hyphen is **not** required — single-word filenames like `summary.ts` are valid because the generated unique name always contains hyphens regardless.

### `isValidCustomElementName(name)`

Enforces the full HTML custom element spec. Requires all of the above **plus** at least one hyphen. Used when validating that the final unique name produced by the plugin is a valid browser custom element name.

---

## Config File Integration

The plugin reads `config/config.json` once per build in `buildStart` via `readProjectConfig()`. The file is parsed with `JSON.parse` (not `require`) to avoid Node.js module caching across builds.

The `IntegrationConfig` interface describes the expected shape:

```ts
interface IntegrationConfig {
  acronym?: string;
  components?: Array<{ type?: unknown; element?: unknown }>;
}
```

Both fields are optional. Unknown fields are ignored. Malformed JSON or a missing file result in an empty config object — the build continues with defaults.

---

## Testing

Tests live in `src/transform-component-name.test.ts` and use [Vitest](https://vitest.dev/).

Because the plugin hooks (`buildStart`, `transform`, `resolveId`, `load`) are plain functions, they are tested by calling them directly with a thin wrapper:

```ts
function callBuildStart(plugin: Plugin): void {
  (plugin.buildStart as () => void).call({} as never);
}

function callTransform(plugin: Plugin, code: string, id: string): unknown {
  return (plugin.transform as (code: string, id: string) => unknown)
    .call({} as never, code, id);
}
```

Tests that require real files on disk use the `withTempDir` helper, which creates an OS temp directory, runs the test, then removes it unconditionally.

Tests that write `config/config.json` use `beforeEach`/`afterEach` to create and clean up the `config/` directory relative to `process.cwd()`, restoring the directory state even on failure.

Run all tests:

```bash
npm test
```

Run in watch mode:

```bash
npm run test:watch
```

---

## Adding a Library Component Alias

Open `src/transform-component-name.ts` and add an entry to the `libraryComponentMap` inside the `transformComponentNames` function:

```ts
const libraryComponentMap: Record<string, string> = {
  'object-to-table': 'ObjectToTableName',
  'p-tag': 'PTagName',          // ← add new aliases here
  'p-link': 'PLinkName',
};
```

Then add corresponding test cases to `src/transform-component-name.test.ts` in the `library component transforms` describe block.

