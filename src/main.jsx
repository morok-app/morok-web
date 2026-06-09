import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './styles/global.css';
import './styles/native.css';
import { initNative } from './native_bootstrap.js';

// Kick off native init (status bar style, safe-area flag). No-op on web —
// we can fire-and-forget; the React render below doesn't depend on it.
initNative();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
