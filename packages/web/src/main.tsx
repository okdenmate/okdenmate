import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { restoreProfile } from './design';
import './styles.css';

// Stamp the profile before React mounts, so nothing paints in the wrong palette.
restoreProfile();

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
