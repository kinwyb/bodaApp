import {CheckOutlined} from '@ant-design/icons';
import {runProductionMonitorAudit} from './auditAction';
import type {ProductionMonitorCommandFactory} from './types';

export const auditCommand: ProductionMonitorCommandFactory = (context) => ({
    key: 'audit',
    label: '审核',
    icon: <CheckOutlined/>,
    permission: '审核',
    disabled: context.selectionCount === 0,
    onClick: () => {
        void runProductionMonitorAudit(context).catch(() => undefined);
    },
});
