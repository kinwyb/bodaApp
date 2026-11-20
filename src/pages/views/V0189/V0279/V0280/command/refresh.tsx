import {ReloadOutlined} from '@ant-design/icons';
import type {YupaiOrderCommandFactory} from './types';

import { createPageTranslator } from '@/i18n';

const t = createPageTranslator("V0189_V0279_V0280");


/** 刷新：按当前查询条件重新加载列表 */
export const refreshCommand: YupaiOrderCommandFactory = ({reload}) => ({
    key: 'refresh',
    label: t("刷新"),
    icon: <ReloadOutlined/>,
    dividerBefore: true,
    onClick: () => void reload(),
});
