import {FileAddOutlined} from '@ant-design/icons';
import {PACK_BOM_MATRIX_SAVE_MENU_CODE, type PackBomMatrixCommandFactory} from './types';

/** 新增：打开空白的矩阵表单 */
export const addCommand: PackBomMatrixCommandFactory = ({openForm}) => ({
    key: 'add',
    label: '新增',
    icon: <FileAddOutlined/>,
    menuCode: PACK_BOM_MATRIX_SAVE_MENU_CODE,
    onClick: () => openForm('add', null),
});
