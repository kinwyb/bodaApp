import React from 'react';
import {Card, Col, Row, Statistic} from 'antd';
import {FileTextOutlined, RiseOutlined, ShoppingCartOutlined, UserOutlined} from '@ant-design/icons';
import {useTabs} from '@/store/tabs';
import {isDebugEnv} from "@/utils";
import {useI18n} from '@/i18n/context';

const Dashboard: React.FC = () => {
    const {openView} = useTabs();
    const {t} = useI18n();

    return (
        <div style={{padding: 0}}>
            {isDebugEnv &&
                <Row gutter={[16, 16]} style={{marginBottom: 16}}>
                    <Col xs={24} sm={12} lg={6}>
                        <Card
                            hoverable
                            style={{cursor: 'pointer'}}
                            onClick={() => openView('V0277_V0354')}
                        >
                            <Statistic
                                title={t('总订单数')}
                                value={1268}
                                prefix={<ShoppingCartOutlined/>}
                                styles={{content: {color: '#1890ff'}}}
                            />
                        </Card>
                    </Col>
                    <Col xs={24} sm={12} lg={6}>
                        <Card>
                            <Statistic
                                title={t('用户数')}
                                value={368}
                                prefix={<UserOutlined/>}
                                styles={{content: {color: '#52c41a'}}}
                            />
                        </Card>
                    </Col>
                    <Col xs={24} sm={12} lg={6}>
                        <Card>
                            <Statistic
                                title={t('今日订单')}
                                value={42}
                                prefix={<FileTextOutlined/>}
                                styles={{content: {color: '#faad14'}}}
                            />
                        </Card>
                    </Col>
                    <Col xs={24} sm={12} lg={6}>
                        <Card>
                            <Statistic
                                title={t('增长率')}
                                value={12.5}
                                precision={1}
                                suffix="%"
                                prefix={<RiseOutlined/>}
                                styles={{content: {color: '#cf1322'}}}
                            />
                        </Card>
                    </Col>
                </Row>
            }
            <Card title={t('系统公告')}>
                <p>{t('欢迎使用')}</p>
                <p>{t('本系统内嵌一个AI Agent用于辅助用户使用系统功能。')}</p>
            </Card>
        </div>
    );
};

export default Dashboard;
