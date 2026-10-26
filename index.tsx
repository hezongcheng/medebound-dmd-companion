import { LanguageProvider } from './i18n/LanguageProvider';
// Polyfill for Object.hasOwn (ES2022) - 兼容旧浏览器
if (!Object.hasOwn) {
  Object.hasOwn = function(obj: object, prop: PropertyKey): boolean {
    return Object.prototype.hasOwnProperty.call(obj, prop);
  };
}

import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';

const CHUNK_RECOVERY_KEY = 'dmd:chunk-recovery-once';

const isChunkLoadFailure = (message: string): boolean => {
  if (!message) return false;
  return (
    message.includes('ChunkLoadError') ||
    message.includes('Loading chunk') ||
    message.includes('Failed to fetch dynamically imported module')
  );
};

const recoverFromChunkLoadFailure = () => {
  try {
    if (sessionStorage.getItem(CHUNK_RECOVERY_KEY) === '1') return;
    sessionStorage.setItem(CHUNK_RECOVERY_KEY, '1');
    window.location.reload();
  } catch {
    // 忽略存储异常，兜底直接刷新一次。
    window.location.reload();
  }
};

window.addEventListener('error', (event) => {
  const msg = String((event as ErrorEvent).message || '');
  if (isChunkLoadFailure(msg)) {
    recoverFromChunkLoadFailure();
  }
});

window.addEventListener('unhandledrejection', (event) => {
  const reason = (event as PromiseRejectionEvent).reason;
  const msg = String(
    (reason && typeof reason === 'object' && 'message' in reason && (reason as { message?: string }).message) ||
    reason ||
    ''
  );
  if (isChunkLoadFailure(msg)) {
    recoverFromChunkLoadFailure();
  }
});

window.addEventListener('load', () => {
  try {
    sessionStorage.removeItem(CHUNK_RECOVERY_KEY);
  } catch {
    // 忽略浏览器存储异常
  }
});

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <LanguageProvider><HashRouter>
      <App />
    </HashRouter></LanguageProvider>
  </React.StrictMode>
);
