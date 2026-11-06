/**
 * 基本工序选择控件 = `Input.Search` + `NCWorkProcessModal` + 「输入后本地筛选」三件事的组合。
 *
 * 与 `materialSelect` / `projectSelect` 的区别只有一处、但很关键：
 * **工序没有「按编码 / 名称查一条」的接口**（只有全量列表）。所以用户输入后不能去查库，
 * 只能在**本地全量列表里筛**（`workProcessCache` 的 `matchWorkProcess`）：
 *
 * - 输入编码 / 名称回车：全等优先、其次包含匹配；**唯一命中当场回填**，
 *   多条 / 零条则打开弹窗，并把这段文字带进去当筛选词；
 * - 点放大镜：直接打开弹窗（同样带上输入框里的文字），在列表里挑；
 * - 清空输入框：编码变空串，`process` 传 `null`，调用方据此清掉名称 / 主键这些关联字段。
 *
 * 用法（受控，直接放进 `Form.Item` 即可）：
 *
 * ```tsx
 * <Form.Item name="CrcCode" label="工序">
 *     <WorkProcessSelect onSelect={(process) => form.setFieldsValue({
 *         CrcID: process.CrcID, CrcName: process.CrcName,
 *     })}/>
 * </Form.Item>
 * ```
 */

import React, {useCallback, useState} from 'react';
import {Input, message} from 'antd';
import type {NCWorkProcess} from '@/api/schemas/nc/NCBase.ts';
import NCWorkProcessModal from './workProcessModal.tsx';
import {ensureWorkProcesses} from './workProcessCache.ts';
import {matchWorkProcess} from './workProcess.ts';
import {toStringOrEmpty} from '@/utils';

export type WorkProcessSelectProps = {
    /** 当前工序编码（受控：直接放进 `Form.Item` 就行） */
    value?: string;
    /**
     * 编码变化。
     *
     * - 手输 / 清空：`process` 为 `null`（只改编码，要不要清关联字段由调用方决定）；
     * - 选中工序：`code` 与 `process` 一起来，通常直接 `setFieldsValue` 回填名称、主键等。
     */
    onChange?: (code: string, process: NCWorkProcess | null) => void;
    /** 选中工序后的回调，回填 `CrcName` / `CrcID` / 检测点这些字段用它 */
    onSelect?: (process: NCWorkProcess) => void;
    /**
     * 输入框被清空时回调（点 X，或者把编码删光）。
     *
     * 名称 / 主键 / 检测点这些都是「跟着工序走」的，编码没了必须一起清 ——
     * 否则会留下「编码空白、名称却还挂着上一道工序」的假数据。
     */
    onClear?: () => void;
    disabled?: boolean;
    placeholder?: string;
};

export const WorkProcessSelect: React.FC<WorkProcessSelectProps> = ({
    value,
    onChange,
    onSelect,
    onClear,
    disabled,
    placeholder = '工序编码',
}) => {
    const [open, setOpen] = useState(false);
    /** 打开弹窗时带进去的筛选词（见 `NCWorkProcessModal` 的 `defaultKeyword`） */
    const [keyword, setKeyword] = useState('');
    const [loading, setLoading] = useState(false);

    /** 定下一道工序：回填编码 + 回调 + 关弹窗，四条路（回车命中 / 弹窗里选）都走这里 */
    const pick = useCallback((process: NCWorkProcess) => {
        onChange?.(toStringOrEmpty(process.CrcCode), process);
        onSelect?.(process);
        setOpen(false);
    }, [onChange, onSelect]);

    /** 打开弹窗（带上筛选词）；弹窗自己会取全量（缓存命中就秒开） */
    const openPicker = useCallback((text: string) => {
        setKeyword(text);
        setOpen(true);
    }, []);

    /**
     * 回车 / 点放大镜。
     *
     * 两种情况都落到 `onSearch`，但不是一回事：
     * - 点放大镜（`event.type === 'click'`）→ 直接开弹窗：用户的意图是「我要换一道工序」，
     *   拿输入框里那串字再筛一遍、命中就回填同一条，看起来就是「点了没反应」；
     * - 回车（`keydown`）→ 本地筛一次，唯一命中才敢替用户定下来，多条 / 零条进弹窗挑。
     * - 点清除按钮也会触发一次 `onSearch`（`info.source === 'clear'`），必须忽略 ——
     *   清空由 `onChange` 那条路负责，这里再弹框就成了「点 X 反而打开选择框」。
     */
    const handleSearch = useCallback(async (raw: string) => {
        const text = raw.trim();
        if (!text) {
            openPicker('');
            return;
        }
        setLoading(true);
        try {
            const list = await ensureWorkProcesses();
            if (list.length === 0) {
                void message.warning('基本工序档案没取到（可能接口失败），请在弹窗里重试');
                openPicker(text);
                return;
            }
            const matched = matchWorkProcess(list, text);
            if (matched.kind === 'single') {
                pick(matched.process);
                return;
            }
            if (matched.kind === 'many') {
                void message.info(`匹配到 ${matched.candidates} 道工序，请在弹窗里选一个`);
            } else {
                void message.warning(`没有编码 / 名称匹配「${text}」的工序`);
            }
            // 多条 / 零条都把这段文字带进弹窗：用户能在列表里看见筛完的结果
            openPicker(text);
        } finally {
            setLoading(false);
        }
    }, [openPicker, pick]);

    /**
     * 手输 / 清空：只回编码，工序传 `null`。
     * 删到空时单独发一次 `onClear`，让调用方把名称 / 主键一起清掉。
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
                onChange={(event) => handleInput(event.target.value)}
                onSearch={(raw, event, info) => {
                    // 点清除按钮：那是「清空」，不是「查一下」，更不能弹框
                    if (info?.source === 'clear') return;
                    if (event?.type === 'click') {
                        openPicker(raw.trim());
                        return;
                    }
                    void handleSearch(raw);
                }}
            />
            <NCWorkProcessModal
                open={open}
                onCancel={() => setOpen(false)}
                /*
                 * 独立模式：视图的 props 是**平铺**的（`RegisterModalProps` 拆掉了 `viewProps`），
                 * 所以关键字直接作为 `defaultKeyword` 传下去。
                 */
                defaultKeyword={keyword}
                onSelect={(process) => pick(process)}
            />
        </>
    );
};

export default WorkProcessSelect;
