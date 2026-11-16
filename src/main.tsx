import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

declare global {
  interface Window {
    __brokeifyDeferredPwaPrompt?: any;
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    window.__brokeifyDeferredPwaPrompt = e;
    window.dispatchEvent(new CustomEvent('brokeify-pwa-prompt-ready'));
  });

  window.addEventListener('appinstalled', () => {
    window.__brokeifyDeferredPwaPrompt = null;
    window.dispatchEvent(new CustomEvent('brokeify-pwa-installed'));
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .catch(() => {});
    });
  }
}

createRoot(document.getElementById('root')!).render(<App />);
