import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';

import App from './App';
import ErrorBoundary from './components/ErrorBoundary';

import reportWebVitals from './reportWebVitals';

// Global safety: catch uncaught errors and promise rejections to avoid a white
// screen when browser blocks access to storage (Tracking Prevention) or other
// runtime errors occur.
if (typeof window !== 'undefined') {
  window.addEventListener('error', (ev) => {
    // prevent default to avoid noisy error dialogs in some browsers
    // eslint-disable-next-line no-console
    console.error('Window error captured:', ev.error || ev.message);
  });
  window.addEventListener('unhandledrejection', (ev) => {
    // eslint-disable-next-line no-console
    console.error('Unhandled promise rejection:', ev.reason);
  });
}

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);

root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);

reportWebVitals();
