"""
识别结果后处理。

分两层，职责不同：

1. **术语纠错（数据驱动）**：读 `business_terms.txt` 里的业务词，用**拼音近似**匹配
   识别结果里字数相同、读音相近的片段，替换成词表里的正确写法。
   这一层的通用性来自「词表是数据」——词表从物料主数据、方法枚举来，
   而不是从某一句错误里抄；错法再怎么变，只要读音落在同一个词上就能命中。

2. **格式规整（规则驱动）**：项目号 `FT-029`、相邻物料号切成 9 位。
   这是业务格式，与具体说法无关，规则永远成立。

刻意不做的事：
- 不做通用语言纠错（需要 LLM，延迟翻倍，还容易把用户本来正确的话改坏）；
- 不碰数字本身 —— 识别错的位数是补不回来的，硬猜只会错得更隐蔽，
  数字应该交给「位数校验 + 查库」去兜，那是调用方的事。
"""

from __future__ import annotations

import re
from functools import lru_cache

from pypinyin import Style, lazy_pinyin

# 项目号前缀（业务确定值）；新增前缀改这里
PROJECT_PREFIXES = ("FT",)

# 物料号位数（业务确定值，如 316180001）
MATERIAL_CODE_LENGTH = 9

# 拼音相似度阈值：整词逐音节取平均，0.75 表示「大多数音节能对上」
# 实测：纺织物料/缝制物料 = 0.875，佛疗/辅料 = 0.75，包装包/包装bom 不走这条（含英文）
MIN_SIMILARITY = 0.75

# 太短的词（1 个字）误伤率太高，不值得纠
MIN_TERM_LENGTH = 2


@lru_cache(maxsize=4096)
def _phonemes(text: str) -> tuple[tuple[str, str], ...]:
    """逐字拆成 (声母, 韵母)。识别文本会重复出现在滑窗里，缓存一下省开销"""
    initials = lazy_pinyin(text, style=Style.INITIALS, strict=False)
    finals = lazy_pinyin(text, style=Style.FINALS, strict=False)
    return tuple(zip(initials, finals))


def _syllable_score(left: tuple[str, str], right: tuple[str, str]) -> float:
    """整个音节相同 = 1；只有声母相同 = 0.5（佛疗/辅料 这种韵母不同的靠它兜）"""
    if left == right:
        return 1.0
    if left[0] and left[0] == right[0]:
        return 0.5
    return 0.0


def _similarity(left: str, right: str) -> float:
    a, b = _phonemes(left), _phonemes(right)
    if len(a) != len(b) or not a:
        return 0.0
    return sum(_syllable_score(x, y) for x, y in zip(a, b)) / len(a)


def _is_chinese(text: str) -> bool:
    return all('\u4e00' <= char <= '\u9fff' for char in text)


def load_terms(path: str) -> list[tuple[str, tuple[str, ...]]]:
    """
    读词表：每行 `正确写法` 或 `正确写法 | 别名1 | 别名2`，# 开头是注释。

    别名是「确定会被念成/写成这样」的补充写法。拼音近似已经能覆盖纯中文词的
    各种错法（纺织/防织/仿制 → 缝制），所以别名主要是给**含英文的词**用的
    —— `包装bom` 的拼音和「包装包」差得太远，只能显式列出来。
    """
    try:
        with open(path, encoding="utf-8") as handle:
            lines = [line.strip() for line in handle]
    except FileNotFoundError:
        return []

    entries: list[tuple[str, tuple[str, ...]]] = []
    for line in lines:
        if not line or line.startswith("#"):
            continue
        parts = [part.strip() for part in line.split("|") if part.strip()]
        if parts:
            entries.append((parts[0], tuple(parts[1:])))

    # 长词优先：先替换「缝制物料」再替换「缝制」，避免长词被短词切碎
    return sorted(entries, key=lambda item: len(item[0]), reverse=True)


def correct_terms(text: str, terms: list[tuple[str, tuple[str, ...]]]) -> str:
    """先把别名精确换掉，再对纯中文词做拼音近似滑窗替换"""
    result = text

    for canonical, aliases in terms:
        # 1) 别名：含英文的目标词只能走这条路
        for alias in aliases:
            if alias in result:
                result = result.replace(alias, canonical)

        # 2) 拼音近似：目标词必须是纯中文，窗口也必须是纯中文
        #   （混了数字/英文的位置多半是编号，不能动）
        if not _is_chinese(canonical):
            continue
        length = len(canonical)
        if length < MIN_TERM_LENGTH:
            continue

        index = 0
        while index + length <= len(result):
            window = result[index : index + length]
            if window == canonical:
                index += length
                continue
            if not _is_chinese(window):
                index += 1
                continue
            if _similarity(window, canonical) >= MIN_SIMILARITY:
                result = result[:index] + canonical + result[index + length :]
                index += length
            else:
                index += 1

    return result


def normalize_project_codes(text: str) -> str:
    """`FT杠029` / `ftT—029` / `FT 029` → `FT-029`"""
    result = text
    for prefix in PROJECT_PREFIXES:
        result = re.sub(
            rf"({prefix})[^0-9]{{0,4}}?(\d{{2,4}})(?!\d)",
            lambda match: f"{prefix}-{match.group(2)}",
            result,
            flags=re.IGNORECASE,
        )
    return result


def split_material_codes(text: str) -> str:
    """
    两个物料号被连着念、识别成一串长数字时按 9 位切开。

    只切长度正好是 9 的整数倍的长串：不是整数倍说明识别时已经丢了位，
    硬切只会切出更隐蔽的错——原样留着，人一眼能看出问题。
    """

    def replace(match: re.Match[str]) -> str:
        run = match.group(0)
        if len(run) % MATERIAL_CODE_LENGTH != 0:
            return run
        return " ".join(
            run[index : index + MATERIAL_CODE_LENGTH]
            for index in range(0, len(run), MATERIAL_CODE_LENGTH)
        )

    return re.sub(r"\d{12,}", replace, text)


def postprocess(text: str, terms: list[tuple[str, tuple[str, ...]]]) -> str:
    """识别原文 → 可直接使用的文本"""
    result = correct_terms(text.strip(), terms)
    result = normalize_project_codes(result)
    result = split_material_codes(result)
    return re.sub(r"\s{2,}", " ", result).strip()
