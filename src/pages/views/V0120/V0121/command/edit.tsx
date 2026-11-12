import {EditOutlined} from '@ant-design/icons';
import type {OrderInfoCommandFactory} from './types';

export const editCommand: OrderInfoCommandFactory = ({editing, loading, saving, startEdit}) => ({
    key: 'edit',
    label: '编辑',
    icon: <EditOutlined/>,
    permission: '编辑',
    disabled: editing || loading || saving,
    onClick: startEdit,
});
