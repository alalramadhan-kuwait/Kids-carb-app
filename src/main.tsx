import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import '@fontsource/rubik/400.css';
import '@fontsource/rubik/500.css';
import '@fontsource/rubik/600.css';
import '@fontsource/rubik/700.css';
import './index.css';
import { registerSw } from './lib/push';
import { applyLang, useLang } from './i18n';
import { keepFixedBarsInPlace } from './lib/iosViewport';

applyLang();
// iOS Safari ignores user-scalable=no; block its pinch gesture directly
document.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false });
keepFixedBarsInPlace();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <Root />
    </HashRouter>
  </StrictMode>,
);

/** Switching language re-renders the whole app in the new language and direction. */
function Root() { const l = useLang(); return <App key={l} />; }

if (import.meta.env.PROD) registerSw();
