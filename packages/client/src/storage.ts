/**
 * Persistence. In the browser this is localStorage; inside the Steam build the
 * Electron preload exposes the same three calls backed by a file in the user
 * data directory, so save data survives a reinstall of the web assets.
 */

interface HostBridge {
  readSave?(key: string): string | null;
  writeSave?(key: string, value: string): void;
  clearSave?(key: string): void;
}

declare global {
  interface Window {
    haulmates?: HostBridge & Record<string, unknown>;
  }
}

const PREFIX = 'haulmates.';

export function load<T>(key: string, fallback: T): T {
  try {
    const bridge = window.haulmates;
    const raw = bridge?.readSave ? bridge.readSave(key) : localStorage.getItem(PREFIX + key);
    if (raw === null || raw === undefined) return fallback;
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== typeof fallback) return fallback;
    // Merge so that a save written by an older build still gains new fields.
    if (typeof fallback === 'object' && !Array.isArray(fallback)) {
      return { ...(fallback as object), ...(parsed as object) } as T;
    }
    return parsed as T;
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown): void {
  try {
    const raw = JSON.stringify(value);
    const bridge = window.haulmates;
    if (bridge?.writeSave) bridge.writeSave(key, raw);
    else localStorage.setItem(PREFIX + key, raw);
  } catch {
    /* Saving is best-effort; never let it break a run. */
  }
}

export function isDesktop(): boolean {
  return typeof window !== 'undefined' && Boolean(window.haulmates);
}
