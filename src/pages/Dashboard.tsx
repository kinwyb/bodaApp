import React from 'react';
import { Card, Col, Row, Statistic } from 'antd';
import { ShoppingCartOutlined, UserOutlined, FileTextOutlined, RiseOutlined } from '@ant-design/icons';

const Dashboard: React.FC = () => {
  return (
    <div style={{ padding: 0 }}>
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="总订单数"
              value={1268}
              prefix={<ShoppingCartOutlined />}
              styles={{ content: { color: '#1890ff' } }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="用户数"
              value={368}
              prefix={<UserOutlined />}
              styles={{ content: { color: '#52c41a' } }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="今日订单"
              value={42}
              prefix={<FileTextOutlined />}
              styles={{ content: { color: '#faad14' } }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="增长率"
              value={12.5}
              precision={1}
              suffix="%"
              prefix={<RiseOutlined />}
              styles={{ content: { color: '#cf1322' } }}
            />
          </Card>
        </Col>
      </Row>
      <Card title="系统公告" style={{ marginTop: 16 }}>
        <p>欢迎使用 BodaWay 企业管理后台系统。</p>
        <p>本系统基于 React + TypeScript + Ant Design 6 构建。</p>
      </Card>
    </div>
  );
};

export default Dashboard;
