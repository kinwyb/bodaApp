/**
 * 项目选择输入框 = `Input.Search` + `NCProjectModal` + 「输入项目号查一次」三件事的组合。
 *
 * 与 `MaterialSelect` 是同一套交互，只有一处差别必须知道：
 *
 * 物料按编码查的是 `nc/material/query`（纯查询）；项目按号查的是
 * `nc/base/project/queryByName` —— **后端这个接口自带「不存在就创建」（`notExistCreate`）**。
 * 所以查询必须走 `ncBaseApi.projectByName`（那里显式传了 `false`），
 * 别直接拼这个路径：手滑敲了个不存在的项目号再回车，就会在 NC 档案里造出一条项目。
 *
 * 交互约定（与物料选择保持一致）：
 * - **点放大镜 = 打开选择框**（不管输入框里有没有值）：用户的动作是「我要换一个项目」，
 *   不该拿旧编码去查一遍再悄悄回填同一个；
 * - **输入项目号回车 = 按号查一次**：**正好一条**就当场回填（编码 + 项目主键）并回调 `onSelect`，
 *   多条 / 零条才打开弹窗（替用户选第一条等于赌运气）；
 * - 清空输入框 → 编码变成空串，`project` 传 `null`，调用方据此把项目主键一起清掉；
 * - 打开弹窗时把输入框里的内容当关键字带进去：用户往往先敲了半个编码才去点放大镜。
 *
 * 「点按钮」与「回车」靠 `onSearch` 的事件类型区分（`event.type` 分别是 `click` / `keydown`）；
 * 点清除按钮也会走一次 `onSearch`（`info.source === 'clear'`），那一次必须忽略。
 */

import React, {useCallback, useState} from 'react';
import {Input, message} from 'antd';
import NCProjectModal from '@/components/nc/projectModal.tsx';
import {ncBaseApi} from '@/api/modules/nc/base.ts';
import type {NCProject} from '@/api/schemas/nc/NCBase.ts';
import {ErrorMessage} from '@/api/request.ts';
import {toStringOrEmpty} from '@/utils';

export type ProjectSelectProps = {
    /** 当前项目编码（受控：直接放进 `Form.Item` 就行） */
    value?: string;
    /**
     * 编码变化。
     *
     * - 手输 / 清空：`project` 为 `null`（只改编码，要不要清关联字段由调用方决定）；
     * - 选中项目：`code` 与 `project` 一起来，通常直接 `setFieldsValue` 回填项目主键。
     */
    onChange?: (code: string, project: NCProject | null) => void;
    /** 选中项目后的回调，回填 `ProjectID` 这类关联字段用它 */
    onSelect?: (project: NCProject) => void;
    /**
     * 输入框被清空时回调（点 X，或者把编码删光）。
     *
     * 项目主键是「跟着项目走」的：编码没了它也必须清掉，
     * 否则会留下「编码空白、主键却还指着上一个项目」的假数据，保存时后端按旧项目入库。
     */
    onClear?: () => void;
    disabled?: boolean;
    placeholder?: string;
};

export const ProjectSelect: React.FC<ProjectSelectProps> = ({
    value,
    onChange,
    onSelect,
    onClear,
    disabled,
    placeholder = '项目编码',
}) => {
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    /** 打开弹窗时带进去的初始关键字（见文件头） */
    const [keyword, setKeyword] = useState('');

    /** 定下一个项目：回填编码 + 回调 + 关弹窗，两条路（查回来 / 弹窗里选）都走这里 */
    const pick = useCallback((project: NCProject) => {
        onChange?.(toStringOrEmpty(project.project_code), project);
        onSelect?.(project);
        setOpen(false);
    }, [onChange, onSelect]);

    /**
     * 回车查一次。
     *
     * 命中判定按**编码全等**：接口是模糊查（名称也能命中），
     * 输入「2024」这种片段时返回一堆、却没有一条编码等于它 —— 那就不该替用户定下来。
     */
    const handleSearch = useCallback(async (raw: string) => {
        const code = raw.trim();
        if (!code) {
            setOpen(true);
            return;
        }
        setLoading(true);
        try {
            const result = await ncBaseApi.projectByName(code);
            const list = result.data ?? [];
            const exact = list.filter((project) => toStringOrEmpty(project.project_code).trim() === code);
            if (exact.length === 1) {
                pick(exact[0]);
                return;
            }
            if (list.length === 0) {
                void message.warning(`没有项目号 / 名称匹配「${code}」的项目`);
            } else if (exact.length === 0) {
                void message.info(`「${code}」不是完整项目号，匹配到 ${list.length} 个项目，请在弹窗里选`);
            } else {
                void message.info(`匹配到 ${exact.length} 个同编码项目，请在弹窗里选`);
            }
            setOpen(true);
        } catch (error) {
            void message.error(ErrorMessage(error, '项目查询失败'));
            setOpen(true);
        } finally {
            setLoading(false);
        }
    }, [pick]);

    /**
     * 手输 / 清空：只回编码，项目传 `null`。
     * 删到空时单独发一次 `onClear`，让调用方把项目主键一起清掉。
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
                    // 点清除按钮时 antd 也会回调一次：那是「清空」，不是「查一下」，更不能弹框
                    if (info?.source === 'clear') return;
                    setKeyword(raw.trim());
                    if (event?.type === 'click') {
                        // 点放大镜 = 打开选择框（见文件头的交互约定）
                        setOpen(true);
                        return;
                    }
                    void handleSearch(raw);
                }}
            />
            <NCProjectModal
                open={open}
                defaultKeyword={keyword}
                onCancel={() => setOpen(false)}
                onSelect={(project) => pick(project)}
            />
        </>
    );
};

export default ProjectSelect;
