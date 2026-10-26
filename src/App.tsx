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
import WorkbenchLayout from './layouts/WorkbenchLayout';
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
 * 登录守卫：确认登录态 → 包上菜单权限 → 渲染界面。
 *
 * 所有需要登录的入口都套这一层：
 * - `/`     工作台（左 Agent + 右后台，登录后的主界面）
 * - `/app`  只有后台（留作回退 / 大屏看表格时用）
 * - `/agent` 只有 Agent（整页对话，调试与演示用）
 *
 * Agent 的连接凭证就是登录拿到的 api token（见 api/request 的 getToken），
 * 所以它必须在这个守卫里面 —— 没登录时不建立 ws 连接。
 */
const Protected: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { status, isAuthenticated } = useAuth();

  // 正在用本地 token 向后端确认登录态：先挡住路由。
  // 否则这一瞬间 isAuthenticated 还是 false，会先闪一下登录页再跳回来。
  if (status === 'checking') return <CenteredSpin />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;

  return <PermissionProvider>{children}</PermissionProvider>;
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
              {/* 主界面：左侧 Agent 助手 + 右侧原本的后台 */}
              <Route
                path="/"
                element={
                  <Protected>
                    <WorkbenchLayout />
                  </Protected>
                }
              />
              {/* 单独的后台（不带 Agent），方便回退与宽屏看表格 */}
              <Route
                path="/app/*"
                element={
                  <Protected>
                    <MainLayout />
                  </Protected>
                }
              />
              {/* 单独的 Agent 整页对话 */}
              <Route
                path="/agent"
                element={
                  <Protected>
                    <AgentChatPage />
                  </Protected>
                }
              />
              <Route path="/login" element={<LoginPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </AntdApp>
    </XProvider>
  );
};

export default App;
