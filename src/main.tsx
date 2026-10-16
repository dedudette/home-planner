import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ScopedApp } from './account/ScopedApp';
import { ErrorBoundary } from './ui/ErrorBoundary';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary scope="app">
      <ScopedApp />
    </ErrorBoundary>
  </StrictMode>,
);
