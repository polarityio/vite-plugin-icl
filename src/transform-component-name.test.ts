import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  convertUUIDToBase36,
  isValidCustomElementName,
  isValidComponentFileName,
  filePathToComponentName,
  componentNameToClassName,
  transformComponentNames,
  VIRTUAL_COMPONENTS_ID,
} from './transform-component-name.js';

// ─── helpers ─────────────────────────────────────────────────────────────────

function callTransform(plugin: Plugin, code: string, id: string): unknown {
  if (typeof plugin.transform !== 'function') return null;
  return (plugin.transform as (code: string, id: string) => unknown).call({} as never, code, id);
}

function callBuildStart(plugin: Plugin, context?: Record<string, unknown>): void {
  if (typeof plugin.buildStart !== 'function') return;
  (plugin.buildStart as () => void).call((context ?? { warn: () => {} }) as never);
}

function callResolveId(plugin: Plugin, id: string): string | null {
  if (typeof plugin.resolveId !== 'function') return null;
  return (plugin.resolveId as (id: string) => string | null).call({} as never, id);
}

function callLoad(plugin: Plugin, id: string): unknown {
  if (typeof plugin.load !== 'function') return null;
  return (plugin.load as (id: string) => unknown).call({} as never, id);
}

/** Creates a temporary directory, runs the callback, then removes the dir. */
function withTempDir(fn: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vite-plugin-icl-'));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Writes a file, creating intermediate directories as needed. */
function writeFile(base: string, relative: string, content: string): string {
  const full = path.join(base, relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  return full;
}

// ─── convertUUIDToBase36 ─────────────────────────────────────────────────────

describe('convertUUIDToBase36', () => {
  it('converts a known UUID to the expected base-36 string', () => {
    expect(convertUUIDToBase36('00000000-0000-0000-0000-000000000000')).toBe('0');
  });

  it('converts a UUID with all f-bytes correctly', () => {
    expect(convertUUIDToBase36('ffffffff-ffff-ffff-ffff-ffffffffffff')).toBe(
      BigInt('0x' + 'f'.repeat(32)).toString(36),
    );
  });

  it('returns a string containing only lowercase alphanumeric characters', () => {
    expect(convertUUIDToBase36('550e8400-e29b-41d4-a716-446655440000')).toMatch(/^[0-9a-z]+$/);
  });

  it('handles a real-world UUID without throwing', () => {
    expect(() => convertUUIDToBase36('6ba7b810-9dad-11d1-80b4-00c04fd430c8')).not.toThrow();
  });
});

// ─── isValidCustomElementName ────────────────────────────────────────────────

describe('isValidCustomElementName', () => {
  it('accepts a simple valid name', () => {
    expect(isValidCustomElementName('key-value')).toBe(true);
  });

  it('accepts names with double-hyphen directory separators', () => {
    expect(isValidCustomElementName('modals--save-modal')).toBe(true);
  });

  it('accepts names with digits', () => {
    expect(isValidCustomElementName('my-element-2')).toBe(true);
  });

  it('accepts names with periods and underscores', () => {
    expect(isValidCustomElementName('my.element_one')).toBe(false); // no hyphen
    expect(isValidCustomElementName('my-element.one')).toBe(true);
    expect(isValidCustomElementName('my-element_one')).toBe(true);
  });

  it('rejects names with no hyphen', () => {
    expect(isValidCustomElementName('keyvalue')).toBe(false);
  });

  it('rejects names starting with a digit', () => {
    expect(isValidCustomElementName('2fa-widget')).toBe(false);
  });

  it('rejects names starting with a hyphen', () => {
    expect(isValidCustomElementName('-my-element')).toBe(false);
  });

  it('rejects names with uppercase letters', () => {
    expect(isValidCustomElementName('Key-Value')).toBe(false);
  });

  it('rejects all reserved HTML names', () => {
    const reserved = [
      'annotation-xml',
      'color-profile',
      'font-face',
      'font-face-src',
      'font-face-uri',
      'font-face-format',
      'font-face-name',
      'missing-glyph',
    ];
    for (const name of reserved) {
      expect(isValidCustomElementName(name), `"${name}" should be rejected`).toBe(false);
    }
  });
});

// ─── isValidComponentFileName ─────────────────────────────────────────────────

describe('isValidComponentFileName', () => {
  it('accepts a hyphenated name', () => {
    expect(isValidComponentFileName('key-value')).toBe(true);
  });

  it('accepts a single-word name (no hyphen required)', () => {
    expect(isValidComponentFileName('summary')).toBe(true);
    expect(isValidComponentFileName('details')).toBe(true);
    expect(isValidComponentFileName('widget')).toBe(true);
  });

  it('accepts names with double-hyphen directory separators', () => {
    expect(isValidComponentFileName('modals--save-modal')).toBe(true);
  });

  it('accepts names with digits', () => {
    expect(isValidComponentFileName('my-element-2')).toBe(true);
    expect(isValidComponentFileName('element2')).toBe(true);
  });

  it('accepts names with periods and underscores', () => {
    expect(isValidComponentFileName('my-element.one')).toBe(true);
    expect(isValidComponentFileName('my-element_one')).toBe(true);
    expect(isValidComponentFileName('my.element_one')).toBe(true);
  });

  it('rejects names starting with a digit', () => {
    expect(isValidComponentFileName('2fa-widget')).toBe(false);
  });

  it('rejects names starting with a hyphen', () => {
    expect(isValidComponentFileName('-my-element')).toBe(false);
  });

  it('rejects names with uppercase letters', () => {
    expect(isValidComponentFileName('Key-Value')).toBe(false);
    expect(isValidComponentFileName('Summary')).toBe(false);
  });

  it('rejects all reserved HTML names', () => {
    const reserved = [
      'annotation-xml',
      'color-profile',
      'font-face',
      'font-face-src',
      'font-face-uri',
      'font-face-format',
      'font-face-name',
      'missing-glyph',
    ];
    for (const name of reserved) {
      expect(isValidComponentFileName(name), `"${name}" should be rejected`).toBe(false);
    }
  });
});

// ─── filePathToComponentName ──────────────────────────────────────────────────

describe('filePathToComponentName', () => {
  it('strips the .ts extension', () => {
    expect(filePathToComponentName('key-value.ts')).toBe('key-value');
  });

  it('lowercases the result', () => {
    expect(filePathToComponentName('Key-Value.ts')).toBe('key-value');
  });

  it('replaces forward-slash directory separators with --', () => {
    expect(filePathToComponentName('modals/save-modal.ts')).toBe('modals--save-modal');
  });

  it('replaces backslash directory separators with --', () => {
    expect(filePathToComponentName('modals\\save-modal.ts')).toBe('modals--save-modal');
  });

  it('handles deeply nested paths', () => {
    expect(filePathToComponentName('forms/inputs/text-input.ts')).toBe('forms--inputs--text-input');
  });

  it('disambiguates directory hyphens from filename hyphens', () => {
    expect(filePathToComponentName('modals-save/modal.ts')).toBe('modals-save--modal');
    expect(filePathToComponentName('modals/save-modal.ts')).toBe('modals--save-modal');
    expect(filePathToComponentName('modals-save/modal.ts')).not.toBe(
      filePathToComponentName('modals/save-modal.ts'),
    );
  });
});

// ─── componentNameToClassName ────────────────────────────────────────────────

describe('componentNameToClassName', () => {
  it('converts a simple name', () => {
    expect(componentNameToClassName('key-value')).toBe('KeyValueComponent');
  });

  it('converts a name with double-hyphen directory separator', () => {
    expect(componentNameToClassName('modals--save-modal')).toBe('ModalsSaveModalComponent');
  });

  it('converts a deeply nested name', () => {
    expect(componentNameToClassName('forms--inputs--text-input')).toBe(
      'FormsInputsTextInputComponent',
    );
  });

  it('always appends the Component suffix', () => {
    expect(componentNameToClassName('my-widget')).toMatch(/Component$/);
  });
});

// ─── transformComponentNames plugin ──────────────────────────────────────────

describe('transformComponentNames plugin', () => {
  it('has the correct plugin name', () => {
    withTempDir((dir) => {
      expect(transformComponentNames({ componentsDir: dir }).name).toBe(
        'transform-component-names',
      );
    });
  });

  it('is applied only during build', () => {
    withTempDir((dir) => {
      expect(transformComponentNames({ componentsDir: dir }).apply).toBe('build');
    });
  });

  // ─── file filtering ────────────────────────────────────────────────────────

  describe('file filtering', () => {
    it('only processes .ts files inside componentsDir', () => {
      withTempDir((dir) => {
        writeFile(dir, 'my-component.ts', 'export class MyComponentComponent {}');
        const plugin = transformComponentNames({ componentsDir: dir });
        callBuildStart(plugin);
        const inside = path.join(dir, 'my-component.ts');
        const outsideDir = path.join(os.tmpdir(), 'other', 'foo.ts');
        const wrongExt = path.join(dir, 'foo.js');
        // component transform fires for matching .ts files
        expect(
          callTransform(plugin, 'export class MyComponentComponent {}', inside),
        ).not.toBeNull();
        // non-.ts files are ignored even if inside componentsDir
        expect(callTransform(plugin, 'export class MyComponentComponent {}', wrongExt)).toBeNull();
        // files outside componentsDir are ignored
        expect(
          callTransform(plugin, 'export class MyComponentComponent {}', outsideDir),
        ).toBeNull();
      });
    });

    it('returns null when the code has nothing to transform', () => {
      withTempDir((dir) => {
        const plugin = transformComponentNames({ componentsDir: dir });
        expect(callTransform(plugin, 'const x = 42;', path.join(dir, 'foo.ts'))).toBeNull();
      });
    });
  });

  // ─── library component transforms ─────────────────────────────────────────

  it('skips library component handling when the library is not available', () => {
    withTempDir((dir) => {
      const plugin = transformComponentNames({ componentsDir: dir });
      callBuildStart(plugin);
      const file = path.join(dir, 'other.ts');
      writeFile(dir, 'other.ts', 'const x = 1;');
      const result = callTransform(plugin, '<object-to-table></object-to-table>', file);
      expect(result).toBeNull();
    });
  });

  it('skips library component rewriting when rewriteLibraryComponents is false', () => {
    withTempDir((dir) => {
      const plugin = transformComponentNames({
        componentsDir: dir,
        rewriteLibraryComponents: false,
      });
      callBuildStart(plugin);
      const file = path.join(dir, 'my-component.ts');
      writeFile(dir, 'my-component.ts', 'export class MyComponentComponent {}');
      const result = callTransform(plugin, '<object-to-table .data=${x}></object-to-table>', file);
      expect(result).toBeNull();
    });
  });

  describe('library component transforms (object-to-table)', () => {
    const MOCK_LIB_VERSION = '1.0.0';
    const MOCK_OTT_NAME = 'px-lib-object-to-table-v1-0-0';
    const mockLibDir = path.resolve(process.cwd(), 'node_modules', 'integration-component-library');
    const mockPkgPath = path.join(mockLibDir, 'package.json');
    let hadMockLib: boolean;
    let hadPkgJson: boolean;
    let originalPkgJson: string | undefined;

    beforeEach(() => {
      hadMockLib = fs.existsSync(mockLibDir);
      hadPkgJson = fs.existsSync(mockPkgPath);
      if (!hadMockLib) {
        fs.mkdirSync(mockLibDir, { recursive: true });
      } else if (hadPkgJson) {
        originalPkgJson = fs.readFileSync(mockPkgPath, 'utf-8');
      }
      fs.writeFileSync(
        mockPkgPath,
        JSON.stringify({ name: 'integration-component-library', version: MOCK_LIB_VERSION }),
      );
    });

    afterEach(() => {
      if (!hadMockLib) {
        fs.rmSync(mockLibDir, { recursive: true, force: true });
      } else if (hadPkgJson && originalPkgJson !== undefined) {
        fs.writeFileSync(mockPkgPath, originalPkgJson);
        originalPkgJson = undefined;
      } else if (!hadPkgJson) {
        fs.rmSync(mockPkgPath, { force: true });
      }
    });

    it('rewrites an opening tag to the resolved concrete name', () => {
      withTempDir((dir) => {
        const plugin = transformComponentNames({ componentsDir: dir });
        callBuildStart(plugin);
        const file = path.join(dir, 'my-component.ts');
        writeFile(dir, 'my-component.ts', 'export class MyComponentComponent {}');
        const result = callTransform(plugin, `<object-to-table .data=\${x}>`, file) as {
          code: string;
        };
        expect(result.code).toContain(`<${MOCK_OTT_NAME} .data=\${x}>`);
      });
    });

    it('rewrites a closing tag to the resolved concrete name', () => {
      withTempDir((dir) => {
        const plugin = transformComponentNames({ componentsDir: dir });
        callBuildStart(plugin);
        const file = path.join(dir, 'my-component.ts');
        writeFile(dir, 'my-component.ts', 'export class MyComponentComponent {}');
        const result = callTransform(plugin, '</object-to-table>', file) as { code: string };
        expect(result.code).toContain(`</${MOCK_OTT_NAME}>`);
      });
    });

    it('rewrites both opening and closing tags', () => {
      withTempDir((dir) => {
        const plugin = transformComponentNames({ componentsDir: dir });
        callBuildStart(plugin);
        const file = path.join(dir, 'my-component.ts');
        writeFile(dir, 'my-component.ts', 'export class MyComponentComponent {}');
        const result = callTransform(
          plugin,
          '<object-to-table .data=${x}></object-to-table>',
          file,
        ) as { code: string };
        expect(result.code).toContain(`<${MOCK_OTT_NAME} .data=\${x}>`);
        expect(result.code).toContain(`</${MOCK_OTT_NAME}>`);
      });
    });

    it('injects the library import statement', () => {
      withTempDir((dir) => {
        const plugin = transformComponentNames({ componentsDir: dir });
        callBuildStart(plugin);
        const file = path.join(dir, 'my-component.ts');
        writeFile(dir, 'my-component.ts', 'export class MyComponentComponent {}');
        const result = callTransform(plugin, '<object-to-table></object-to-table>', file) as {
          code: string;
        };
        expect(result.code).toContain(
          "import { ObjectToTable } from 'integration-component-library';",
        );
      });
    });

    it('injects the registration block for the library component', () => {
      withTempDir((dir) => {
        const plugin = transformComponentNames({ componentsDir: dir });
        callBuildStart(plugin);
        const file = path.join(dir, 'my-component.ts');
        writeFile(dir, 'my-component.ts', 'export class MyComponentComponent {}');
        const result = callTransform(plugin, '<object-to-table></object-to-table>', file) as {
          code: string;
        };
        expect(result.code).toContain(`customElements.get('${MOCK_OTT_NAME}')`);
        expect(result.code).toContain(
          `customElements.define('${MOCK_OTT_NAME}', ObjectToTable as unknown as CustomElementConstructor)`,
        );
      });
    });
    it('does not rewrite library tags when rewriteLibraryComponents is false even if library is installed', () => {
      withTempDir((dir) => {
        const plugin = transformComponentNames({
          componentsDir: dir,
          rewriteLibraryComponents: false,
        });
        callBuildStart(plugin);
        const file = path.join(dir, 'my-component.ts');
        writeFile(dir, 'my-component.ts', 'export class MyComponentComponent {}');
        const result = callTransform(
          plugin,
          '<object-to-table .data=${x}></object-to-table>',
          file,
        );
        expect(result).toBeNull();
      });
    });
  });

  // ─── user-provided libraryComponents option ─────────────────────────────────

  describe('libraryComponents option', () => {
    const MOCK_LIB_VERSION = '1.0.0';
    const mockLibDir = path.resolve(process.cwd(), 'node_modules', 'integration-component-library');
    const mockPkgPath = path.join(mockLibDir, 'package.json');
    let hadMockLib: boolean;
    let hadPkgJson: boolean;
    let originalPkgJson: string | undefined;

    beforeEach(() => {
      hadMockLib = fs.existsSync(mockLibDir);
      hadPkgJson = fs.existsSync(mockPkgPath);
      if (!hadMockLib) {
        fs.mkdirSync(mockLibDir, { recursive: true });
      } else if (hadPkgJson) {
        originalPkgJson = fs.readFileSync(mockPkgPath, 'utf-8');
      }
      fs.writeFileSync(
        mockPkgPath,
        JSON.stringify({ name: 'integration-component-library', version: MOCK_LIB_VERSION }),
      );
    });

    afterEach(() => {
      if (!hadMockLib) {
        fs.rmSync(mockLibDir, { recursive: true, force: true });
      } else if (hadPkgJson && originalPkgJson !== undefined) {
        fs.writeFileSync(mockPkgPath, originalPkgJson);
        originalPkgJson = undefined;
      } else if (!hadPkgJson) {
        fs.rmSync(mockPkgPath, { force: true });
      }
    });

    it('resolves and rewrites a user-provided library component', () => {
      withTempDir((dir) => {
        const plugin = transformComponentNames({
          componentsDir: dir,
          libraryComponents: {
            'data-grid': { className: 'DataGrid' },
          },
        });
        callBuildStart(plugin);
        const file = path.join(dir, 'my-component.ts');
        writeFile(dir, 'my-component.ts', 'export class MyComponentComponent {}');
        const result = callTransform(plugin, '<data-grid></data-grid>', file) as {
          code: string;
        };
        expect(result.code).toContain('px-lib-data-grid-v1-0-0');
        expect(result.code).toContain("import { DataGrid } from 'integration-component-library';");
        expect(result.code).toContain("customElements.get('px-lib-data-grid-v1-0-0')");
      });
    });

    it('uses user value and warns when overriding a built-in definition', () => {
      withTempDir((dir) => {
        const plugin = transformComponentNames({
          componentsDir: dir,
          libraryComponents: {
            'object-to-table': { className: 'MyCustomObjectToTable' },
          },
        });
        const warnFn = vi.fn();
        callBuildStart(plugin, { warn: warnFn });

        expect(warnFn).toHaveBeenCalledWith(
          expect.stringContaining('overrides built-in definition'),
        );

        const file = path.join(dir, 'my-component.ts');
        writeFile(dir, 'my-component.ts', 'export class MyComponentComponent {}');
        const result = callTransform(plugin, '<object-to-table></object-to-table>', file) as {
          code: string;
        };
        expect(result.code).toContain(
          "import { MyCustomObjectToTable } from 'integration-component-library';",
        );
      });
    });

    it('preserves built-in defs alongside user-provided defs', () => {
      withTempDir((dir) => {
        const plugin = transformComponentNames({
          componentsDir: dir,
          libraryComponents: {
            'status-badge': { className: 'StatusBadge' },
          },
        });
        callBuildStart(plugin);
        const file = path.join(dir, 'my-component.ts');
        writeFile(dir, 'my-component.ts', 'export class MyComponentComponent {}');

        const ottResult = callTransform(plugin, '<object-to-table></object-to-table>', file) as {
          code: string;
        };
        expect(ottResult.code).toContain('px-lib-object-to-table-v1-0-0');

        const badgeResult = callTransform(plugin, '<status-badge></status-badge>', file) as {
          code: string;
        };
        expect(badgeResult.code).toContain('px-lib-status-badge-v1-0-0');
      });
    });

    it('does not emit a false override warning for inherited property names', () => {
      withTempDir((dir) => {
        const plugin = transformComponentNames({
          componentsDir: dir,
          libraryComponents: {
            'to-string': { className: 'ToString' },
          },
        });
        const warnFn = vi.fn();
        callBuildStart(plugin, { warn: warnFn });

        expect(warnFn).not.toHaveBeenCalledWith(
          expect.stringContaining('overrides built-in definition'),
        );
      });
    });

    it('emits correct override warnings consistently across repeated buildStart calls', () => {
      withTempDir((dir) => {
        const plugin = transformComponentNames({
          componentsDir: dir,
          libraryComponents: {
            'object-to-table': { className: 'MyCustomObjectToTable' },
          },
        });
        const warnFn = vi.fn();
        callBuildStart(plugin, { warn: warnFn });
        callBuildStart(plugin, { warn: warnFn });

        const overrideCalls = warnFn.mock.calls.filter((args: string[]) =>
          args[0].includes('overrides built-in definition'),
        );
        expect(overrideCalls).toHaveLength(2);
        for (const call of overrideCalls) {
          expect(call[0]).toContain('className "ObjectToTable"');
          expect(call[0]).toContain('"MyCustomObjectToTable"');
        }
      });
    });
  });

  // ─── buildStart idempotency (watch mode) ──────────────────────────────────

  describe('buildStart idempotency', () => {
    it('does not rewrite a deleted component on the second build', () => {
      withTempDir((dir) => {
        writeFile(dir, 'key-value.ts', 'export class KeyValueComponent {}');
        writeFile(dir, 'other.ts', 'export class OtherComponent {}');
        const plugin = transformComponentNames({ componentsDir: dir });
        callBuildStart(plugin);

        // key-value should be rewritten after first build
        const file = path.join(dir, 'other.ts');
        const result1 = callTransform(
          plugin,
          'export class OtherComponent {}\n<key-value></key-value>',
          file,
        ) as { code: string };
        expect(result1.code).toContain('px-int-');

        // Delete key-value.ts and rebuild
        fs.unlinkSync(path.join(dir, 'key-value.ts'));
        callBuildStart(plugin);

        // key-value should no longer be rewritten — the tag stays as-is
        const result2 = callTransform(
          plugin,
          'export class OtherComponent {}\n<key-value></key-value>',
          file,
        ) as { code: string };
        expect(result2.code).toContain('<key-value></key-value>');
        expect(result2.code).not.toContain('-key-value-');
      });
    });

    it('clears library entries when library is removed between builds', () => {
      const mockLibDir = path.resolve(
        process.cwd(),
        'node_modules',
        'integration-component-library',
      );
      const mockPkgPath = path.join(mockLibDir, 'package.json');
      const hadMockLib = fs.existsSync(mockLibDir);
      const hadPkgJson = fs.existsSync(mockPkgPath);
      const originalPkgJson = hadPkgJson ? fs.readFileSync(mockPkgPath, 'utf-8') : undefined;

      if (!hadMockLib) {
        fs.mkdirSync(mockLibDir, { recursive: true });
      }
      fs.writeFileSync(
        mockPkgPath,
        JSON.stringify({ name: 'integration-component-library', version: '1.0.0' }),
      );

      try {
        withTempDir((dir) => {
          writeFile(dir, 'my-component.ts', 'export class MyComponentComponent {}');
          const plugin = transformComponentNames({ componentsDir: dir });
          const warnFn = vi.fn();
          callBuildStart(plugin, { warn: warnFn });

          // Library component should be rewritten after first build
          const file = path.join(dir, 'my-component.ts');
          const code = 'export class MyComponentComponent {}\n<object-to-table></object-to-table>';
          const result1 = callTransform(plugin, code, file) as { code: string };
          expect(result1.code).toContain('px-lib-object-to-table-v1-0-0');

          // Remove only package.json to simulate library removal without
          // destroying a real installed dependency's other files.
          fs.rmSync(mockPkgPath, { force: true });
          callBuildStart(plugin, { warn: warnFn });

          // Library component should no longer be rewritten
          const result2 = callTransform(plugin, code, file) as { code: string };
          expect(result2.code).toContain('<object-to-table></object-to-table>');
          expect(result2.code).not.toContain('px-lib-object-to-table');
        });
      } finally {
        // Restore original state
        if (!hadMockLib) {
          fs.rmSync(mockLibDir, { recursive: true, force: true });
        } else if (hadPkgJson && originalPkgJson !== undefined) {
          fs.writeFileSync(mockPkgPath, originalPkgJson);
        } else if (!hadPkgJson) {
          fs.rmSync(mockPkgPath, { force: true });
        }
      }
    });
  });

  describe('componentsDir — filesystem scanning', () => {
    it('builds the component map from files on disk', () => {
      withTempDir((dir) => {
        const src = "export class KeyValueComponent {}\nconst name = 'key-value';";
        writeFile(dir, 'key-value.ts', src);
        const plugin = transformComponentNames({ componentsDir: dir });
        callBuildStart(plugin);
        const result = callTransform(plugin, src, path.join(dir, 'key-value.ts')) as {
          code: string;
        };
        expect(result.code).toContain('px-int-');
        expect(result.code).toContain('-key-value-');
      });
    });

    it('discovers components in subdirectories using -- as separator', () => {
      withTempDir((dir) => {
        const src = "export class ModalsSaveModalComponent {}\nconst name = 'modals--save-modal';";
        writeFile(dir, 'modals/save-modal.ts', src);
        const plugin = transformComponentNames({ componentsDir: dir });
        callBuildStart(plugin);
        const result = callTransform(plugin, src, path.join(dir, 'modals', 'save-modal.ts')) as {
          code: string;
        };
        expect(result.code).toContain('-modals--save-modal-');
      });
    });

    it('accepts single-word filenames without a hyphen', () => {
      withTempDir((dir) => {
        writeFile(dir, 'utils.ts', 'export class UtilsComponent {}');
        const plugin = transformComponentNames({ componentsDir: dir });
        expect(() => callBuildStart(plugin)).not.toThrow();
      });
    });

    it('throws a clear error for a filename starting with a digit', () => {
      withTempDir((dir) => {
        writeFile(dir, '2fa-widget.ts', 'export class TwoFaWidgetComponent {}');
        const plugin = transformComponentNames({ componentsDir: dir });
        expect(() => callBuildStart(plugin)).toThrowError(/Invalid component file name/);
        expect(() => callBuildStart(plugin)).toThrowError(/"2fa-widget"/);
        expect(() => callBuildStart(plugin)).toThrowError(/Rename the file/);
      });
    });

    it('throws a clear error for a reserved custom element name', () => {
      withTempDir((dir) => {
        writeFile(dir, 'color-profile.ts', 'export class ColorProfileComponent {}');
        const plugin = transformComponentNames({ componentsDir: dir });
        expect(() => callBuildStart(plugin)).toThrowError(/Invalid component file name/);
        expect(() => callBuildStart(plugin)).toThrowError(/"color-profile"/);
      });
    });

    it('does nothing when componentsDir does not exist', () => {
      const plugin = transformComponentNames({ componentsDir: '/nonexistent/path' });
      expect(() => callBuildStart(plugin)).not.toThrow();
    });
  });

  // ─── class export verification ─────────────────────────────────────────────

  describe('class export verification', () => {
    it('accepts a file with a matching class declaration', () => {
      withTempDir((dir) => {
        const file = writeFile(
          dir,
          'key-value.ts',
          'export class KeyValueComponent extends LitElement {}',
        );
        const plugin = transformComponentNames({ componentsDir: dir });
        callBuildStart(plugin);
        expect(() =>
          callTransform(plugin, 'export class KeyValueComponent extends LitElement {}', file),
        ).not.toThrow();
      });
    });

    it('accepts a file with an export { ClassName } re-export', () => {
      withTempDir((dir) => {
        const file = writeFile(
          dir,
          'key-value.ts',
          'class KeyValueComponent {}\nexport { KeyValueComponent };',
        );
        const plugin = transformComponentNames({ componentsDir: dir });
        callBuildStart(plugin);
        expect(() =>
          callTransform(plugin, 'class KeyValueComponent {}\nexport { KeyValueComponent };', file),
        ).not.toThrow();
      });
    });

    it('throws a clear error when the expected class export is missing', () => {
      withTempDir((dir) => {
        const file = writeFile(dir, 'key-value.ts', 'export class WrongName extends LitElement {}');
        const plugin = transformComponentNames({ componentsDir: dir });
        callBuildStart(plugin);
        expect(() =>
          callTransform(plugin, 'export class WrongName extends LitElement {}', file),
        ).toThrowError(/Missing expected class export/);
        expect(() =>
          callTransform(plugin, 'export class WrongName extends LitElement {}', file),
        ).toThrowError(/"KeyValueComponent"/);
        expect(() =>
          callTransform(plugin, 'export class WrongName extends LitElement {}', file),
        ).toThrowError(/rename the class/i);
      });
    });
  });

  // ─── registration injection ────────────────────────────────────────────────

  describe('registration injection', () => {
    it('injects a customElements.define block', () => {
      withTempDir((dir) => {
        const file = writeFile(dir, 'key-value.ts', 'export class KeyValueComponent {}');
        const plugin = transformComponentNames({ componentsDir: dir });
        callBuildStart(plugin);
        const result = callTransform(plugin, 'export class KeyValueComponent {}', file) as {
          code: string;
        };
        expect(result.code).toContain("customElements.get('px-int-");
        expect(result.code).toContain('customElements.define(');
        expect(result.code).toContain('KeyValueComponent as unknown as CustomElementConstructor');
      });
    });

    it('injects the unique tag name into the registration block', () => {
      withTempDir((dir) => {
        const file = writeFile(dir, 'key-value.ts', 'export class KeyValueComponent {}');
        const plugin = transformComponentNames({ componentsDir: dir });
        callBuildStart(plugin);
        const result = callTransform(plugin, 'export class KeyValueComponent {}', file) as {
          code: string;
        };
        expect(result.code).toMatch(
          /customElements\.get\('px-int-[a-z0-9]+-icl-key-value-v\d+-\d+-\d+'\)/,
        );
      });
    });

    it('does not inject an external library import', () => {
      withTempDir((dir) => {
        const file = writeFile(dir, 'key-value.ts', 'export class KeyValueComponent {}');
        const plugin = transformComponentNames({ componentsDir: dir });
        callBuildStart(plugin);
        const result = callTransform(plugin, 'export class KeyValueComponent {}', file) as {
          code: string;
        };
        expect(result.code).not.toContain('import {');
        expect(result.code).not.toContain("from 'integration-component-library'");
      });
    });

    it('does not re-inject the registration block on repeated transforms', () => {
      withTempDir((dir) => {
        const src = 'export class KeyValueComponent {}';
        const file = writeFile(dir, 'key-value.ts', src);
        const plugin = transformComponentNames({ componentsDir: dir });
        callBuildStart(plugin);
        const first = (callTransform(plugin, src, file) as { code: string }).code;
        const second = callTransform(plugin, first, file);
        expect((first.match(/customElements\.define\(/g) ?? []).length).toBe(1);
        expect(second).toBeNull();
      });
    });
  });

  // ─── autoImport option ─────────────────────────────────────────────────────

  describe('autoImport option', () => {
    it('resolves VIRTUAL_COMPONENTS_ID when autoImport is true (default)', () => {
      withTempDir((dir) => {
        const plugin = transformComponentNames({ componentsDir: dir });
        expect(callResolveId(plugin, VIRTUAL_COMPONENTS_ID)).toBe('\0virtual:icl-components');
      });
    });

    it('does not resolve VIRTUAL_COMPONENTS_ID when autoImport is false', () => {
      withTempDir((dir) => {
        const plugin = transformComponentNames({ componentsDir: dir, autoImport: false });
        expect(callResolveId(plugin, VIRTUAL_COMPONENTS_ID)).toBeNull();
      });
    });

    it('still injects registration when autoImport is false', () => {
      withTempDir((dir) => {
        const file = writeFile(dir, 'key-value.ts', 'export class KeyValueComponent {}');
        const plugin = transformComponentNames({ componentsDir: dir, autoImport: false });
        callBuildStart(plugin);
        const result = callTransform(plugin, 'export class KeyValueComponent {}', file) as {
          code: string;
        };
        expect(result.code).toContain('customElements.define(');
      });
    });

    it('still rewrites tags when autoImport is false', () => {
      withTempDir((dir) => {
        const src = "export class KeyValueComponent {}\nconst n = 'key-value';";
        const file = writeFile(dir, 'key-value.ts', src);
        const plugin = transformComponentNames({ componentsDir: dir, autoImport: false });
        callBuildStart(plugin);
        const result = callTransform(plugin, src, file) as { code: string };
        expect(result.code).toContain('px-int-');
      });
    });
  });

  // ─── per-build hash uniqueness ─────────────────────────────────────────────

  describe('per-build hash uniqueness', () => {
    it('generates a different unique name on each plugin instantiation', () => {
      withTempDir((dir) => {
        writeFile(dir, 'key-value.ts', 'export class KeyValueComponent {}');
        const pluginA = transformComponentNames({ componentsDir: dir });
        const pluginB = transformComponentNames({ componentsDir: dir });
        callBuildStart(pluginA);
        callBuildStart(pluginB);
        const a = (
          callTransform(
            pluginA,
            'export class KeyValueComponent {}',
            path.join(dir, 'key-value.ts'),
          ) as { code: string }
        ).code;
        const b = (
          callTransform(
            pluginB,
            'export class KeyValueComponent {}',
            path.join(dir, 'key-value.ts'),
          ) as { code: string }
        ).code;
        expect(a).not.toBe(b);
      });
    });
  });

  // ─── acronym resolution ────────────────────────────────────────────────────

  describe('acronym resolution', () => {
    let configDir: string;
    let configFile: string;
    let hadDir: boolean;

    beforeEach(() => {
      configDir = path.resolve(process.cwd(), 'config');
      configFile = path.join(configDir, 'config.json');
      hadDir = fs.existsSync(configDir);
    });

    afterEach(() => {
      if (fs.existsSync(configFile)) fs.unlinkSync(configFile);
      if (!hadDir && fs.existsSync(configDir)) fs.rmdirSync(configDir);
    });

    it('uses "icl" as the default acronym when config/config.json is absent', () => {
      withTempDir((dir) => {
        const file = writeFile(dir, 'key-value.ts', 'export class KeyValueComponent {}');
        const plugin = transformComponentNames({ componentsDir: dir });
        callBuildStart(plugin);
        const result = callTransform(plugin, 'export class KeyValueComponent {}', file) as {
          code: string;
        };
        expect(result.code).toContain('-icl-');
      });
    });

    it('uses the project acronym from config/config.json', () => {
      if (!hadDir) fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(configFile, JSON.stringify({ acronym: 'TST' }));
      withTempDir((dir) => {
        const file = writeFile(dir, 'key-value.ts', 'export class KeyValueComponent {}');
        const plugin = transformComponentNames({ componentsDir: dir });
        callBuildStart(plugin);
        const result = callTransform(plugin, 'export class KeyValueComponent {}', file) as {
          code: string;
        };
        expect(result.code).toContain('-tst-');
      });
    });

    it('lowercases an uppercase acronym', () => {
      if (!hadDir) fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(configFile, JSON.stringify({ acronym: 'ALLCAPS' }));
      withTempDir((dir) => {
        const file = writeFile(dir, 'key-value.ts', 'export class KeyValueComponent {}');
        const plugin = transformComponentNames({ componentsDir: dir });
        callBuildStart(plugin);
        const result = callTransform(plugin, 'export class KeyValueComponent {}', file) as {
          code: string;
        };
        expect(result.code).toContain('-allcaps-');
        expect(result.code).not.toContain('ALLCAPS');
      });
    });
  });

  // ─── generated name casing ─────────────────────────────────────────────────

  describe('generated component name casing', () => {
    it('the full generated unique tag name is entirely lowercase', () => {
      withTempDir((dir) => {
        const src = "export class KeyValueComponent {}\nconst n = 'key-value';";
        const file = writeFile(dir, 'key-value.ts', src);
        const plugin = transformComponentNames({ componentsDir: dir });
        callBuildStart(plugin);
        const result = callTransform(plugin, src, file) as { code: string };
        const match = result.code.match(/'(px-int-[^']+)'/);
        expect(match).not.toBeNull();
        expect(match![1]).toBe(match![1].toLowerCase());
      });
    });

    it('the full generated unique tag name contains no uppercase letters', () => {
      withTempDir((dir) => {
        const src = "export class KeyValueComponent {}\nconst n = 'key-value';";
        const file = writeFile(dir, 'key-value.ts', src);
        const plugin = transformComponentNames({ componentsDir: dir });
        callBuildStart(plugin);
        const result = callTransform(plugin, src, file) as { code: string };
        const match = result.code.match(/'(px-int-[^']+)'/);
        expect(match).not.toBeNull();
        expect(match![1]).toMatch(/^[^A-Z]+$/);
      });
    });
  });

  // ─── VIRTUAL_COMPONENTS_ID constant ───────────────────────────────────────

  describe('VIRTUAL_COMPONENTS_ID', () => {
    it('is exported with the correct value', () => {
      expect(VIRTUAL_COMPONENTS_ID).toBe('virtual:icl-components');
    });
  });

  // ─── virtual module: resolveId ─────────────────────────────────────────────

  describe('virtual module — resolveId', () => {
    it('resolves the virtual module id to the internal resolved id', () => {
      withTempDir((dir) => {
        const plugin = transformComponentNames({ componentsDir: dir });
        expect(callResolveId(plugin, VIRTUAL_COMPONENTS_ID)).toBe('\0virtual:icl-components');
      });
    });

    it('resolves an absolute path ending with the virtual module id (Vite 7+)', () => {
      withTempDir((dir) => {
        const plugin = transformComponentNames({ componentsDir: dir });
        expect(callResolveId(plugin, '/project/root/' + VIRTUAL_COMPONENTS_ID)).toBe(
          '\0virtual:icl-components',
        );
      });
    });

    it('returns null for any other module id', () => {
      withTempDir((dir) => {
        const plugin = transformComponentNames({ componentsDir: dir });
        expect(callResolveId(plugin, 'some-other-module')).toBeNull();
        expect(callResolveId(plugin, './key-value.js')).toBeNull();
      });
    });
  });

  // ─── virtual module: load ──────────────────────────────────────────────────

  describe('virtual module — load', () => {
    it('returns null for non-virtual module ids', () => {
      withTempDir((dir) => {
        const plugin = transformComponentNames({ componentsDir: dir });
        expect(callLoad(plugin, path.join(dir, 'key-value.ts'))).toBeNull();
      });
    });

    it('generates a side-effect import for each discovered component file', () => {
      withTempDir((dir) => {
        writeFile(dir, 'key-value.ts', 'export class KeyValueComponent {}');
        writeFile(dir, 'save-modal.ts', 'export class SaveModalComponent {}');
        const plugin = transformComponentNames({ componentsDir: dir });
        callBuildStart(plugin);
        const result = callLoad(plugin, '\0virtual:icl-components') as { code: string };
        expect(result.code).toContain("import '");
        expect(result.code).toContain('key-value.ts');
        expect(result.code).toContain('save-modal.ts');
      });
    });

    it('uses forward slashes in import paths on all platforms', () => {
      withTempDir((dir) => {
        writeFile(dir, 'key-value.ts', 'export class KeyValueComponent {}');
        const plugin = transformComponentNames({ componentsDir: dir });
        callBuildStart(plugin);
        const result = callLoad(plugin, '\0virtual:icl-components') as { code: string };
        expect(result.code).not.toContain('\\');
      });
    });

    it('includes export {} so Rollup treats it as an ES module', () => {
      withTempDir((dir) => {
        writeFile(dir, 'key-value.ts', 'export class KeyValueComponent {}');
        const plugin = transformComponentNames({ componentsDir: dir });
        callBuildStart(plugin);
        const result = callLoad(plugin, '\0virtual:icl-components') as { code: string };
        expect(result.code).toContain('export {}');
      });
    });

    it('returns a null source map', () => {
      withTempDir((dir) => {
        writeFile(dir, 'key-value.ts', 'export class KeyValueComponent {}');
        const plugin = transformComponentNames({ componentsDir: dir });
        callBuildStart(plugin);
        const result = callLoad(plugin, '\0virtual:icl-components') as { map: unknown };
        expect(result.map).toBeNull();
      });
    });

    it('produces an empty export when the directory has no .ts files', () => {
      withTempDir((dir) => {
        const plugin = transformComponentNames({ componentsDir: dir });
        callBuildStart(plugin);
        const result = callLoad(plugin, '\0virtual:icl-components') as { code: string };
        expect(result.code.trim()).toBe('export {};');
      });
    });

    it('returns null from load when autoImport is false', () => {
      withTempDir((dir) => {
        const plugin = transformComponentNames({ componentsDir: dir, autoImport: false });
        callBuildStart(plugin);
        // resolveId returns null so RESOLVED_VIRTUAL_ID is never requested,
        // but if somehow called directly the load hook should also return null
        expect(callLoad(plugin, '\0virtual:icl-components')).toBeNull();
      });
    });
  });

  // ─── additionalEntry option ────────────────────────────────────────────────

  describe('additionalEntry option', () => {
    it('does not throw when additionalEntry exists', () => {
      withTempDir((dir) => {
        const entry = writeFile(dir, 'index.ts', 'export const version = "1.0.0";');
        const plugin = transformComponentNames({ componentsDir: dir, additionalEntry: entry });
        expect(() => callBuildStart(plugin)).not.toThrow();
      });
    });

    it('throws a clear error when additionalEntry path does not exist', () => {
      withTempDir((dir) => {
        const plugin = transformComponentNames({
          componentsDir: dir,
          additionalEntry: '/nonexistent/path/index.ts',
        });
        expect(() => callBuildStart(plugin)).toThrowError(/additionalEntry file not found/);
        expect(() => callBuildStart(plugin)).toThrowError('/nonexistent/path/index.ts');
      });
    });

    it('throws before scanning components when additionalEntry is missing', () => {
      withTempDir((dir) => {
        writeFile(dir, 'key-value.ts', 'export class KeyValueComponent {}');
        const plugin = transformComponentNames({
          componentsDir: dir,
          additionalEntry: '/nonexistent/index.ts',
        });
        expect(() => callBuildStart(plugin)).toThrowError(/additionalEntry file not found/);
      });
    });
  });

  // ─── predefined components (config/config.json components array) ──────────

  describe('predefined components from config/config.json webComponents', () => {
    let configDir: string;
    let configFile: string;
    let hadDir: boolean;

    beforeEach(() => {
      configDir = path.resolve(process.cwd(), 'config');
      configFile = path.join(configDir, 'config.json');
      hadDir = fs.existsSync(configDir);
    });

    afterEach(() => {
      if (fs.existsSync(configFile)) fs.unlinkSync(configFile);
      if (!hadDir && fs.existsSync(configDir)) fs.rmdirSync(configDir);
    });

    it('uses the pre-assigned element name from config for a matching component type', () => {
      if (!hadDir) fs.mkdirSync(configDir, { recursive: true });
      const predefinedName = 'px-int-9b69kxiww6yoxs74n4auduspb-echo-wc-summary-v5-0-0';
      fs.writeFileSync(
        configFile,
        JSON.stringify({
          acronym: 'echo-wc',
          webComponents: { components: [{ type: 'summary', element: predefinedName }] },
        }),
      );
      withTempDir((dir) => {
        const src = 'export class SummaryComponent {}';
        const file = writeFile(dir, 'summary.ts', src);
        const plugin = transformComponentNames({ componentsDir: dir });
        callBuildStart(plugin);
        const result = callTransform(plugin, src, file) as { code: string };
        expect(result.code).toContain(`customElements.get('${predefinedName}')`);
        expect(result.code).toContain(`customElements.define('${predefinedName}'`);
      });
    });

    it('does not use a generated hash-based name when a predefined name is supplied', () => {
      if (!hadDir) fs.mkdirSync(configDir, { recursive: true });
      const predefinedName = 'px-int-9b69kxiww6yoxs74n4auduspb-echo-wc-summary-v5-0-0';
      fs.writeFileSync(
        configFile,
        JSON.stringify({
          webComponents: { components: [{ type: 'summary', element: predefinedName }] },
        }),
      );
      withTempDir((dir) => {
        const src = 'export class SummaryComponent {}';
        const file = writeFile(dir, 'summary.ts', src);
        const plugin = transformComponentNames({ componentsDir: dir });
        callBuildStart(plugin);
        const result = callTransform(plugin, src, file) as { code: string };
        expect(result.code).not.toMatch(/customElements\.get\('px-int-(?!9b69k)/);
      });
    });

    it('handles multiple predefined components independently', () => {
      if (!hadDir) fs.mkdirSync(configDir, { recursive: true });
      const summaryName = 'px-int-9b69kxiww6yoxs74n4auduspb-echo-wc-summary-v5-0-0';
      const detailsName = 'px-int-9b69kxiww6yoxs74n4auduspb-echo-wc-details-v5-0-0';
      fs.writeFileSync(
        configFile,
        JSON.stringify({
          webComponents: {
            components: [
              { type: 'summary', element: summaryName },
              { type: 'details', element: detailsName },
            ],
          },
        }),
      );
      withTempDir((dir) => {
        const summaryFile = writeFile(dir, 'summary.ts', 'export class SummaryComponent {}');
        const detailsFile = writeFile(dir, 'details.ts', 'export class DetailsComponent {}');
        const plugin = transformComponentNames({ componentsDir: dir });
        callBuildStart(plugin);
        expect(
          (
            callTransform(plugin, 'export class SummaryComponent {}', summaryFile) as {
              code: string;
            }
          ).code,
        ).toContain(`customElements.get('${summaryName}')`);
        expect(
          (
            callTransform(plugin, 'export class DetailsComponent {}', detailsFile) as {
              code: string;
            }
          ).code,
        ).toContain(`customElements.get('${detailsName}')`);
      });
    });

    it('rewrites tags using the predefined name', () => {
      if (!hadDir) fs.mkdirSync(configDir, { recursive: true });
      const predefinedName = 'px-int-9b69kxiww6yoxs74n4auduspb-echo-wc-summary-v5-0-0';
      fs.writeFileSync(
        configFile,
        JSON.stringify({
          webComponents: { components: [{ type: 'summary', element: predefinedName }] },
        }),
      );
      withTempDir((dir) => {
        const src =
          'export class SummaryComponent {}\nconst t = \'<summary class="main"></summary>\';';
        writeFile(dir, 'summary.ts', src);
        const plugin = transformComponentNames({ componentsDir: dir });
        callBuildStart(plugin);
        const result = callTransform(plugin, src, path.join(dir, 'summary.ts')) as { code: string };
        expect(result.code).toContain(`<${predefinedName}`);
        expect(result.code).toContain(`</${predefinedName}>`);
      });
    });

    it('still performs class export verification for predefined components', () => {
      if (!hadDir) fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(
        configFile,
        JSON.stringify({
          webComponents: { components: [{ type: 'summary', element: 'px-int-fixed-summary' }] },
        }),
      );
      withTempDir((dir) => {
        const file = writeFile(dir, 'summary.ts', 'export class WrongName {}');
        const plugin = transformComponentNames({ componentsDir: dir });
        callBuildStart(plugin);
        expect(() => callTransform(plugin, 'export class WrongName {}', file)).toThrowError(
          /Missing expected class export/,
        );
        expect(() => callTransform(plugin, 'export class WrongName {}', file)).toThrowError(
          /"SummaryComponent"/,
        );
      });
    });

    it('ignores components array entries with missing or empty type/element fields', () => {
      if (!hadDir) fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(
        configFile,
        JSON.stringify({
          webComponents: {
            components: [
              { type: '', element: 'px-int-something' },
              { type: 'summary' },
              { element: 'px-int-something' },
              {},
            ],
          },
        }),
      );
      withTempDir((dir) => {
        const src = 'export class SummaryComponent {}';
        const file = writeFile(dir, 'summary.ts', src);
        const plugin = transformComponentNames({ componentsDir: dir });
        callBuildStart(plugin);
        const result = callTransform(plugin, src, file) as { code: string };
        expect(result.code).toMatch(/customElements\.get\('px-int-[a-z0-9]+-icl-summary-/);
      });
    });

    it('falls back gracefully when config/config.json has no components array', () => {
      if (!hadDir) fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(configFile, JSON.stringify({ acronym: 'test' }));
      withTempDir((dir) => {
        const src = 'export class SummaryComponent {}';
        const file = writeFile(dir, 'summary.ts', src);
        const plugin = transformComponentNames({ componentsDir: dir });
        expect(() => callBuildStart(plugin)).not.toThrow();
        const result = callTransform(plugin, src, file) as { code: string };
        expect(result.code).toMatch(/customElements\.get\('px-int-[a-z0-9]+-test-summary-/);
      });
    });
  });
});
