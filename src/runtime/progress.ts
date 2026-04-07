/**
 * Typed event emitter for extraction progress. The queue publishes
 * events; the status-bar UI and the settings panel subscribe. Lives
 * here (runtime/) rather than in ui/ or extract/ because it is the
 * handoff point between them.
 */

export interface ProgressEventMap {
  "batch-started": { total: number };
  "file-started": { path: string; index: number; total: number };
  "file-completed": {
    path: string;
    index: number;
    total: number;
    entitiesAdded: number;
    conceptsAdded: number;
  };
  "file-failed": {
    path: string;
    index: number;
    total: number;
    reason: string;
  };
  "file-skipped": { path: string; index: number; total: number };
  checkpoint: { processed: number; total: number };
  "batch-completed": {
    processed: number;
    succeeded: number;
    failed: number;
    skipped: number;
    total: number;
    elapsedMs: number;
  };
  "batch-cancelled": { processed: number; total: number };
  "batch-errored": { message: string };
}

export type ProgressEventName = keyof ProgressEventMap;
export type ProgressEventHandler<K extends ProgressEventName> = (
  data: ProgressEventMap[K],
) => void;

export class ProgressEmitter {
  private readonly target = new EventTarget();
  /** Wrapped handler cache so off() can remove listeners by original ref. */
  private readonly wrapped = new WeakMap<
    ProgressEventHandler<ProgressEventName>,
    EventListener
  >();

  on<K extends ProgressEventName>(
    event: K,
    handler: ProgressEventHandler<K>,
  ): void {
    const wrapped = (ev: Event): void => {
      const detail = (ev as CustomEvent<ProgressEventMap[K]>).detail;
      handler(detail);
    };
    this.wrapped.set(
      handler as ProgressEventHandler<ProgressEventName>,
      wrapped,
    );
    this.target.addEventListener(event, wrapped);
  }

  off<K extends ProgressEventName>(
    event: K,
    handler: ProgressEventHandler<K>,
  ): void {
    const wrapped = this.wrapped.get(
      handler as ProgressEventHandler<ProgressEventName>,
    );
    if (wrapped) this.target.removeEventListener(event, wrapped);
  }

  emit<K extends ProgressEventName>(
    event: K,
    data: ProgressEventMap[K],
  ): void {
    this.target.dispatchEvent(new CustomEvent(event, { detail: data }));
  }
}
