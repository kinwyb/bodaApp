import {ReloadOutlined} from '@ant-design/icons';
import type {PreorderCommandFactory} from './types';

/** 刷新：按当前查询条件重新加载列表 */
export const refreshCommand: PreorderCommandFactory = ({reload}) => ({
    key: 'refresh',
    label: '刷新',
    icon: <ReloadOutlined/>,
    dividerBefore: true,
    onClick: () => void reload(),
});
