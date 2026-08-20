import './styles.css';
import { App } from './app.js';

/**
 * Show the reason the game did not start.
 *
 * A game that fails to boot renders as a black rectangle, which tells whoever
 * is looking at it precisely nothing — and when it is embedded in someone
 * else's page, there is no console to go and read. Anything that stops the
 * boot gets painted into the page instead, in plain words, along with enough
 * detail to act on.
 */
function reportBootFailure(error: unknown): void {
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const panel = document.createElement('div');
  panel.setAttribute('role', 'alert');
  panel.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:9999',
    'display:flex',
    'flex-direction:column',
    'gap:14px',
    'align-items:center',
    'justify-content:center',
    'padding:32px',
    'text-align:center',
    'background:#05070f',
    'color:#e8ecf7',
    'font:16px/1.5 ui-sans-serif,system-ui,"Segoe UI",Roboto,Arial,sans-serif',
  ].join(';');

  const title = document.createElement('div');
  title.textContent = 'HAULMATES could not start.';
  title.style.cssText = 'font-size:24px;font-weight:800;letter-spacing:-0.01em';

  const why = document.createElement('pre');
  why.textContent = detail;
  why.style.cssText = [
    'margin:0',
    'max-width:min(680px,90vw)',
    'overflow-x:auto',
    'white-space:pre-wrap',
    'word-break:break-word',
    'padding:14px 16px',
    'border-radius:10px',
    'background:#131829',
    'border:2px solid #2c3552',
    'color:#ffb03a',
    'font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace',
    'text-align:left',
  ].join(';');

  const hint = document.createElement('div');
  hint.textContent =
    'This is a bug worth reporting. The game needs a 2D canvas and about 200 KB of ' +
    'JavaScript; nothing else, and no network at all.';
  hint.style.cssText = 'max-width:min(560px,90vw);color:#8c97b6;font-size:14px';

  panel.append(title, why, hint);
  document.body.appendChild(panel);
}

function boot(): void {
  try {
    const canvas = document.getElementById('stage') as HTMLCanvasElement | null;
    const overlay = document.getElementById('overlay');
    if (!canvas || !overlay) throw new Error('the page is missing its canvas or overlay element');
    if (!canvas.getContext('2d')) throw new Error('this browser would not give the game a 2D canvas');

    const app = new App(canvas, overlay);
    app.start();

    // Handy for the end-to-end tests and for anyone poking at the game console.
    (window as unknown as { HAULMATES: App }).HAULMATES = app;
  } catch (error) {
    console.error('HAULMATES failed to boot', error);
    reportBootFailure(error);
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
