# vite-plugin-icl

[![CI](https://github.com/polarityio/vite-plugin-icl/actions/workflows/ci.yml/badge.svg)](https://github.com/polarityio/vite-plugin-icl/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/polarityio/vite-plugin-icl/branch/main/graph/badge.svg)](https://codecov.io/gh/polarityio/vite-plugin-icl)

A Vite plugin for the **Polarity integration framework** that automatically transforms web component names into globally unique, versioned names at build time — and handles component discovery, registration, and bundling automatically.

Write clean, readable component names in your source:

```html
<key-value .label=${"Host"} .value=${host}></key-value>
```

They are transformed into collision-proof names during the build:

```html
<px-int-3f8kzq2m1v-icl-key-value-v1-0-0 .label=${"Host"} .value=${host}></px-int-3f8kzq2m1v-icl-key-value-v1-0-0>
```

---

## Table of Contents

- [Requirements](#requirements)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Adding a Component](#adding-a-component)
- [Exporting Additional Files](#exporting-additional-files)
- [Opting Out of Auto-Import](#opting-out-of-auto-import)
- [Acronym Configuration](#acronym-configuration)
- [System Components](#system-components)
- [Library Component Aliases](#library-component-aliases)
- [Custom Library Components](#custom-library-components)
- [Plugin Options](#plugin-options)
- [Contributing](#contributing)

---

## Requirements

- Node.js ≥ 24
- Vite ≥ 5

---

## Installation

```bash
npm install --save-dev vite-plugin-icl
```

---

## Quick Start

Point `build.lib.entry` at `VIRTUAL_COMPONENTS_ID` and tell the plugin where your component files live. Everything else is automatic.

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { transformComponentNames, VIRTUAL_COMPONENTS_ID } from 'vite-plugin-icl';

export default defineConfig({
  plugins: [
    transformComponentNames({
      componentsDir: resolve(__dirname, 'src/web-components'),
    }),
  ],
  build: {
    lib: {
      entry: VIRTUAL_COMPONENTS_ID,
      formats: ['es'],
      fileName: () => 'components.js',
    },
  },
});
```

That's it. The plugin will:

1. Scan `src/web-components` for every `.ts` file
2. Derive a unique tag name for each component from its filename
3. Verify each file exports the expected class
4. Rewrite tag names in your templates at build time
5. Inject `customElements.define(...)` into each component file automatically
6. Bundle everything into a single output file

---

## Adding a Component

Create a `.ts` file anywhere inside `componentsDir`. The filename becomes the component's tag name:

| File | Tag name |
|---|---|
| `key-value.ts` | `<key-value>` |
| `save-modal.ts` | `<save-modal>` |
| `modals/confirm.ts` | `<modals--confirm>` |

Each file must export a class named in **PascalCase** with a **`Component` suffix**. The build will fail with a clear error if the class is missing or misnamed.

```ts
// src/web-components/key-value.ts
import { LitElement, html } from 'lit';
import { property } from 'lit/decorators.js';

export class KeyValueComponent extends LitElement {
  @property() label = '';
  @property() value = '';

  render() {
    return html`
      <dt>${this.label}</dt>
      <dd>${this.value}</dd>
    `;
  }
}
```

> **Naming rules:** filenames must start with a lowercase letter and contain only lowercase letters, digits, hyphens, periods, or underscores. Names reserved by the HTML spec (`annotation-xml`, `color-profile`, etc.) are not allowed.

### Nested components

Files in subdirectories are supported. The directory path is included in the tag name, with path separators replaced by `--` (double-hyphen):

```
src/web-components/
  key-value.ts          →  <key-value>           →  KeyValueComponent
  modals/
    save-modal.ts       →  <modals--save-modal>   →  ModalsSaveModalComponent
```

---

## Exporting Additional Files

If your library also exports utilities, types, or constants alongside your components, keep a hand-written `index.ts` for those exports and pass both entries to Vite. Rollup produces **one output file per entry**.

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { transformComponentNames, VIRTUAL_COMPONENTS_ID } from 'vite-plugin-icl';

export default defineConfig({
  plugins: [
    transformComponentNames({
      componentsDir: resolve(__dirname, 'src/web-components'),
      additionalEntry: resolve(__dirname, 'src/index.ts'),
    }),
  ],
  build: {
    lib: {
      entry: [VIRTUAL_COMPONENTS_ID, resolve(__dirname, 'src/index.ts')],
      formats: ['es'],
      fileName: (_format, entryName) => {
        if (entryName === 'virtual-icl-components') return 'components.js';
        return 'index.js';
      },
    },
  },
});
```

This produces:

```
dist/
  components.js   ← auto-discovered web components
  index.js        ← your custom exports
```

`src/index.ts` can export anything — the plugin does not transform it:

```ts
// src/index.ts
export { version } from './version.js';
export type { MyConfig } from './types.js';
```

> When using two entry points, `fileName` must return a **distinct name for each entry** to prevent one file from overwriting the other.

---

## Opting Out of Auto-Import

By default the plugin serves the `VIRTUAL_COMPONENTS_ID` virtual entry that automatically pulls every component into the bundle. Set `autoImport: false` to disable this and manage imports yourself via a hand-written `index.ts`.

```ts
transformComponentNames({
  componentsDir: resolve(__dirname, 'src/web-components'),
  autoImport: false,
})
```

With `autoImport: false`:
- `VIRTUAL_COMPONENTS_ID` is no longer available as a build entry
- Your `vite.config.ts` entry should point at your own `index.ts`
- Tag rewriting and `customElements.define(...)` injection still happen automatically for any component file that is imported

> **Note:** With `autoImport: false`, any component file that is not reachable from your entry point will be silently absent from the bundle.

---

## Acronym Configuration

The plugin reads the `acronym` field from `config/config.json` in your project root to include your integration's identifier in the generated component names.

```json
{
  "acronym": "echo-wc"
}
```

This produces names like:

```
px-int-3f8kzq2m1v-echo-wc-key-value-v1-0-0
```

The acronym is always lowercased regardless of how it is written in the config file. If `config/config.json` does not exist or the `acronym` key is absent, it defaults to `icl`.

---

## System Components

Some components have pre-assigned unique names supplied by the Polarity framework rather than generated by this plugin. These are declared in the `components` array in `config/config.json`:

```json
{
  "acronym": "echo-wc",
  "components": [
    {
      "type": "summary",
      "element": "px-int-9b69kxiww6yoxs74n4auduspb-echo-wc-summary-v5-0-0"
    },
    {
      "type": "details",
      "element": "px-int-9b69kxiww6yoxs74n4auduspb-echo-wc-details-v5-0-0"
    }
  ]
}
```

When the plugin discovers a file whose derived name matches a `type` in this list, it uses the corresponding `element` value as the unique name instead of generating one. Everything else — class export verification, tag rewriting, and `customElements.define(...)` injection — works identically.

---

## Library Component Aliases

When `integration-component-library` is installed in your project, the plugin automatically rewrites its component tags (e.g. `<object-to-table>`) into their resolved versioned names at build time, and injects the corresponding `import` and `customElements.define(...)` calls.

| Write this | Transforms to |
|---|---|
| `<object-to-table>` | `<px-lib-object-to-table-v1-0-0>` |
| `</object-to-table>` | `</px-lib-object-to-table-v1-0-0>` |

The resolved name is computed from the library's `package.json` version using the formula `px-lib-{name}-v{version}` (with dots replaced by hyphens). No library code is executed at build time.

If you prefer to handle library components yourself — for example by using `staticHtml` / `unsafeStatic` with the exported name variable, or by referencing the long-form tag name directly — set `rewriteLibraryComponents: false`:

```ts
transformComponentNames({
  componentsDir: resolve(__dirname, 'src/web-components'),
  rewriteLibraryComponents: false,
})
```

If `integration-component-library` is not installed, library component rewriting is skipped automatically with a console warning.

---

## Custom Library Components

If `integration-component-library` ships new components that the plugin doesn't know about yet, you can register them yourself with the `libraryComponents` option. Each key is the short tag name (kebab-case) and the value specifies the named class export from the library:

```ts
// vite.config.ts
transformComponentNames({
  componentsDir: resolve(__dirname, 'src/web-components'),
  libraryComponents: {
    'data-grid': { className: 'DataGrid' },
    'status-badge': { className: 'StatusBadge' },
  },
})
```

These entries are merged with the plugin's built-in definitions (e.g. `object-to-table`). The plugin then handles them identically — rewriting tags, injecting imports, and registering them via `customElements.define(...)`.

| Write this | Transforms to |
|---|---|
| `<data-grid>` | `<px-lib-data-grid-v1-0-0>` |
| `<status-badge>` | `<px-lib-status-badge-v1-0-0>` |

If a key in `libraryComponents` conflicts with a built-in definition, the user-provided value takes precedence and the plugin emits a build warning.

---

## Plugin Options

### `componentsDir` *(required)*

| Type |
|---|
| `string` |

The absolute path to the directory containing your web component source files. The plugin scans this directory recursively to discover components and uses it as a filter — only `.ts` files inside this directory are processed.

```ts
componentsDir: resolve(__dirname, 'src/web-components')
```

---

### `autoImport`

| Type | Default |
|---|---|
| `boolean` | `true` |

When `true`, the `VIRTUAL_COMPONENTS_ID` virtual entry is available and automatically imports every discovered component into the bundle. Set to `false` to manage your own entry point and imports.

See [Opting Out of Auto-Import](#opting-out-of-auto-import) for details.

---

### `additionalEntry`

| Type | Default |
|---|---|
| `string` | — |

The absolute path to a hand-written entry file for exports beyond the auto-discovered components. The build will fail immediately with a clear error if this file does not exist.

See [Exporting Additional Files](#exporting-additional-files) for a full example.

---

### `rewriteLibraryComponents`

| Type | Default |
|---|---|
| `boolean` | `true` |

When `true`, the plugin rewrites `integration-component-library` component tags (e.g. `<object-to-table>`) into their resolved versioned names and injects `import` / `customElements.define(...)` calls automatically.

Set to `false` to handle library components yourself.

See [Library Component Aliases](#library-component-aliases) for details.

---

### `libraryComponents`

| Type | Default |
|---|---|
| `Record<string, { className: string }>` | — |

Additional library component definitions to register alongside the built-in ones. Each key is the short tag name (kebab-case) and the value specifies the named export from `integration-component-library`.

User-provided entries are merged with the built-in definitions. If a key conflicts with a built-in definition, the user-provided value takes precedence and a build warning is emitted.

See [Custom Library Components](#custom-library-components) for a full example.

---

## Contributing

See [DEVELOPMENT.md](./DEVELOPMENT.md) for architecture details, how to run tests, and how to contribute.
