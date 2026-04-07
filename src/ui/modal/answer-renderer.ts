export interface RenderTarget {
  setMarkdown(md: string): void;
}

export interface AnswerRendererOptions {
  debounceMs: number;
}

export class AnswerRenderer {
  private buffer = "";
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly target: RenderTarget,
    private readonly opts: AnswerRendererOptions,
  ) {}

  append(chunk: string): void {
    this.buffer += chunk;
    if (this.opts.debounceMs <= 0) {
      this.flush();
      return;
    }
    if (this.timer !== null) return;
    this.timer = setTimeout(() => this.flush(), this.opts.debounceMs);
  }

  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.target.setMarkdown(this.buffer);
  }

  reset(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.buffer = "";
  }
}
