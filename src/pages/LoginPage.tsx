import React from 'react';
import { Alert, App, Button, Card, Divider, Form, Input, Typography } from 'antd';
import { LockOutlined, SafetyCertificateOutlined, UserOutlined } from '@ant-design/icons';
import { useAuth } from '../store/auth-context';
import { ApiError } from '../api';
import { useNavigate } from 'react-router-dom';
import {
  clearSsoManualLogout,
  isSsoEnabled,
  isSsoManualLogout,
  redirectToSsoLogin,
} from '../utils/sso';

const { Title, Text } = Typography;

const LoginPage: React.FC = () => {
  const { message } = App.useApp();
  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = React.useState(false);
  // 统一登录启用时默认展示平台入口；账号密码保留为兜底（平台故障时仍能进系统）
  const [usePassword, setUsePassword] = React.useState(false);
  const manualLogout = isSsoManualLogout();
  const showSsoEntry = isSsoEnabled && !usePassword;

  React.useEffect(() => {
    if (isAuthenticated) {
      // 登录后的主界面 = 工作台（左 Agent + 右后台）
      navigate('/', { replace: true });
    }
  }, [isAuthenticated, navigate]);

  const onFinish = async (values: { username: string; password: string }) => {
    setLoading(true);
    try {
      await login(values.username, values.password);
      message.success('登录成功');
      navigate('/', { replace: true });
    } catch (error) {
      // 后端返回的提示（如「用户名或密码错误」）比统一的「登录失败」更有用
      message.error(error instanceof ApiError ? error.message : '登录失败');
    } finally {
      setLoading(false);
    }
  };

  const startSsoLogin = () => {
    clearSsoManualLogout();
    // 用户主动点击：force 跳过自动跳转的死循环守卫
    redirectToSsoLogin('/', true);
  };

  return (
    <div style={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    }}>
      <Card
        style={{ width: 'min(400px, calc(100vw - 32px))', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.15)' }}
        styles={{ body: { padding: '40px 32px' } }}
      >
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <Title level={2} style={{ marginBottom: 4 }}>BodaWay</Title>
          <Text type="secondary">企业管理后台系统</Text>
        </div>
        {showSsoEntry ? (
          <>
            {manualLogout ? (
              <Alert
                type="info"
                showIcon
                message="您已退出登录"
                description="再次进入请通过统一登录平台验证身份。"
                style={{ marginBottom: 24 }}
              />
            ) : (
              <Alert
                type="warning"
                showIcon
                message="统一登录未能自动完成"
                description="自动跳转可能未成功，请重试；或使用下方账号密码登录。"
                style={{ marginBottom: 24 }}
              />
            )}
            <Button
              type="primary"
              size="large"
              block
              icon={<SafetyCertificateOutlined />}
              onClick={startSsoLogin}
            >
              统一身份认证登录
            </Button>
            <Divider plain style={{ margin: '20px 0 12px' }}>
              <Text type="secondary" style={{ fontSize: 12 }}>其它方式</Text>
            </Divider>
            <div style={{ textAlign: 'center' }}>
              <Button type="link" size="small" onClick={() => setUsePassword(true)}>
                使用账号密码登录
              </Button>
            </div>
          </>
        ) : (
          <>
            <Form
              name="login"
              onFinish={onFinish}
              autoComplete="off"
              size="large"
            >
              <Form.Item
                name="username"
                rules={[{ required: true, message: '请输入用户名' }]}
              >
                <Input prefix={<UserOutlined />} placeholder="用户名" />
              </Form.Item>
              <Form.Item
                name="password"
                rules={[{ required: true, message: '请输入密码' }]}
              >
                <Input.Password prefix={<LockOutlined />} placeholder="密码" />
              </Form.Item>
              <Form.Item style={{ marginBottom: isSsoEnabled ? 12 : 24 }}>
                <Button type="primary" htmlType="submit" loading={loading} block>
                  登 录
                </Button>
              </Form.Item>
            </Form>
            {isSsoEnabled && (
              <div style={{ textAlign: 'center' }}>
                <Button type="link" size="small" onClick={() => setUsePassword(false)}>
                  返回统一登录
                </Button>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
};

export default LoginPage;
