import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {AuthGate} from './components/AuthGate';
import {ErrorBoundary} from './components/ErrorBoundary';
import { Toaster } from './components/ui/sonner';
import './index.css';

import { ThemeProvider } from 'next-themes';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
      <ErrorBoundary>
        <AuthGate>
          <App />
          <Toaster />
        </AuthGate>
      </ErrorBoundary>
    </ThemeProvider>
  </StrictMode>,
);
