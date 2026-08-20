import './styles.css';
import { App } from './app.js';

function boot(): void {
  const canvas = document.getElementById('stage') as HTMLCanvasElement | null;
  const overlay = document.getElementById('overlay');
  if (!canvas || !overlay) throw new Error('HAULMATES: the page is missing its canvas.');

  const app = new App(canvas, overlay);
  app.start();

  // Handy for the end-to-end tests and for anyone poking at the game console.
  (window as unknown as { HAULMATES: App }).HAULMATES = app;
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
