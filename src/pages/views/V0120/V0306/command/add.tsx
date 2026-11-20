import {PlusOutlined} from '@ant-design/icons';
import type {OutStoreCommandFactory} from './types';

import { createPageTranslator } from '@/i18n';

const t = createPageTranslator("V0120_V0306");


export const addOutStoreCommand: OutStoreCommandFactory = ({openAdd}) => ({
    key: 'add',
    label: t("新增出库单"),
    icon: <PlusOutlined/>,
    onClick: openAdd,
});
