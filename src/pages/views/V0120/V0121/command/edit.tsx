import {EditOutlined} from '@ant-design/icons';
import type {OrderInfoCommandFactory} from './types';

import { createPageTranslator } from '@/i18n';

const t = createPageTranslator("V0120_V0121");


export const editCommand: OrderInfoCommandFactory = ({editing, loading, saving, startEdit}) => ({
    key: 'edit',
    label: t("编辑"),
    icon: <EditOutlined/>,
    permission: '编辑',
    disabled: editing || loading || saving,
    onClick: startEdit,
});
