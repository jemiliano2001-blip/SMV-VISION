import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {AuthGate} from './components/AuthGate';
import { WorkOrdersProvider } from './contexts/WorkOrdersContext';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/*
      WorkOrdersProvider está dentro de AuthGate para garantizar que el listener
      onSnapshot arranque siempre con una sesión activa. La suscripción se crea
      UNA sola vez y la comparten useDashboardSummary y WorkOrdersPanel.
    */}
    <AuthGate>
      <WorkOrdersProvider>
        <App />
      </WorkOrdersProvider>
    </AuthGate>
  </StrictMode>,
);
