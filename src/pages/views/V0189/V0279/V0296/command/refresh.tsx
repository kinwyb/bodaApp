import {ReloadOutlined} from '@ant-design/icons';
import type {DeliverPlanCommandFactory} from './types';

import { createPageTranslator } from '@/i18n';

const t = createPageTranslator("V0189_V0279_V0296");


/** 刷新：重新请求已下单分期列表 */
export const refreshCommand: DeliverPlanCommandFactory = ({reload}) => ({
    key: 'refresh',
    label: t("刷新"),
    icon: <ReloadOutlined/>,
    onClick: () => void reload(),
});
