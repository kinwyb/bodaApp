import {ReloadOutlined} from '@ant-design/icons';
import type {ScheduleMaintenanceCommandFactory} from './types';

export const refreshCommand: ScheduleMaintenanceCommandFactory = ({loading, reload}) => ({
    key: 'refresh',
    label: '刷新',
    icon: <ReloadOutlined/>,
    disabled: loading,
    onClick: () => {
        void reload();
    },
});
