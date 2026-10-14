import {ReloadOutlined} from '@ant-design/icons';
import type {YupaiOrderCommandFactory} from './types';

/** 刷新：按当前查询条件重新加载列表 */
export const refreshCommand: YupaiOrderCommandFactory = ({reload}) => ({
    key: 'refresh',
    label: '刷新',
    icon: <ReloadOutlined/>,
    dividerBefore: true,
    onClick: () => void reload(),
});
