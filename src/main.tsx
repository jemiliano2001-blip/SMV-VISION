import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {AuthGate} from './components/AuthGate';
import {ErrorBoundary} from './components/ErrorBoundary';
import {FirestoreDeadBanner} from './components/FirestoreDeadBanner';
import { Toaster } from './components/ui/sonner';
import { watchFirestoreClientHealth } from './lib/firebase/firestoreHealth';
import './index.css';

import { ThemeProvider } from 'next-themes';

watchFirestoreClientHealth();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
      <ErrorBoundary>
        <FirestoreDeadBanner />
        <AuthGate>
          <App />
          <Toaster />
        </AuthGate>
      </ErrorBoundary>
    </ThemeProvider>
  </StrictMode>,
);
