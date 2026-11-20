import {ReloadOutlined} from '@ant-design/icons';
import type {ProcessRouteMatrixCommandFactory} from './types';

import { createPageTranslator } from '@/i18n';

const t = createPageTranslator("V0277_V0367");


/**
 * 刷新：按当前查询条件重新查列表。
 *
 * 「重新查库」这件事只有页面知道怎么发（查询条件、分页都在页面 state 里），
 * 所以命令只负责把 `reload` 转出去 —— 命令里再拼一遍请求参数必然与页面漂移。
 */
export const refreshCommand: ProcessRouteMatrixCommandFactory = ({reload}) => ({
    key: 'refresh',
    label: t("刷新"),
    icon: <ReloadOutlined/>,
    dividerBefore: true,
    onClick: () => void reload(),
});
