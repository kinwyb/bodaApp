import {PlusOutlined} from '@ant-design/icons';
import type {OutStoreCommandFactory} from './types';

export const addOutStoreCommand: OutStoreCommandFactory = ({openAdd}) => ({
    key: 'add',
    label: '新增出库单',
    icon: <PlusOutlined/>,
    onClick: openAdd,
});
