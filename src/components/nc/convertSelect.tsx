/**
 * 单位选择输入框 = `Input.Search` + `NCMaterialConvertModal`，可选单位**按物料**取
 * （`NCMaterial.materialconvert`）。
 *
 * 为什么按物料：一个物料的「件 / 打 / 箱」是它自己的换算单位，换物料就得换一整套。
 * 所以这里不收一份固定列表，只要「这一格属于哪个物料」——弹窗自己会从
 * `@/components/nc/convertCache` 里拿（用户刚用 `MaterialSelect` 选过物料就有了；
 * 编辑已有记录时按需回查一次，同一物料只查一次）。
 *
 * 用法（受控，放进 `Form.Item` 即可，但要自己把物料主键传进来）：
 *
 * ```tsx
 * <Form.Item name="Cassmeasure" label="单位">
 *     <ConvertSelect materialVID={packMaterialVID} onSelect={(c) => form.setFieldsValue({VChangerate: c.measrate})}/>
 * </Form.Item>
 * ```
 */

import React, {useCallback, useState} from 'react';
import {Input, message} from 'antd';
import NCMaterialConvertModal from '@/components/nc/materialConvertModal.tsx';
import type {NCMaterialConvert} from '@/api/schemas/nc/NCMaterial.ts';
import {toStringOrEmpty} from '@/utils';

export type ConvertSelectProps = {
    /** 当前单位名称（受控） */
    value?: string;
    /** 单位变化：只回名称，`convert` 在选中时才有值 */
    onChange?: (unit: string, convert: NCMaterialConvert | null) => void;
    /** 选中单位（带回换算率与单位主键），回填 `VChangerate` 用它 */
    onSelect?: (convert: NCMaterialConvert) => void;
    /** 这一格的物料主键 —— 可选单位按它取；为空时不允许打开弹窗 */
    materialVID?: string;
    disabled?: boolean;
    placeholder?: string;
};

export const ConvertSelect: React.FC<ConvertSelectProps> = ({
    value,
    onChange,
    onSelect,
    materialVID,
    disabled,
    placeholder = '单位',
}) => {
    const [open, setOpen] = useState(false);
    const vid = toStringOrEmpty(materialVID).trim();

    const pick = useCallback((convert: NCMaterialConvert) => {
        onChange?.(toStringOrEmpty(convert.measdoc), convert);
        onSelect?.(convert);
        setOpen(false);
    }, [onChange, onSelect]);

    /** 没选物料就没有可选单位：直接说清楚，别弹一个空列表让人猜 */
    const openPicker = useCallback(() => {
        if (disabled) return;
        if (!vid) {
            void message.warning('先选物料，才有可选的单位');
            return;
        }
        setOpen(true);
    }, [disabled, vid]);

    return (
        <>
            <Input.Search
                value={toStringOrEmpty(value)}
                // 单位只能从物料的换算单位里选，不给手输（手输的值后端换算不出来）
                readOnly
                disabled={disabled}
                placeholder={vid ? placeholder : '先选物料'}
                onSearch={openPicker}
                onClick={openPicker}
            />
            <NCMaterialConvertModal
                open={open}
                onCancel={() => setOpen(false)}
                onSelect={(convert) => pick(convert)}
                /*
                 * 打开那一刻按当前物料算可选单位。
                 *
                 * 这里没有「编辑行」，所以忽略入参 —— 这依赖 `RegisterInputModal`
                 * 独立模式会现算 viewProps（见 registerModal.tsx 的 `activeViewProps`）；
                 * 修那个缺陷之前，这个回调根本不会被调用。
                 */
                viewProps={() => ({materialVID: vid})}
            />
        </>
    );
};

export default ConvertSelect;
