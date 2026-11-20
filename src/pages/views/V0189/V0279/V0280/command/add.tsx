import {PlusOutlined} from '@ant-design/icons';
import type {YupaiOrderCommandFactory} from './types';

import { createPageTranslator } from '@/i18n';

const t = createPageTranslator("V0189_V0279_V0280");


/** 新增预订单：打开空白表单 */
export const addCommand: YupaiOrderCommandFactory = ({openForm}) => ({
    key: 'add',
    label: t("新增"),
    icon: <PlusOutlined/>,
    menuCode: 'A1449617-681E-4D06-9F0F-BADC138B6BFE',
    onClick: () => openForm('add', null),
});
