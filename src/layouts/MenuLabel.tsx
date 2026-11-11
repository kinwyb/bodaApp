import React, {useEffect, useRef, useState} from 'react';
import {Tooltip} from 'antd';

interface MenuLabelProps {
    /** 菜单名（纯文本，溢出时直接用它在 Tooltip 里显示全名） */
    text: string;
}

/**
 * 侧栏菜单的文字标签：放得下正常显示，放不下就省略号 + 悬停看全名。
 *
 * 为什么不能指望 antd 自带的提示：antd 的菜单 Tooltip **只在折叠成图标时**才出现
 * （MenuItem 内部 `if (!mergedCollapsed) tooltipProps.title = null`），
 * 而侧栏宽度固定、三级菜单缩进之后所剩无几，「产能负荷(一级计划)」这类名字必然被截断，
 * 展开状态下用户就完全看不到全名了。
 *
 * 是否真的溢出由 `scrollWidth > clientWidth` 判定：放得下的菜单项不加提示，
 * 否则鼠标划过每一项都弹框，反而吵。
 */
const MenuLabel: React.FC<MenuLabelProps> = ({text}) => {
    const spanRef = useRef<HTMLSpanElement>(null);
    const [overflow, setOverflow] = useState(false);

    useEffect(() => {
        const element = spanRef.current;
        if (!element) return undefined;

        const measure = () => {
            // 折叠成图标时 antd 把 title-content 压成 width:0，此时测出来的「溢出」是假的
            if (!element.offsetWidth) return;
            setOverflow(element.scrollWidth - element.clientWidth > 1);
        };

        measure();
        // 侧栏折叠/展开、外围宽度变化都会改变可用空间，跟着重测
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        return () => observer.disconnect();
    }, [text]);

    return (
        <Tooltip title={overflow ? text : undefined} placement="right">
            <span ref={spanRef} className="main-menu-label">
                {text}
            </span>
        </Tooltip>
    );
};

export default MenuLabel;
