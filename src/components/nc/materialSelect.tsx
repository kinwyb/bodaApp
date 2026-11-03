/**
 * 物料选择输入框 = `Input.Search` + `NCMaterialModal` + 「输入编码查一次」三件事的组合。
 *
 * 这三件事几乎每个用到物料的页面都要写一遍，而且每次都要重复踩同样的坑
 * （查回来的多条怎么处理、选中后怎么回填、清空时关联字段要不要一起清）。抽成一个受控组件，
 * 页面只管「选中之后把值填到哪几个字段」：
 *
 * ```tsx
 * <Form.Item name="PackMaterialCode" label="物料编码">
 *     <MaterialSelect onSelect={(material) => form.setFieldsValue({...})}/>
 * </Form.Item>
 * ```
 *
 * 交互约定（与 BOM 矩阵里格子的物料编辑保持一致）：
 * - 直接输入编码后回车（或点放大镜）→ 按编码查一次 `nc/material/query`；
 *   **正好一条**就当场回填并回调 `onSelect`，多条/零条才打开弹窗；
 * - 清空输入框 → 编码变成空串，`material` 传 `null`，调用方据此清掉名称、单位这些关联字段；
 * - 弹窗只是辅助入口：分类树 + 关键字查库，双击一行选中（弹窗自己的行为）。
 */

import React, {useCallback, useState} from 'react';
import {Input, message} from 'antd';
import NCMaterialModal from '@/components/nc/materialModal.tsx';
import {ncMaterialApi} from '@/api/modules/nc/material.ts';
import type {NCMaterial} from '@/api/schemas/nc/NCMaterial.ts';
import {ErrorMessage} from '@/api/request.ts';
import {toStringOrEmpty} from '@/utils';

export type MaterialSelectProps = {
    /** 当前物料编码（受控：直接放进 `Form.Item` 就行） */
    value?: string;
    /**
     * 编码变化。
     *
     * - 手输 / 清空：`material` 为 `null`（只改编码，要不要清关联字段由调用方决定）；
     * - 选中物料：`code` 与 `material` 一起来，通常直接 `setFieldsValue` 回填名称、单位等。
     */
    onChange?: (code: string, material: NCMaterial | null) => void;
    /** 选中物料（弹窗选中或编码唯一命中）后的回调，回填关联字段用它 */
    onSelect?: (material: NCMaterial) => void;
    /**
     * 输入框被清空时回调（点 X，或者把编码删光）。
     *
     * 名称 / 版本 / 规格 / 单位这些是「跟着物料走」的，编码没了必须一起清 ——
     * 否则会留下「编码空白、名称却还挂着上一个物料」的假数据，用户以为还在编辑那一份。
     * 组件不替调用方决定清哪些字段，所以这里只给一个信号。
     */
    onClear?: () => void;
    /**
     * 物料分类前缀过滤，透传给弹窗（例如只允许 31 开头的物料传 `['31']`）。
     * 按编码查回来的一条也要过这层过滤，避免「手输能绕过限制」。
     */
    filter?: string[];
    disabled?: boolean;
    placeholder?: string;
};

/**
 * 分类前缀过滤：与弹窗 `NCMaterialView` 的 `canShow` 同一口径。
 *
 * 双向 `startsWith` 是有意的（沿用弹窗的判定）：用户可能只填了半截编码，
 * 这时「填的这截」是分类编码的前缀也应当放行。
 */
function matchFilter(material: NCMaterial, filter?: string[]): boolean {
    if (!filter || filter.length === 0) return true;
    const code = toStringOrEmpty(material.code);
    if (!code) return true;
    return filter.some((prefix) => code.startsWith(prefix) || prefix.startsWith(code));
}

export const MaterialSelect: React.FC<MaterialSelectProps> = ({
    value,
    onChange,
    onSelect,
    onClear,
    filter,
    disabled,
    placeholder = '物料编码',
}) => {
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);

    /** 定下一条物料：回填编码 + 回调 + 关弹窗，三条路（查回来 / 弹窗里选）都走这里 */
    const pick = useCallback((material: NCMaterial) => {
        onChange?.(toStringOrEmpty(material.code), material);
        onSelect?.(material);
        setOpen(false);
    }, [onChange, onSelect]);

    /**
     * 回车 / 点放大镜。
     *
     * 空着点放大镜 = 想从弹窗里挑，直接打开；有编码先查一次 ——
     * 只有「正好一条」才敢替用户定下来，多条让它进弹窗挑（替它选第一条等于赌运气）。
     */
    const handleSearch = useCallback(async (raw: string) => {
        const code = raw.trim();
        if (!code) {
            setOpen(true);
            return;
        }
        setLoading(true);
        try {
            const result = await ncMaterialApi.query({code});
            const list = (result.data ?? []).filter((material) => matchFilter(material, filter));
            if (list.length === 1) {
                pick(list[0]);
                return;
            }
            if (list.length === 0) {
                void message.warning(`没有编码匹配「${code}」的物料`);
            } else {
                void message.info(`匹配到 ${list.length} 个物料，请在弹窗里选一个`);
            }
            setOpen(true);
        } catch (error) {
            void message.error(ErrorMessage(error, '物料查询失败'));
        } finally {
            setLoading(false);
        }
    }, [filter, pick]);

    /**
     * 手输 / 清空。
     *
     * 点到空（点 X 或删光）时单独发一次 `onClear`：编码没了，由它带出来的名称、版本、
     * 单位这些也留不住 —— 交给调用方一起清，别让表单停在「编码空、名称还在」的状态。
     */
    const handleInput = useCallback((raw: string) => {
        onChange?.(raw, null);
        if (!raw.trim()) onClear?.();
    }, [onChange, onClear]);

    return (
        <>
            <Input.Search
                value={toStringOrEmpty(value)}
                disabled={disabled}
                loading={loading}
                allowClear
                placeholder={placeholder}
                // 手输与清空都只回编码，material 传 null：关联字段该不该清由调用方判断
                onChange={(event) => handleInput(event.target.value)}
                onSearch={(raw) => void handleSearch(raw)}
            />
            <NCMaterialModal
                open={open}
                onCancel={() => setOpen(false)}
                onSelect={(material) => pick(material)}
                filter={filter}
            />
        </>
    );
};

export default MaterialSelect;
