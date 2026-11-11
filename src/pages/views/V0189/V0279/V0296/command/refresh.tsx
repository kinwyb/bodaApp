import {ReloadOutlined} from '@ant-design/icons';
import type {DeliverPlanCommandFactory} from './types';

/** 刷新：重新请求已下单分期列表 */
export const refreshCommand: DeliverPlanCommandFactory = ({reload}) => ({
    key: 'refresh',
    label: '刷新',
    icon: <ReloadOutlined/>,
    onClick: () => void reload(),
});
