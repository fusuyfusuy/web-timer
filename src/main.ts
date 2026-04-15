// main.ts — application entry point. Boots the app on DOMContentLoaded.
//
// CONTRACT (application bootstrap):
//   - This file is the Vite entry point (referenced in index.html).
//   - Its sole responsibility is to import initApp and call it when the DOM is ready.
//   - All state management, routing to service functions, and rendering live in src/ui/app.ts.
//   - No side-effects beyond the DOMContentLoaded listener registration.

import { initApp } from './ui/app';

/**
 * Bootstrap
 *
 * CONTRACT:
 *   Transition: triggers initApp which handles all boot transitions
 *   Input: none
 *   Output: void
 *   Logic:
 *     1. Listen for 'DOMContentLoaded' on document.
 *     2. When fired, call initApp().
 *     3. If 'DOMContentLoaded' already fired (readyState === 'complete' or 'interactive'), call initApp() immediately.
 */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
