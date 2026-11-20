import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { consumeSsoTokenFromUrl } from './utils/sso';
import { initializeLocale } from './i18n';

// 统一登录回跳：在 React 挂载前把 fragment 里的 token 写入 localStorage，
// AuthProvider 的初始态才能读到它、直接进 checking 校验（见 utils/sso.ts）。
consumeSsoTokenFromUrl();
initializeLocale();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
