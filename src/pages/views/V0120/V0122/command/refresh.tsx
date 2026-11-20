import {ReloadOutlined} from '@ant-design/icons';
import type {ScheduleMaintenanceCommandFactory} from './types';

import { createPageTranslator } from '@/i18n';

const t = createPageTranslator("V0120_V0122");


export const refreshCommand: ScheduleMaintenanceCommandFactory = ({loading, reload}) => ({
    key: 'refresh',
    label: t("刷新"),
    icon: <ReloadOutlined/>,
    disabled: loading,
    onClick: () => {
        void reload();
    },
});
