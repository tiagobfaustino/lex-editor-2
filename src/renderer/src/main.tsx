import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app';
import './styles.css';

const rootElement = document.querySelector<HTMLElement>('#app');

if (!rootElement) {
  throw new Error('A raiz da interface não foi encontrada.');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
