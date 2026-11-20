import {CheckOutlined} from '@ant-design/icons';
import {runProductionMonitorAudit} from './auditAction';
import type {ProductionMonitorCommandFactory} from './types';

import { createPageTranslator } from '@/i18n';

const t = createPageTranslator("V0120_V0123");


export const auditCommand: ProductionMonitorCommandFactory = (context) => ({
    key: 'audit',
    label: t("审核"),
    icon: <CheckOutlined/>,
    permission: '审核',
    disabled: context.selectionCount === 0,
    onClick: () => {
        void runProductionMonitorAudit(context).catch(() => undefined);
    },
});
