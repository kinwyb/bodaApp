import {CloseOutlined, EditOutlined} from '@ant-design/icons';
import type {ScheduleMaintenanceCommandFactory} from './types';

export const editCommand: ScheduleMaintenanceCommandFactory = ({
    editing,
    employeeLoading,
    toggleEditing,
}) => ({
    key: 'edit',
    label: editing ? '取消编辑' : '编辑',
    icon: editing ? <CloseOutlined/> : <EditOutlined/>,
    permission: '编辑',
    disabled: employeeLoading && !editing,
    onClick: () => {
        void toggleEditing();
    },
});
