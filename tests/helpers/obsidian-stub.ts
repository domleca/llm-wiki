/**
 * Minimal runtime stub for the `obsidian` module.
 *
 * The real `obsidian` package only ships type definitions (`obsidian.d.ts`)
 * with an empty `main`, so importing it at test runtime fails. This stub is
 * aliased in `vitest.config.ts` so that source files which `import { Setting }
 * from "obsidian"` can be loaded by vitest. Tests that exercise pure helpers
 * never actually instantiate these stubs — they only need the import to
 * resolve.
 */

class Setting {
  constructor(_containerEl: unknown) {}
  setName(_name: string): this {
    return this;
  }
  setDesc(_desc: string): this {
    return this;
  }
  addText(_cb: (t: unknown) => unknown): this {
    return this;
  }
  addToggle(_cb: (t: unknown) => unknown): this {
    return this;
  }
  addButton(_cb: (b: unknown) => unknown): this {
    return this;
  }
}

class Component {
  load(): void {}
  unload(): void {}
}

class Modal {
  constructor(_app: unknown) {}
  open(): void {}
  close(): void {}
}

class PluginSettingTab {
  constructor(_app: unknown, _plugin: unknown) {}
}

class Plugin {}

class Notice {
  constructor(_msg: string) {}
}

class TFile {}

class MarkdownRenderer {
  static async render(
    _app: unknown,
    _md: string,
    _el: unknown,
    _path: string,
    _component: unknown,
  ): Promise<void> {}
}

export {
  Setting,
  Component,
  Modal,
  PluginSettingTab,
  Plugin,
  Notice,
  TFile,
  MarkdownRenderer,
};
