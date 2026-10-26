import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { App as AntdApp, Spin } from 'antd';
import { XProvider } from '@ant-design/x';
import zhCN from 'antd/locale/zh_CN';
import zhCNX from '@ant-design/x/locale/zh_CN';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';

import { AuthProvider } from './store/auth';
import { useAuth } from './store/auth-context';
import { PermissionProvider } from './store/permission';
import LoginPage from './pages/LoginPage';
import MainLayout from './layouts/MainLayout';
import AgentChatPage from './pages/agent';

dayjs.locale('zh-cn');

const CenteredSpin: React.FC = () => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
    }}
  >
    <Spin size="large" />
  </div>
);

/**
 * 旧版管理后台的入口守卫（/app/*）。
 *
 * 注意：首页（/）是 Agent 对话界面，**不做登录校验** —— 它现在还在做界面、
 * 用本地演示数据，不需要后端。校验只挡旧后台，避免本地没登录时整站打不开。
 */
const LegacyAppRoute: React.FC = () => {
  const { status, isAuthenticated } = useAuth();

  // 正在用本地 token 向后端确认登录态：先挡住路由。
  // 否则这一瞬间 isAuthenticated 还是 false，会先闪一下登录页再跳回来。
  if (status === 'checking') return <CenteredSpin />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;

  return (
    <PermissionProvider>
      <MainLayout />
    </PermissionProvider>
  );
};

const App: React.FC = () => {
  return (
    // XProvider 完全继承 antd 的 ConfigProvider，另外带上 x 组件自己的文案
    <XProvider
      locale={{ ...zhCN, ...zhCNX }}
      theme={{
        token: {
          borderRadius: 6,
        },
      }}
    >
      <AntdApp>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              {/* 首页：Agent 对话界面（当前不接入旧主界面） */}
              <Route path="/" element={<AgentChatPage />} />
              <Route path="/agent" element={<AgentChatPage />} />
              <Route path="/login" element={<LoginPage />} />
              {/* 旧版管理后台，暂时保留在 /app 下，方便随时回退 */}
              <Route path="/app/*" element={<LegacyAppRoute />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </AntdApp>
    </XProvider>
  );
};

export default App;
