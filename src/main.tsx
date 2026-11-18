import './polyfills';
import { installDiagnostics } from './diagnostics';
import { installApiTokenFromUrl } from './api-token';
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

installDiagnostics();
// LAN-версия: токен из ссылки сервера → session-cookie до первых запросов.
installApiTokenFromUrl(window.location.search, document);

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
