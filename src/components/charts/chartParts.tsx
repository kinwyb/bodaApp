import React from 'react';
import {Spin, theme, Typography} from 'antd';
import {toNumberOrZero} from '@/utils';
import {formatFullNumber} from './format';
import type {ChartTheme} from './theme';

/**
 * 三种图共用的零件（tooltip / 图例）。
 *
 * 单独成文件的原因：柱状、折线、饼图对这两块的诉求完全一样 ——
 * 都要 antd 浮层观感、都要「颜色点 + 名称 + 右对齐数值」。
 * 各写一份的话，改一次对比度要改三处，必然漂移。
 */

/** tooltip 里的一行：Recharts 各图元的 payload 形状不同，这里只取共有的四个字段 */
export type ChartTooltipItem = {
    name?: React.ReactNode;
    value?: unknown;
    color?: string;
    /** 系列字段名（柱/折线用来做 key；饼图没有，退回 name） */
    dataKey?: string | number;
};

export type ChartTooltipProps = {
    chartTheme: ChartTheme;
    active?: boolean;
    label?: React.ReactNode;
    payload?: ReadonlyArray<ChartTooltipItem>;
    /**
     * 是否在底部显示「合计」。
     *
     * 柱状图要（预排 + 下单 = 总量）；折线图**不要** —— 几条线往往是不同量纲
     * （产量 vs 合格率），加起来没有业务含义。
     */
    showTotal?: boolean;
};

/** tooltip：antd 浮层观感（`colorBgElevated` + 阴影 + 圆角），而不是 Recharts 默认的白底黑边 */
export const ChartTooltip: React.FC<ChartTooltipProps> = ({
    chartTheme,
    active,
    label,
    payload,
    showTotal = false,
}) => {
    if (!active || !payload || payload.length === 0) return null;
    const total = payload.reduce((sum, item) => sum + toNumberOrZero(item.value), 0);

    return (
        <div
            style={{
                background: chartTheme.tooltipBg,
                border: `1px solid ${chartTheme.tooltipBorder}`,
                borderRadius: chartTheme.tooltipRadius,
                boxShadow: '0 6px 16px rgba(0, 0, 0, 0.08)',
                padding: '8px 12px',
                fontFamily: chartTheme.fontFamily,
                fontSize: chartTheme.fontSize,
                color: chartTheme.textColor,
                minWidth: 120,
            }}
        >
            {label !== undefined && label !== null && label !== '' && (
                <div style={{marginBottom: 4, fontWeight: 500}}>{label}</div>
            )}
            {payload.map((item, index) => (
                <div
                    key={`${String(item.dataKey ?? item.name)}-${index}`}
                    style={{display: 'flex', alignItems: 'center', gap: 6, lineHeight: '20px'}}
                >
                    <span
                        style={{
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            background: item.color,
                            flex: 'none',
                        }}
                    />
                    <span style={{color: chartTheme.textColorSecondary}}>{item.name}</span>
                    <span style={{marginLeft: 'auto', fontVariantNumeric: 'tabular-nums'}}>
                        {/*
                          tooltip 里给**完整数字 + 千分位**：这里空间够，用户要的是准确值；
                          缩写（`8.1k`）只用在轴上和图元上那些没地方放数字的地方。
                        */}
                        {formatFullNumber(item.value)}
                    </span>
                </div>
            ))}
            {showTotal && payload.length > 1 && (
                <div
                    style={{
                        marginTop: 4,
                        paddingTop: 4,
                        borderTop: `1px solid ${chartTheme.gridColor}`,
                        display: 'flex',
                        gap: 8,
                    }}
                >
                    <span style={{color: chartTheme.textColorSecondary}}>合计</span>
                    <span style={{marginLeft: 'auto', fontVariantNumeric: 'tabular-nums'}}>
                        {formatFullNumber(total)}
                    </span>
                </div>
            )}
        </div>
    );
};

/** 图例的一项 */
export type ChartLegendItem = {
    /** React key */
    key: string;
    name: string;
    color: string;
};

export type ChartLegendProps = {
    chartTheme: ChartTheme;
    items: readonly ChartLegendItem[];
};

/**
 * 图例：一行 HTML，顺序与颜色完全由调用方给。
 *
 * 为什么不用 Recharts 的默认图例：
 * 1. 堆叠柱自动推导出来的条目顺序是**反的**（实测「预排量 / 下单量」被画成「下单量 / 预排量」）；
 * 2. Recharts 3 的 `Legend` 类型把 `payload` 入参 `Omit` 掉了，想控顺序只能走 `content`；
 * 3. 默认图例是 SVG 文本，字体与色块尺寸都跟 antd 对不上。
 *
 * 不接点击切换显隐 —— 旧客户端没有这个交互，加上去只会让用户困惑「点了怎么少了一块」。
 */
export const ChartLegend: React.FC<ChartLegendProps> = ({chartTheme, items}) => (
    <div
        style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 16,
            paddingTop: 8,
            fontFamily: chartTheme.fontFamily,
            fontSize: chartTheme.fontSize,
            color: chartTheme.textColor,
        }}
    >
        {items.map((item) => (
            <span key={item.key} style={{display: 'inline-flex', alignItems: 'center', gap: 6}}>
                <span
                    style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: item.color,
                        flex: 'none',
                    }}
                />
                {item.name}
            </span>
        ))}
    </div>
);

export type ChartShellProps = {
    loading?: boolean;
    /** 没有数据行：盖一层「暂无数据」提示（指针事件穿透，不挡 tooltip 之外的交互） */
    isEmpty?: boolean;
    emptyTip?: string;
    children: React.ReactNode;
};

/**
 * 图表外壳：定位容器 + 空态 + 加载态。
 *
 * 三种图（柱 / 折线 / 饼）的这两层遮罩完全一样，抽出来是为了：
 * 1. **高度契约集中在一处** —— 根节点 `height:100%`，所以调用方必须给确定高度；
 * 2. 空态/加载态的视觉一致（都盖在图中央），不会某个图漏掉。
 */
export const ChartShell: React.FC<ChartShellProps> = ({loading, isEmpty, emptyTip = '暂无数据', children}) => {
    const {token} = theme.useToken();

    return (
        <div style={{position: 'relative', width: '100%', height: '100%'}}>
            {children}
            {isEmpty && !loading && (
                <div
                    style={{
                        position: 'absolute',
                        inset: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        pointerEvents: 'none',
                    }}
                >
                    <Typography.Text type="secondary">{emptyTip}</Typography.Text>
                </div>
            )}
            {loading && (
                <div
                    style={{
                        position: 'absolute',
                        inset: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        // 半透明即可：图表是 SVG，压得住（GridTable 那种 canvas 才需要不透明遮罩）
                        background: token.colorBgContainer,
                        opacity: 0.6,
                    }}
                >
                    <Spin/>
                </div>
            )}
        </div>
    );
};
