// ==UserScript==
// @name         洗练增强
// @namespace    http://tampermonkey.net/
// @version      2.5.52
// @description  淬炼增强：设置按钮微调位置（右移2、下移0.5）
// @author       小羔羊
// @match        *://*
// @grant        unsafeWindow
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    const unsafeWindow = window;
    const PATCH_KEY = '__quenchSkipRedOnlyPatched__';
    const RED_TOGGLE_KEY = '__skipRedOnlyToggle';
    const RED_STATE_KEY = '__skipRedOnlyEnabled';
    const RED_CLICK_KEY = '__skipRedOnlyClickBound';
    const AUTO_CONFIRMING_RED_KEY = '__skipRedOnlyAutoConfirming';
    const ORIGIN_POS_KEY = '__skipRedOnlyOriginTogglePositions';
    const ENCHANT_CLONE_KEY = '__quenchEnchantClone';
    const ENCHANT_CLICK_KEY = '__quenchEnchantCloneClickBound';
    const ENCHANT_DIALOG_MODULE = 'EquipEnchantDialog';
    const ENCHANT_DIALOG_PATCH_KEY = '__quenchBlankSettingsPatched';
    const BLANK_REQUEST_KEY = '__quenchBlankSettingsRequest';
    const BLANK_MODE_KEY = '__quenchBlankSettingsMode';
    const ORIG_TITLE_KEY = '__quenchBlankSettingsOrigTitle';
    const BLANK_TITLE_TEXT = '设置';
    const BLANK_HIDE_CHILDREN = ['container', 'tab', 'resources'];
    // 空白设置面板：需要隐藏的弹窗内部节点（顶部深色栏/装备图标/底部三个按钮）
    const BLANK_HIDE_INNER = ['equipCnt', 'equipSlot', 'btnConfirm', 'btnCancelBless', 'btnQuench'];
    // 空白设置面板：改动记录仓库（用于关闭/正常打开时还原）
    const BLANK_STORE_KEY = '__quenchBlankSettingsStore';
    // 空白设置面板：已定位的横幅标题节点缓存
    const BLANK_TITLE_NODE_KEY = '__quenchBlankTitleNode';
    // 自定义洗炼（指定次数/指定词条）：配置持久化 key 与运行态 key
    const CUSTOM_CFG_KEY = '__quenchCustomCfgV1';
    const CUSTOM_RUN_KEY = '__quenchCustomRun';
    const CUSTOM_TAKEOVER_GUARD_KEY = '__quenchCustomTakeoverGuard';
    const CUSTOM_PANEL_NAME = 'customQuenchPanel';
    const CUSTOM_SETTINGS_LAYER_NAME = 'customQuenchSettingsLayer';
    const CUSTOM_SETTINGS_OVERLAY_KEY = '__customQuenchSettingsOverlay';
    const SETTINGS_DIALOG_SORT = 99999;
    const CUSTOM_CFG_DEFAULT = {
        enabled: false,     // 派生总开关：timesOn 或 (targetOn+有词条) 任一成立即接管淬炼按钮
        timesOn: false,     // 次数控制开关
        times: 1000,        // 指定洗炼次数（输入法可自定义）
        targetOn: false,    // 词条控制开关
        targetPct: 100,     // 比例控制：词条达标阈值（attrNum 百分比）
        pctOn: false,       // 比例控制开关（关 = 词条出现即算达标；比例 UI 已移除，默认关）
        targetCnt: 1,       // 兼容字段：未指定词条时需达标的数量
        targetAttrs: []     // 指定词条 attrId 列表（[-]/[+] 增删行）
    };
    function getPickedTargetAttrs(cfg) {
        return normalizeAttrRows(cfg && cfg.targetAttrs).filter(function(row) {
            return row.a > 0;
        });
    }

    function getEffectiveTargetPct(cfg) {
        if (cfg && cfg.pctOn === true) {
            return Math.max(1, Number(cfg.targetPct) || DEFAULT_RATIO_THRESHOLD);
        }
        return 0;
    }

    // 由各分项开关推导总开关
    function deriveCustomEnabled(cfg) {
        const pickedAttrs = getPickedTargetAttrs(cfg);
        return !!(cfg && (cfg.timesOn || (cfg.targetOn && pickedAttrs.length > 0)));
    }
    // 词条颜色（品质）条件：colorId 体系 1白 2绿 3蓝 4紫 5橙 6红；0 = 任意颜色（不限品质）
    const CUSTOM_COLOR_MAP = {
        0: '任意颜色', 1: '白色', 2: '绿色', 3: '蓝色', 4: '紫色', 5: '橙色', 6: '红色'
    };
    // 词条行规范化：旧版纯数字 attrId 数组 → [{a: attrId, c: colorId}]
    function normalizeAttrRows(list) {
        const out = [];
        for (let i = 0; i < (list || []).length; i += 1) {
            const item = list[i];
            if (typeof item === 'number') {
                if (item > 0) {
                    out.push({ a: item, c: 0 });
                } else {
                    out.push({ a: 0, c: 0 });
                }
            } else if (item && typeof item.a !== 'undefined') {
                out.push({ a: Number(item.a) || 0, c: Number(item.c) || 0 });
            }
        }
        return out;
    }
    // 词条 attrId -> 名称（与游戏 QuenchAttrConf 对齐，供指定词条选择 UI 使用）
    const CUSTOM_ATTR_MAP = {
        1: '攻击', 2: '血量', 3: '防御', 4: '速度',
        5: '破甲', 6: '破甲抵抗', 7: '精准', 8: '格挡',
        9: '减伤', 10: '暴击', 11: '暴击抵抗', 12: '爆伤',
        13: '爆伤抵抗', 14: '技能伤害', 15: '免控',
        16: '眩晕免疫', 17: '冰冻免疫', 18: '沉默免疫',
        19: '流血免疫', 20: '中毒免疫', 21: '灼烧免疫'
    };
    // 浅色背景已铺满标记，避免重复改尺寸
    const BLANK_BG_STRETCH_FLAG = '__quenchBlankBgStretched';
    const ENCHANT_SOURCE_KEYS = [
        'm_enchantBtn', 'm_btnEnchant', 'm_enchant', 'm_maskPrivilege',
        'm_equipEnchant', 'm_btnBless', 'm_blessBtn',
        'm_btnPrivilege', 'm_compEnchant', 'm_enchantComp', 'm_mask'
    ];
    const HEADER_ANCHOR_KEYS = [
        'm_btnLock', 'm_btnSetting', 'm_btnSet',
        'm_btnMenu', 'm_btnHelp', 'm_btnRule', 'm_btnTips'
    ];
    const HEADER_GAP = 4;
    const ENCHANT_LAYOUT_ANCHOR_KEYS = [
        'm_btnLock', 'm_btnSetting', 'm_btnMenu', 'm_btnHelp', 'm_btnSet', 'm_btnRule', 'm_btnTips'
    ];
    const ENCHANT_OFFSET_X = -13.0;
    const ENCHANT_OFFSET_Y = 0;
    const SETTINGS_BTN_LAYOUT_W = 48;
    const SETTINGS_BTN_LAYOUT_H = 48;
    const HEADER_ROW_MAX_Y_RATIO = 0.11;
    const HEADER_ROW_MIN_X_RATIO = 0.68;
    const QUENCH_ACCEL_TAG = '[跳过红色-加速]';
    const QUENCH_ACCEL_SPEED = 2.34;
    const QUENCH_ACCEL_LOCK_KEY = '__quenchTimeScaleLocked';
    const CHECK_INTERVAL_MS = 500;
    const MAX_CHECK_COUNT = 120;

    function getModule(name) {
        try {
            return typeof unsafeWindow.__require === 'function' ? unsafeWindow.__require(name) : null;
        } catch (error) {
            return null;
        }
    }

    function getQuenchDialogClass() {
        const mod = getModule('QuenchStageUpDialog');
        return mod && mod.QuenchStageUpDialog ? mod.QuenchStageUpDialog : null;
    }

    function getSkipOrangeToggleClass() {
        const mod = getModule('UI_SkipOrangeToggle');
        return mod && mod.default ? mod.default : null;
    }

    function createSkipRedToggle() {
        const ToggleClass = getSkipOrangeToggleClass();
        if (!ToggleClass || typeof ToggleClass.createInstance !== 'function') {
            return null;
        }

        try {
            const toggle = ToggleClass.createInstance();
            toggle.name = 'skipRedToggle';
            if (toggle.m_title) {
                toggle.m_title.text = '跳过红色';
            }
            if (toggle.m_checkBox) {
                toggle.m_checkBox.selected = false;
            }
            toggle.visible = false;
            return toggle;
        } catch (error) {
            console.error('[跳过红色] 创建跳过红色复选框失败:', error);
            return null;
        }
    }

    function resetRedState(dialog) {
        if (!dialog) {
            return;
        }
        dialog[RED_STATE_KEY] = false;
        dialog[AUTO_CONFIRMING_RED_KEY] = false;
        const toggle = dialog[RED_TOGGLE_KEY];
        if (toggle && toggle.m_checkBox) {
            toggle.m_checkBox.selected = false;
        }
    }

    function updateRedToggleVisible(dialog) {
        const ui = dialog && dialog.ui;
        const toggle = dialog && dialog[RED_TOGGLE_KEY];
        if (!ui || !toggle) {
            return;
        }

        const isVisible = !!dialog._isOpenAuto;
        toggle.visible = isVisible;
        if (!isVisible) {
            resetRedState(dialog);
        }
    }

    function ensureOriginalPositions(dialog) {
        const ui = dialog && dialog.ui;
        if (!ui || !ui.m_autoQuenchToggle || !ui.m_skipOrangeToggle || dialog[ORIGIN_POS_KEY]) {
            return;
        }

        dialog[ORIGIN_POS_KEY] = {
            auto: {
                x: ui.m_autoQuenchToggle.x,
                y: ui.m_autoQuenchToggle.y
            },
            orange: {
                x: ui.m_skipOrangeToggle.x,
                y: ui.m_skipOrangeToggle.y
            }
        };
    }

    function nodeText(node) {
        try {
            if (typeof node.text === 'string' && node.text) {
                return node.text;
            }
        } catch (error) {}
        const titleKeys = ['m_title', 'm_desc', 'm_name', 'm_content', 'm_label'];
        for (let i = 0; i < titleKeys.length; i += 1) {
            try {
                const part = node[titleKeys[i]];
                if (part && typeof part.text === 'string' && part.text) {
                    return part.text;
                }
            } catch (error) {}
        }
        return '';
    }

    function findChildByText(root, keywords) {
        if (typeof keywords === 'string') {
            keywords = [keywords];
        }
        if (!root || typeof root.numChildren !== 'number') {
            return null;
        }
        for (let i = 0; i < root.numChildren; i += 1) {
            const child = root.getChildAt(i);
            if (!child) {
                continue;
            }
            const text = nodeText(child);
            for (let k = 0; k < keywords.length; k += 1) {
                if (text && text.indexOf(keywords[k]) !== -1) {
                    return child;
                }
            }
            const found = findChildByText(child, keywords);
            if (found) {
                return found;
            }
        }
        return null;
    }

    function findEnchantButtonContainer(node) {
        let current = node;
        while (current && current.parent) {
            if (typeof current.onClick === 'function'
                || (current.width > 36 && current.height > 24)) {
                return current;
            }
            current = current.parent;
        }
        return node;
    }

    function getPosInAncestor(node, ancestor) {
        let x = 0;
        let y = 0;
        let current = node;
        while (current && current !== ancestor) {
            x += current.x || 0;
            y += current.y || 0;
            current = current.parent;
        }
        return current === ancestor ? { x, y } : null;
    }

    function findHeaderAnchor(ui) {
        if (!ui) {
            return null;
        }
        for (let i = 0; i < HEADER_ANCHOR_KEYS.length; i += 1) {
            const anchor = ui[HEADER_ANCHOR_KEYS[i]];
            if (anchor && typeof anchor.x === 'number' && typeof anchor.y === 'number') {
                return anchor;
            }
        }
        const candidates = [];
        function scan(node, depth) {
            if (!node || depth > 8) {
                return;
            }
            try {
                if (node.width > 0
                    && node.height > 0
                    && node.width <= 80
                    && node.height <= 80
                    && node.y <= ui.height * 0.18
                    && node.x >= ui.width * 0.55) {
                    candidates.push(node);
                }
            } catch (error) {}
            if (typeof node.numChildren === 'number') {
                for (let j = 0; j < node.numChildren; j += 1) {
                    scan(node.getChildAt(j), depth + 1);
                }
            }
        }
        scan(ui, 0);
        if (!candidates.length) {
            return null;
        }
        candidates.sort(function(a, b) {
            return a.x - b.x;
        });
        return candidates[0];
    }

    function findEnchantLayoutAnchor(ui) {
        if (!ui) {
            return null;
        }
        for (let i = 0; i < ENCHANT_LAYOUT_ANCHOR_KEYS.length; i += 1) {
            const anchor = ui[ENCHANT_LAYOUT_ANCHOR_KEYS[i]];
            if (anchor && typeof anchor.x === 'number' && typeof anchor.y === 'number') {
                return anchor;
            }
        }
        return findHeaderAnchor(ui);
    }

    function collectHeaderButtonRow(ui) {
        if (!ui) {
            return [];
        }
        const seen = new Set();
        const buttons = [];
        function pushBtn(btn) {
            if (!btn || seen.has(btn) || typeof btn.x !== 'number' || typeof btn.y !== 'number') {
                return;
            }
            seen.add(btn);
            buttons.push(btn);
        }
        for (let i = 0; i < ENCHANT_LAYOUT_ANCHOR_KEYS.length; i += 1) {
            pushBtn(ui[ENCHANT_LAYOUT_ANCHOR_KEYS[i]]);
        }
        if (!buttons.length) {
            const candidates = [];
            function scan(node, depth) {
                if (!node || depth > 8) {
                    return;
                }
                try {
                    if (node.width > 24
                        && node.width <= 80
                        && node.height > 24
                        && node.height <= 80
                        && node.y <= ui.height * HEADER_ROW_MAX_Y_RATIO
                        && node.x >= ui.width * HEADER_ROW_MIN_X_RATIO
                        && !seen.has(node)) {
                        candidates.push(node);
                    }
                } catch (error) {}
                if (typeof node.numChildren === 'number') {
                    for (let j = 0; j < node.numChildren; j += 1) {
                        scan(node.getChildAt(j), depth + 1);
                    }
                }
            }
            scan(ui, 0);
            candidates.sort(function(a, b) {
                return a.x - b.x;
            });
            for (let k = 0; k < candidates.length; k += 1) {
                pushBtn(candidates[k]);
            }
        }
        buttons.sort(function(a, b) {
            return a.x - b.x;
        });
        return buttons;
    }

    function averageHeaderButtonGap(ui, buttons) {
        if (!buttons || buttons.length < 2) {
            return HEADER_GAP;
        }
        const gaps = [];
        for (let i = 1; i < buttons.length; i += 1) {
            const prev = buttons[i - 1];
            const next = buttons[i];
            const p0 = getPosInAncestor(prev, ui);
            const p1 = getPosInAncestor(next, ui);
            if (!p0 || !p1) {
                continue;
            }
            const gap = p1.x - (p0.x + prev.width);
            if (gap >= 0 && gap < 80) {
                gaps.push(gap);
            }
        }
        if (!gaps.length) {
            return HEADER_GAP;
        }
        return gaps.reduce(function(sum, gap) {
            return sum + gap;
        }, 0) / gaps.length;
    }

    function headerRowCenterY(ui, buttons) {
        let minY = Infinity;
        let maxY = 0;
        for (let i = 0; i < buttons.length; i += 1) {
            const btn = buttons[i];
            const pos = getPosInAncestor(btn, ui);
            if (!pos) {
                continue;
            }
            minY = Math.min(minY, pos.y);
            maxY = Math.max(maxY, pos.y + btn.height);
        }
        if (!isFinite(minY) || !isFinite(maxY)) {
            return null;
        }
        return (minY + maxY) / 2;
    }

    function dumpEnchantUiKeys(ui) {
        if (!ui || ui.__enchantKeysDumped) {
            return;
        }
        try {
            const keys = Object.keys(ui).filter(function(k) {
                return k.indexOf('m_') === 0;
            });
            const hit = keys.filter(function(k) {
                return /enchant|bless|privilege|mask|gift|ci/i.test(k);
            });
            console.log('[淬炼增强] enchant相关ui字段:', hit.length ? hit.join(', ') : '(无匹配)');
            ui.__enchantKeysDumped = true;
        } catch (error) {}
    }

    function findEnchantSourceByUiKeys(ui) {
        if (!ui) {
            return null;
        }
        const keys = Object.keys(ui);
        for (let i = 0; i < keys.length; i += 1) {
            const key = keys[i];
            if (key.indexOf('m_') !== 0) {
                continue;
            }
            if (/enchant|bless|privilege|mask|gift/i.test(key)) {
                const node = ui[key];
                if (node) {
                    return node;
                }
            }
        }
        return null;
    }

    function findEnchantSource(ui) {
        if (!ui) {
            return null;
        }
        for (let i = 0; i < ENCHANT_SOURCE_KEYS.length; i += 1) {
            const node = ui[ENCHANT_SOURCE_KEYS[i]];
            if (node) {
                return node;
            }
        }
        const byKeyScan = findEnchantSourceByUiKeys(ui);
        if (byKeyScan) {
            return byKeyScan;
        }
        const textNode = findChildByText(ui, ['赐福', '暂无']);
        if (textNode) {
            return findEnchantButtonContainer(textNode);
        }
        const candidates = [];
        function scan(node, depth) {
            if (!node || depth > 10) {
                return;
            }
            try {
                if (node.width > 30
                    && node.height > 20
                    && node.y <= ui.height * 0.22
                    && node.x <= ui.width * 0.38) {
                    candidates.push(node);
                }
            } catch (error) {}
            if (typeof node.numChildren === 'number') {
                for (let j = 0; j < node.numChildren; j += 1) {
                    scan(node.getChildAt(j), depth + 1);
                }
            }
        }
        scan(ui, 0);
        if (!candidates.length) {
            return null;
        }
        candidates.sort(function(a, b) {
            return (a.x + a.y) - (b.x + b.y);
        });
        return candidates[0];
    }

    function isBlessingLabel(text) {
        return !!text && (text.indexOf('赐福') !== -1 || text.indexOf('暂无') !== -1);
    }

    function hideBlessingLabelsOnly(root, depth) {
        if (!root || depth > 12) {
            return;
        }
        if (typeof root.numChildren === 'number') {
            for (let i = 0; i < root.numChildren; i += 1) {
                const child = root.getChildAt(i);
                if (!child) {
                    continue;
                }
                const childText = nodeText(child);
                if (isBlessingLabel(childText)) {
                    try {
                        child.visible = false;
                    } catch (error) {}
                    continue;
                }
                hideBlessingLabelsOnly(child, depth + 1);
            }
        }
    }

    function hideCloneGrayBackground(clone) {
        if (!clone) {
            return;
        }
        const bgKeys = ['m_bg', 'm_background', 'm_frame'];
        for (let i = 0; i < bgKeys.length; i += 1) {
            try {
                if (clone[bgKeys[i]]) {
                    clone[bgKeys[i]].visible = false;
                }
            } catch (error) {}
        }
    }

    function hideTextSlotBesideIcon(clone) {
        if (!clone) {
            return;
        }
        let iconNode = findEnchantIconNode(clone);
        if (!iconNode && typeof clone.numChildren === 'number') {
            for (let i = 0; i < clone.numChildren; i += 1) {
                const child = clone.getChildAt(i);
                if (!child || child.visible === false) {
                    continue;
                }
                if (!nodeText(child) && child.width >= 24 && child.width <= 72) {
                    iconNode = child;
                    break;
                }
            }
        }
        if (!iconNode) {
            return;
        }
        const iconRight = (iconNode.x || 0) + iconNode.width;
        if (typeof clone.numChildren === 'number') {
            for (let j = 0; j < clone.numChildren; j += 1) {
                const child = clone.getChildAt(j);
                if (!child || child === iconNode) {
                    continue;
                }
                try {
                    if ((child.x || 0) >= iconRight - 2) {
                        child.visible = false;
                    }
                } catch (error) {}
            }
        }
        try {
            iconNode.x = 0;
            iconNode.y = 0;
            iconNode.visible = true;
            clone.width = iconNode.width;
            clone.height = iconNode.height;
        } catch (error) {}
    }

    function beautifyEnchantClone(clone) {
        if (!clone) {
            return;
        }
        hideBlessingLabelsOnly(clone, 0);
        hideCloneGrayBackground(clone);
        hideTextSlotBesideIcon(clone);
    }

    function findEnchantIconNode(source) {
        if (!source) {
            return null;
        }
        let best = null;
        function walk(node, depth) {
            if (!node || depth > 8) {
                return;
            }
            const text = nodeText(node);
            if (isBlessingLabel(text)) {
                return;
            }
            try {
                if (node.width >= 24
                    && node.height >= 24
                    && node.width <= 72
                    && node.height <= 72) {
                    if (!best || node.x < best.x) {
                        best = node;
                    }
                }
            } catch (error) {}
            if (typeof node.numChildren === 'number') {
                for (let i = 0; i < node.numChildren; i += 1) {
                    walk(node.getChildAt(i), depth + 1);
                }
            }
        }
        walk(source, 0);
        return best;
    }

    function cloneFguiComponent(source) {
        const fgui = unsafeWindow.fgui;
        if (!source || !fgui) {
            return null;
        }
        try {
            if (source.resourceURL && typeof fgui.UIPackage.createObjectFromURL === 'function') {
                return fgui.UIPackage.createObjectFromURL(source.resourceURL);
            }
            if (source.packageItem && typeof fgui.UIPackage.createObject === 'function') {
                return fgui.UIPackage.createObject(source.packageItem);
            }
            if (typeof source.clone === 'function') {
                return source.clone();
            }
        } catch (error) {
            console.warn('[淬炼增强] 克隆赐福按钮失败:', error);
        }
        return null;
    }

    function triggerSourceClick(source) {
        if (!source) {
            return;
        }
        try {
            const fgui = unsafeWindow.fgui;
            if (fgui && fgui.Event && source.node && typeof source.node.emit === 'function') {
                source.node.emit(fgui.Event.CLICK);
                return;
            }
            if (source.displayObject && typeof source.displayObject.event === 'function' && fgui) {
                source.displayObject.event(fgui.Event.CLICK);
            }
        } catch (error) {}
    }

    const SETTINGS_BTN_CLONE_KEYS = [
        'm_btnSetting', 'm_btnSet', 'm_btnLock',
        'm_btnMenu', 'm_btnHelp', 'm_btnRule', 'm_btnTips'
    ];

    function findSettingsBtnCloneSource(ui) {
        if (!ui) {
            return null;
        }
        for (let i = 0; i < SETTINGS_BTN_CLONE_KEYS.length; i += 1) {
            const node = ui[SETTINGS_BTN_CLONE_KEYS[i]];
            if (node && typeof node.x === 'number' && typeof node.y === 'number') {
                return node;
            }
        }
        return findHeaderAnchor(ui);
    }

    function getSettingsBtnLayoutSize(clone) {
        const w = (clone && clone.width > 0) ? clone.width : SETTINGS_BTN_LAYOUT_W;
        const h = (clone && clone.height > 0) ? clone.height : SETTINGS_BTN_LAYOUT_H;
        return { w, h };
    }

    function stylizeSettingsClone(clone) {
        if (!clone) {
            return;
        }
        if (clone.__isClubSetUpBtn__) {
            try {
                clone.relations?.clearAll?.();
                clone.touchable = true;
                clone.opaque = true;
                clone.__enchantClickTarget__ = clone;
            } catch (error) {}
            return;
        }
        try {
            clone.relations?.clearAll?.();
            if (clone.m_redPoint) {
                clone.m_redPoint.visible = false;
            }
            if (clone.m_showResIcon) {
                clone.m_showResIcon.selectedPage = 'false';
            }
            const title = clone.getChild?.('title') || clone.m_title || null;
            if (title) {
                title.visible = false;
            }
        } catch (error) {}
        try {
            clone.touchable = true;
            clone.opaque = true;
            clone.__enchantClickTarget__ = clone;
        } catch (error) {}
    }

    function applyEnchantCloneClickBounds(clone) {
        if (!clone) {
            return null;
        }
        stylizeSettingsClone(clone);
        return clone;
    }

    function layoutEnchantClone(dialog) {
        const ui = dialog && dialog.ui;
        const clone = dialog && dialog[ENCHANT_CLONE_KEY];
        if (!ui || !clone) {
            return;
        }
        clone.visible = true;
        stylizeSettingsClone(clone);
        const layoutSize = getSettingsBtnLayoutSize(clone);
        const row = collectHeaderButtonRow(ui);
        let placed = false;
        if (row.length) {
            const anchorBtn = ui.m_btnLock || row[0];
            const pos = getPosInAncestor(anchorBtn, ui);
            const gap = Math.max(HEADER_GAP, averageHeaderButtonGap(ui, row));
            const cloneW = layoutSize.w;
            const cloneH = layoutSize.h;
            if (pos) {
                clone.x = Math.max(0, pos.x - cloneW - gap + ENCHANT_OFFSET_X);
                clone.y = pos.y + Math.max(0, (anchorBtn.height - cloneH) / 2) + ENCHANT_OFFSET_Y;
                placed = true;
            }
        }
        if (!placed) {
            const anchor = findEnchantLayoutAnchor(ui);
            if (anchor) {
                const pos = getPosInAncestor(anchor, ui);
                if (pos) {
                    clone.x = Math.max(0, pos.x - layoutSize.w - HEADER_GAP + ENCHANT_OFFSET_X);
                    clone.y = pos.y + Math.max(0, (anchor.height - layoutSize.h) / 2) + ENCHANT_OFFSET_Y;
                    placed = true;
                }
            }
        }
        if (!placed) {
            clone.x = Math.max(0, ui.width - layoutSize.w - 88 + ENCHANT_OFFSET_X);
            clone.y = 10 + ENCHANT_OFFSET_Y;
        }
        try {
            clone.relations?.clearAll?.();
            ui.setChildIndex(clone, ui.numChildren - 1);
        } catch (error) {}
        applyEnchantCloneClickBounds(clone);
        console.log('[淬炼增强] 设置按钮位置', clone.x, clone.y, 'offset', ENCHANT_OFFSET_X, ENCHANT_OFFSET_Y);
    }

    function bindEnchantClone(dialog) {
        const clone = dialog && dialog[ENCHANT_CLONE_KEY];
        if (!clone || clone[ENCHANT_CLICK_KEY]) {
            return;
        }
        const clickTarget = applyEnchantCloneClickBounds(clone) || clone;
        try {
            clickTarget.clearClick?.();
        } catch (error) {}
        try {
            clone.clearClick?.();
        } catch (error) {}
        try {
            clickTarget.onClick(function() {
                openCustomQuenchSettingsOverlay(dialog);
            }, dialog);
            clone[ENCHANT_CLICK_KEY] = true;
        } catch (error) {
            console.error('[淬炼增强] 绑定设置按钮点击失败:', error);
        }
    }

    function createSettingsPanelBtn() {
        return createPackageObject('ui_common', 'btnClubSetUp');
    }

    function ensureEnchantClone(dialog) {
        const ui = dialog && dialog.ui;
        if (!ui) {
            return;
        }
        if (!dialog[ENCHANT_CLONE_KEY]) {
            const clone = createSettingsPanelBtn();
            if (!clone) {
                console.warn('[淬炼增强] ui_common/btnClubSetUp 创建失败');
                return;
            }
            clone.__isClubSetUpBtn__ = true;
            clone.name = 'quenchSettingsBtn';
            clone.visible = true;
            stylizeSettingsClone(clone);
            ui.addChild(clone);
            dialog[ENCHANT_CLONE_KEY] = clone;
            console.log('[淬炼增强] 已创建 ui_common/btnClubSetUp 设置入口');
        }
        stylizeSettingsClone(dialog[ENCHANT_CLONE_KEY]);
        bindEnchantClone(dialog);
        layoutEnchantClone(dialog);
    }

    function refreshEnchantClone(dialog) {
        ensureEnchantClone(dialog);
        layoutEnchantClone(dialog);
    }

    function scheduleEnchantLayout(dialog) {
        refreshEnchantClone(dialog);
        setTimeout(function() {
            refreshEnchantClone(dialog);
        }, 0);
        setTimeout(function() {
            refreshEnchantClone(dialog);
        }, 120);
        setTimeout(function() {
            refreshEnchantClone(dialog);
        }, 400);
    }

    function layoutToggles(dialog) {
        const ui = dialog && dialog.ui;
        const redToggle = dialog && dialog[RED_TOGGLE_KEY];
        if (!ui || !ui.m_autoQuenchToggle || !ui.m_skipOrangeToggle || !redToggle) {
            return;
        }

        const autoToggle = ui.m_autoQuenchToggle;
        const orangeToggle = ui.m_skipOrangeToggle;
        const originalPositions = dialog[ORIGIN_POS_KEY];

        if (!dialog._isOpenAuto) {
            if (originalPositions) {
                autoToggle.x = originalPositions.auto.x;
                autoToggle.y = originalPositions.auto.y;
                orangeToggle.x = originalPositions.orange.x;
                orangeToggle.y = originalPositions.orange.y;
            }
            redToggle.x = orangeToggle.x + orangeToggle.width;
            redToggle.y = orangeToggle.y;
            return;
        }

        const totalWidth = autoToggle.width + orangeToggle.width + redToggle.width;
        const gap = Math.max(0, (ui.width - totalWidth) / 4);
        const baseY = autoToggle.y;

        autoToggle.x = gap;
        orangeToggle.x = autoToggle.x + autoToggle.width + gap;
        redToggle.x = orangeToggle.x + orangeToggle.width + gap;

        autoToggle.y = baseY;
        orangeToggle.y = baseY;
        redToggle.y = baseY;
    }

    function refreshToggleGroup(dialog) {
        updateRedToggleVisible(dialog);
        layoutToggles(dialog);
    }

    function bindRedToggle(dialog) {
        const toggle = dialog && dialog[RED_TOGGLE_KEY];
        if (!toggle || toggle[RED_CLICK_KEY]) {
            return;
        }

        try {
            toggle.clearClick();
        } catch (error) {}

        try {
            toggle.onClick(function() {
                if (!dialog._isOpenAuto) {
                    resetRedState(dialog);
                    return;
                }

                dialog[RED_STATE_KEY] = !dialog[RED_STATE_KEY];
                if (toggle.m_checkBox) {
                    toggle.m_checkBox.selected = dialog[RED_STATE_KEY];
                }
                if (dialog[RED_STATE_KEY]) {
                    dialog._isSkipOrange = true;
                    if (dialog.ui && dialog.ui.m_skipOrangeToggle && dialog.ui.m_skipOrangeToggle.m_checkBox) {
                        dialog.ui.m_skipOrangeToggle.m_checkBox.selected = true;
                    }
                }
            }, dialog);
            toggle[RED_CLICK_KEY] = true;
        } catch (error) {
            console.error('[跳过红色] 绑定跳过红色点击失败:', error);
        }
    }

    function ensureRedToggle(dialog) {
        const ui = dialog && dialog.ui;
        if (!ui || !ui.m_skipOrangeToggle) {
            return;
        }

        ensureOriginalPositions(dialog);

        if (!dialog[RED_TOGGLE_KEY]) {
            const redToggle = createSkipRedToggle();
            if (!redToggle) {
                return;
            }

            ui.addChild(redToggle);
            dialog[RED_TOGGLE_KEY] = redToggle;
            dialog[RED_STATE_KEY] = false;
            dialog[AUTO_CONFIRMING_RED_KEY] = false;
        }

        bindRedToggle(dialog);
        refreshToggleGroup(dialog);
    }

    function applySpineTimeScale(spineEffect) {
        try {
            const target = spineEffect && spineEffect.content;
            if (!target || target[QUENCH_ACCEL_LOCK_KEY]) {
                return;
            }

            Object.defineProperty(target, 'timeScale', {
                get: function() {
                    return QUENCH_ACCEL_SPEED;
                },
                set: function(value) {
                    return value;
                },
                configurable: true
            });
            target[QUENCH_ACCEL_LOCK_KEY] = true;
            console.log(QUENCH_ACCEL_TAG + ' spine timeScale 已锁定为 ' + QUENCH_ACCEL_SPEED + 'x');
        } catch (error) {
            console.warn(QUENCH_ACCEL_TAG + ' applySpineTimeScale error:', error);
        }
    }

    function hookSpineTimeScale(spineEffect) {
        if (!spineEffect) {
            return;
        }

        try {
            if (spineEffect.onLoadComplete && typeof spineEffect.onLoadComplete.addOnce === 'function') {
                spineEffect.onLoadComplete.addOnce(function() {
                    applySpineTimeScale(spineEffect);
                });
            }

            if (spineEffect.content) {
                applySpineTimeScale(spineEffect);
            }
        } catch (error) {
            console.warn(QUENCH_ACCEL_TAG + ' hookSpineTimeScale error:', error);
        }
    }

    function applyQuenchAnimationAccel(dialog) {
        const ui = dialog && dialog.ui;
        if (!ui) {
            return;
        }

        for (let i = 0; i < 10; i += 1) {
            const item = ui['m_item' + i];
            if (item && item.m_spineEffect) {
                hookSpineTimeScale(item.m_spineEffect);
            }
        }
    }

    // ==================== 自定义洗炼：指定次数 / 指定词条（原生接口驱动） ====================
    // 原理：完全复用游戏原生 QuenchStageUpDialog 的自动淬炼链路（_isOpenAuto + _quenchTimes 计数、
    // _updateQuench 定时器、_doEquipQuench 发送），只做计数夹紧与达标检测，不走任何自造协议。

    function loadCustomCfg() {
        try {
            const raw = unsafeWindow.localStorage.getItem(CUSTOM_CFG_KEY);
            if (raw) {
                const cfg = Object.assign({}, CUSTOM_CFG_DEFAULT, JSON.parse(raw));
                if (cfg.pctOn !== false) {
                    cfg.pctOn = false;
                }
                return cfg;
            }
        } catch (error) {}
        return Object.assign({}, CUSTOM_CFG_DEFAULT);
    }

    function saveCustomCfg(cfg) {
        try {
            unsafeWindow.localStorage.setItem(CUSTOM_CFG_KEY, JSON.stringify(cfg));
        } catch (error) {}
    }

    function getQuenchBtnTitle(dialog) {
        const btn = dialog && dialog.ui && dialog.ui.m_btnQuench;
        if (!btn) {
            return null;
        }
        if (btn.m_title && typeof btn.m_title.text === 'string') {
            return btn.m_title;
        }
        try {
            const child = typeof btn.getChild === 'function' ? btn.getChild('title') : null;
            if (child && typeof child.text === 'string') {
                return child;
            }
        } catch (error) {}
        return null;
    }

    // 淬炼按钮上显示进度：淬炼(已洗/目标)
    function updateQuenchBtnProgress(dialog) {
        const run = dialog && dialog[CUSTOM_RUN_KEY];
        const title = getQuenchBtnTitle(dialog);
        if (!run || !title) {
            return;
        }
        if (run.origTitle == null) {
            run.origTitle = title.text;
        }
        try {
            title.text = '淬炼(' + (run.total - run.left) + '/' + run.total + ')';
        } catch (error) {}
    }

    function restoreQuenchBtnTitle(dialog, run) {
        if (!run || run.origTitle == null) {
            return;
        }
        const title = getQuenchBtnTitle(dialog);
        if (title) {
            try {
                title.text = run.origTitle;
            } catch (error) {}
        }
    }

    // 词条达标检测：
    // - 指定了 targetAttrs：每个指定词条都需在未锁定槽位出现且达标，全部满足才停（锁定槽位不计入）
    // - 颜色：row.c=0 任意颜色；row.c=1~6 须与 quench.colorId 精确一致
    // - 未指定：任意未锁定词条达标数量 >= targetCnt 即停
    function checkQuenchTargets(dialog, run) {
        const info = dialog && dialog._equipInfo;
        if (!info || !info.quenches || typeof info.quenches.forEach !== 'function') {
            return false;
        }
        const attrFilter = run.targetAttrs && run.targetAttrs.length ? run.targetAttrs : null;
        if (attrFilter) {
            const satisfied = {};
            info.quenches.forEach(function(quench, slot) {
                const locked = dialog._locks && dialog._locks.has(slot);
                if (locked) {
                    return;
                }
                const attrId = Number(quench.attrId || 0) || 0;
                const colorId = Number(quench.colorId) || 0;
                const num = Number(quench.attrNum) || 0;
                for (let i = 0; i < attrFilter.length; i += 1) {
                    const row = attrFilter[i];
                    if (Number(row.a) === attrId && num >= run.targetPct && (!row.c || colorId === row.c)) {
                        satisfied[i] = true;
                    }
                }
            });
            for (let i = 0; i < attrFilter.length; i += 1) {
                if (!satisfied[i]) {
                    return false;
                }
            }
            return true;
        }
        let hit = 0;
        info.quenches.forEach(function(quench, slot) {
            const locked = dialog._locks && dialog._locks.has(slot);
            if (!locked && Number(quench.attrNum) >= run.targetPct) {
                hit += 1;
            }
        });
        return hit >= (run.targetCnt || 1);
    }

    function startCustomQuench(dialog) {
        if (!dialog || !dialog.isShow || !dialog.ui) {
            console.warn('[指定洗炼] 淬炼面板未打开，无法启动');
            return false;
        }
        const cfg = loadCustomCfg();
        // 次数控制关 = 不限次数（只受词条目标约束）；比例控制关 = 词条出现即算达标
        const times = cfg.timesOn === false ? 99999 : cfg.times;
        const pickedAttrs = getPickedTargetAttrs(cfg);
        const targetOn = !!(cfg.targetOn && pickedAttrs.length);
        const pct = getEffectiveTargetPct(cfg);
        dialog[CUSTOM_RUN_KEY] = {
            left: times,
            total: times,
            targetOn: targetOn,
            targetPct: pct,
            targetCnt: cfg.targetCnt,
            targetAttrs: pickedAttrs,
            origTitle: null
        };
        // 借用原生自动淬炼开关进入连洗状态（_changeAutoState 会同步 UI 勾选）
        if (!dialog._isOpenAuto && typeof dialog._changeAutoState === 'function') {
            try {
                dialog._changeAutoState();
            } catch (error) {}
        }
        dialog._quenchTimes = Math.min(times, dialog.AUTO_QUENCH_TIMES || times);
        updateQuenchBtnProgress(dialog);
        console.log('[指定洗炼] 启动：次数=' + times
            + (targetOn ? (' 词条目标=[' + pickedAttrs.map(function(row) {
                return (CUSTOM_ATTR_MAP[row.a] || row.a) + (row.c ? '·' + (CUSTOM_COLOR_MAP[row.c] || row.c) : '');
            }).join(',') + ']≥' + pct + '%') : ' 无词条目标'));
        return true;
    }

    function stopCustomQuench(dialog, reason) {
        const run = dialog && dialog[CUSTOM_RUN_KEY];
        if (!run) {
            return;
        }
        dialog[CUSTOM_RUN_KEY] = null;
        try {
            dialog._clearQuenchAnims();
        } catch (error) {}
        // 退出原生自动淬炼状态，恢复界面
        if (dialog._isOpenAuto && typeof dialog._changeAutoState === 'function') {
            try {
                dialog._changeAutoState();
            } catch (error) {}
        }
        restoreQuenchBtnTitle(dialog, run);
        console.log('[指定洗炼] 停止（' + (reason || '手动') + '）：已洗 ' + (run.total - run.left) + '/' + run.total);
    }

    // 每次结果刷新后调用：达标/次数用尽则停，否则夹紧原生计数防止被重置回 1000
    function tickCustomQuench(dialog) {
        const run = dialog && dialog[CUSTOM_RUN_KEY];
        if (!run) {
            return;
        }
        if (run.targetOn && checkQuenchTargets(dialog, run)) {
            stopCustomQuench(dialog, '词条达标');
            return;
        }
        if (run.left <= 0) {
            stopCustomQuench(dialog, '次数完成');
            return;
        }
        if (dialog._quenchTimes > run.left) {
            dialog._quenchTimes = run.left;
        }
        updateQuenchBtnProgress(dialog);
    }

    // ==================== 设置面板 UI（对齐 physics.25d44 原生 fgui 风格） ====================

    const NIGHTMARE_CHALLENGE_LIST_NATIVE_WIDTH = 225;

    const DIALOG_LAYOUT = {
        tipWidth: 660,
        tipHeight: 500,
        tipY: 0,
        formX: 0,
        formY: 20,
        formWidth: 530,
        startY: 4,
        rowHeight: 44,
        rowGap: 15,
        entryToCountControlGap: 25,
        entryRowGap: 25,
        toggleRowGap: 15,
        countInputTitleGap: 20,
        lastDropdownExtraHeight: 0,
        labelWidth: 104,
        selectorWidth: 190,
        attrSelectorWidth: 225,
        colorSelectorWidth: 225,
        selectorGap: 24,
        inputWidth: 110,
        inputHeight: 42,
        unitWidth: 28,
        relationLabelWidth: 28,
        entryToggleRowHeight: 42,
        entryConditionRowHeight: 42,
        entryActionGap: 22,
        entryActionAfterLabelGap: 12,
        entryActionRightPadding: 6,
        entryConditionGap: 18,
        entryIndentX: 0,
        buttonHeight: 42,
        entryActionBtnWidth: 58,
        entryActionBtnHeight: 44,
        buttonGap: 10,
        startButtonTopGap: 48,
        saveButtonExtraYOffset: 12,
        bottomPadding: 34,
        bottomWoodSafePadding: 44,
        tipBgOverscanX: 8
    };

    const ENTRY_LIMIT = {
        minRows: 1,
        maxRows: 5
    };

    const DEFAULT_RATIO_THRESHOLD = 100;

    let cachedSettingsLabelColor = null;
    let settingsPackagesWarmupStarted = false;

    function getUiPackageLoaders() {
        const fguiExt = getModule('FguiExt') || getModule('extension/FguiExt');
        const indexUi = getModule('index-ui');
        const resMgr = getModule('ResourceManager');
        const loaders = [];
        if (fguiExt && typeof fguiExt.TRY_LOAD_UI === 'function') {
            loaders.push({ fn: fguiExt.TRY_LOAD_UI, owner: fguiExt });
        }
        if (fguiExt && typeof fguiExt.LOAD_UI === 'function') {
            loaders.push({ fn: fguiExt.LOAD_UI, owner: fguiExt });
        }
        if (indexUi && typeof indexUi.TRY_LOAD_UI === 'function') {
            loaders.push({ fn: indexUi.TRY_LOAD_UI, owner: indexUi });
        }
        if (indexUi && typeof indexUi.LOAD_UI === 'function') {
            loaders.push({ fn: indexUi.LOAD_UI, owner: indexUi });
        }
        if (resMgr?.ResourceManager?.instance && typeof resMgr.ResourceManager.instance.loadFGUI === 'function') {
            loaders.push({ fn: resMgr.ResourceManager.instance.loadFGUI, owner: resMgr.ResourceManager.instance });
        }
        if (typeof unsafeWindow.TRY_LOAD_UI === 'function') {
            loaders.push({ fn: unsafeWindow.TRY_LOAD_UI, owner: unsafeWindow });
        }
        if (typeof unsafeWindow.LOAD_UI === 'function') {
            loaders.push({ fn: unsafeWindow.LOAD_UI, owner: unsafeWindow });
        }
        return loaders;
    }

    function ensurePackageLoaded(pkgName) {
        const fgui = unsafeWindow.fgui;
        if (!fgui?.UIPackage) {
            return null;
        }
        let pkg = null;
        try {
            pkg = fgui.UIPackage.getByName ? fgui.UIPackage.getByName(pkgName) : null;
        } catch (error) {}
        if (pkg) {
            return pkg;
        }
        const loaders = getUiPackageLoaders();
        for (let i = 0; i < loaders.length && !pkg; i += 1) {
            const loader = loaders[i];
            try {
                const result = loader.fn.call(loader.owner, pkgName);
                if (result && typeof result.then === 'function') {
                    result.catch(function() {});
                }
            } catch (error) {}
            try {
                pkg = fgui.UIPackage.getByName ? fgui.UIPackage.getByName(pkgName) : null;
            } catch (error) {}
        }
        try {
            const binder = getModule(`${pkgName}Binder`);
            const binderObj = binder && (binder.default || binder);
            if (binderObj && typeof binderObj.bindAll === 'function') {
                binderObj.bindAll();
            }
        } catch (error) {}
        try {
            return fgui.UIPackage.getByName ? fgui.UIPackage.getByName(pkgName) : null;
        } catch (error) {
            return null;
        }
    }

    function warmupSettingsPackages() {
        if (settingsPackagesWarmupStarted) {
            return;
        }
        settingsPackagesWarmupStarted = true;
        ['ui_common', 'ui_teamUp', 'ui_equipQuench'].forEach(function(pkgName) {
            try {
                ensurePackageLoaded(pkgName);
            } catch (error) {}
        });
    }

    function createPackageObject(pkgName, compName, classModuleName) {
        ensurePackageLoaded(pkgName);
        const fgui = unsafeWindow.fgui;
        if (!fgui) {
            return null;
        }
        let obj = null;
        try {
            obj = fgui.UIPackage?.createObject?.(pkgName, compName) || null;
        } catch (error) {}
        if (!obj && classModuleName) {
            try {
                const mod = getModule(classModuleName);
                const clazz = mod && (mod.default || mod);
                if (clazz && typeof clazz.createInstance === 'function') {
                    obj = clazz.createInstance();
                }
            } catch (error) {}
        }
        return obj && (obj.asButton || obj.asCom || obj) || null;
    }

    function removeFromParent(target) {
        try {
            target?.removeFromParent?.();
        } catch (error) {}
    }

    function bindClick(target, handler, context) {
        if (!target || typeof handler !== 'function') {
            return false;
        }
        try {
            target.clearClick?.();
        } catch (error) {}
        try {
            if (typeof target.onClick === 'function') {
                target.onClick(handler, context || null);
                return true;
            }
        } catch (error) {}
        try {
            if (target.displayObject && typeof target.displayObject.on === 'function') {
                target.displayObject.on('click', handler, context || null);
                return true;
            }
        } catch (error) {}
        return false;
    }

    function setComponentText(target, text) {
        if (!target) {
            return;
        }
        const queue = [target];
        const visited = new Set();
        while (queue.length) {
            const node = queue.shift();
            if (!node || visited.has(node)) {
                continue;
            }
            visited.add(node);
            try {
                if (node.title !== undefined) {
                    node.title = text;
                }
            } catch (error) {}
            try {
                if (node.text !== undefined) {
                    node.text = text;
                }
            } catch (error) {}
            for (let i = 0; i < Number(node.numChildren || 0); i += 1) {
                try {
                    queue.push(node.getChildAt(i));
                } catch (error) {}
            }
        }
    }

    function setButtonEnabled(button, enabled) {
        if (!button) {
            return;
        }
        const active = !!enabled;
        try { button.grayed = !active; } catch (error) {}
        try { button.touchable = active; } catch (error) {}
        try { button.mouseEnabled = active; } catch (error) {}
    }

    function createTextLabel(text, width, height, fontSize, color) {
        const fgui = unsafeWindow.fgui;
        if (!fgui || typeof fgui.GTextField !== 'function') {
            return null;
        }
        const label = new fgui.GTextField();
        label.text = text || '';
        label.fontSize = fontSize || 24;
        label.color = color || getNativeSettingsLabelColor();
        label.align = fgui.AlignType?.Center ?? 1;
        label.verticalAlign = fgui.VertAlignType?.Middle ?? 1;
        label.singleLine = false;
        label.wordWrap = false;
        label.setSize?.(width || 160, height || 36);
        return label;
    }

    function getNativeSettingsLabelColor() {
        if (cachedSettingsLabelColor) {
            return cachedSettingsLabelColor;
        }
        const toggle = createPackageObject('ui_common', 'BtnFilter', 'UI_BtnFilter');
        const title = toggle?.m_title || toggle?.getChild?.('title') || null;
        const color = title && title.color !== undefined && title.color !== null ? title.color : '';
        cachedSettingsLabelColor = color || '#6b3f24';
        removeFromParent(toggle);
        return cachedSettingsLabelColor;
    }

    function setObjectCenterY(target, centerY) {
        if (!target) {
            return;
        }
        const height = Number(target.height || 0) * Number(target.scaleY || 1);
        try { target.y = Math.round(Number(centerY || 0) - height / 2); } catch (error) {}
    }

    function getToggleRightEdge(toggle) {
        if (!toggle) {
            return DIALOG_LAYOUT.labelWidth;
        }
        return Math.round(
            Number(toggle.x || 0)
            + Number(toggle.width || 0) * Number(toggle.scaleX || 1)
        );
    }

    function getToggleLabelRightEdge(toggle) {
        if (!toggle) {
            return 0;
        }
        const baseX = Number(toggle.x || 0);
        let right = baseX;
        const checkBox = toggle.m_checkBox || toggle.getChild?.('checkBox') || toggle.getChild?.('n2');
        if (checkBox) {
            right = Math.max(
                right,
                baseX + Number(checkBox.x || 0) + getObjectLayoutWidth(checkBox)
            );
        }
        const title = toggle.m_title || toggle.getChild?.('title') || null;
        if (title) {
            right = Math.max(
                right,
                baseX + Number(title.x || 0) + getObjectLayoutWidth(title)
            );
        }
        return Math.round(right);
    }

    function getEntryActionStartX(toggle) {
        return getToggleLabelRightEdge(toggle) + DIALOG_LAYOUT.entryActionAfterLabelGap;
    }

    function getCountInputStartX(toggle) {
        return getToggleLabelRightEdge(toggle) + DIALOG_LAYOUT.countInputTitleGap;
    }

    function getSettingsRowCenterY(rowHeight) {
        return Number(rowHeight || DIALOG_LAYOUT.rowHeight) / 2;
    }

    function getObjectLayoutWidth(target) {
        if (!target) {
            return 0;
        }
        return Math.max(0, Number(target.width || 0) * Number(target.scaleX || 1));
    }

    function getObjectLayoutHeight(target) {
        if (!target) {
            return 0;
        }
        return Math.max(0, Number(target.height || 0) * Number(target.scaleY || 1));
    }

    function wrapSelectorInSlot(selector, slotWidth, rowHeight) {
        const fgui = unsafeWindow.fgui;
        if (!fgui || !selector || typeof fgui.GComponent !== 'function') {
            return null;
        }
        const slotH = rowHeight || DIALOG_LAYOUT.entryConditionRowHeight;
        const slotW = Math.max(80, Number(slotWidth || 0) || DIALOG_LAYOUT.attrSelectorWidth);
        const wrapper = new fgui.GComponent();
        wrapper.setSize(slotW, slotH);
        const nativeW = Math.max(
            NIGHTMARE_CHALLENGE_LIST_NATIVE_WIDTH,
            Number(selector.width || 0) * Number(selector.scaleX || 1) || 0
        );
        const scaleX = slotW / nativeW;
        try { selector.setScale?.(scaleX, 1); } catch (error) {}
        try { selector.scaleX = scaleX; } catch (error) {}
        try { selector.scaleY = 1; } catch (error) {}
        selector.x = 0;
        setObjectCenterY(selector, slotH / 2);
        wrapper.addChild(selector);
        return wrapper;
    }

    function fitSelectorToWidth(selector, targetWidth) {
        if (!selector) {
            return 0;
        }
        const target = Math.max(80, Number(targetWidth || 0) || DIALOG_LAYOUT.attrSelectorWidth);
        const nativeW = Math.max(1, Number(selector.width || target));
        const scaleX = Math.min(1, target / nativeW);
        try { selector.setScale?.(scaleX, 1); } catch (error) {}
        try { selector.scaleX = scaleX; } catch (error) {}
        try { selector.scaleY = 1; } catch (error) {}
        return getObjectLayoutWidth(selector) || target;
    }

    function applySelectorLayoutSize(selector, width, height) {
        if (!selector) {
            return;
        }
        const h = height || DIALOG_LAYOUT.entryConditionRowHeight;
        try { selector.setSize?.(width, h); } catch (error) {}
        try { selector.width = width; } catch (error) {}
        try { selector.height = h; } catch (error) {}
    }

    function layoutEntryActionButtons(minus, plus, rowWidth, rowHeight, anchorToggle) {
        const gap = DIALOG_LAYOUT.entryActionGap;
        const plusW = getObjectLayoutWidth(plus) || DIALOG_LAYOUT.entryActionBtnWidth;
        const minusW = getObjectLayoutWidth(minus) || DIALOG_LAYOUT.entryActionBtnWidth;
        const centerY = getSettingsRowCenterY(rowHeight);
        let minusX;
        let plusX;
        if (anchorToggle) {
            const startX = getEntryActionStartX(anchorToggle);
            minusX = startX;
            plusX = startX + minusW + gap;
            setObjectCenterY(anchorToggle, centerY);
        } else {
            const rightPad = DIALOG_LAYOUT.entryActionRightPadding;
            plusX = Math.max(0, Number(rowWidth || 0) - rightPad - plusW);
            minusX = Math.max(0, plusX - gap - minusW);
        }
        if (minus) {
            minus.x = Math.round(minusX);
            setObjectCenterY(minus, centerY);
        }
        if (plus) {
            plus.x = Math.round(plusX);
            setObjectCenterY(plus, centerY);
        }
    }

    function scheduleSettingsUiRefresh(popup) {
        if (!popup) {
            return;
        }
        [0, 120, 400].forEach(function(delay) {
            setTimeout(function() {
                if (!popup?.contentHost?.parent) {
                    return;
                }
                try {
                    warmupSettingsPackages();
                    renderCustomQuenchSettings(popup);
                } catch (error) {}
            }, delay);
        });
    }

    function settingsUiNeedsRefresh(popup) {
        if (!popup?.contentHost || typeof popup.contentHost.getChildAt !== 'function') {
            return false;
        }
        const settings = normalizeCustomSettings(popup.settings);
        if (settings.entryControl === false || settings.entryRows < 1) {
            return false;
        }
        let entryRowCount = 0;
        let selectorCount = 0;
        for (let i = 0; i < Number(popup.contentHost.numChildren || 0); i += 1) {
            const row = popup.contentHost.getChildAt?.(i);
            if (!row || typeof row.getChildAt !== 'function') {
                continue;
            }
            for (let j = 0; j < Number(row.numChildren || 0); j += 1) {
                const child = row.getChildAt?.(j);
                const name = String(child?.name || '');
                if (name.indexOf('customQuenchAttrSelector') >= 0) {
                    entryRowCount += 1;
                    selectorCount += 1;
                }
            }
        }
        return entryRowCount < settings.entryRows || selectorCount < settings.entryRows;
    }

    function moveChildToFront(parent, child) {
        if (!parent || !child) {
            return;
        }
        try {
            parent.setChildIndex?.(child, Number(parent.numChildren || 1) - 1);
        } catch (error) {}
    }

    function getTipContentArea(tipBg) {
        return tipBg?.m_content || tipBg?.getChild?.('content') || null;
    }

    function syncCommonComplexTipBackground(tipBg) {
        if (!tipBg) {
            return;
        }
        let bg = null;
        try {
            bg = tipBg.getChildAt?.(0) || null;
        } catch (error) {}
        if (!bg) {
            return;
        }
        const overscanX = Math.max(0, Number(DIALOG_LAYOUT.tipBgOverscanX || 0) || 0);
        const bgWidth = Math.max(0, Number(tipBg.width || 0) + overscanX * 2);
        try { bg.x = -overscanX; } catch (error) {}
        try { bg.y = 0; } catch (error) {}
        try { bg.setSize?.(bgWidth, Number(tipBg.height || 0)); } catch (error) {}
        try { bg.width = Number(bgWidth || bg.width || 0); } catch (error) {}
        try { bg.height = Number(tipBg.height || bg.height || 0); } catch (error) {}
    }

    function prepareCommonComplexTip(tipBg) {
        try { if (tipBg.m_hasImage) tipBg.m_hasImage.selectedPage = 'false'; } catch (error) {}
        try { if (tipBg.m_displayType) tipBg.m_displayType.selectedPage = '0'; } catch (error) {}
        ['m_content', 'm_image', 'm_subContent', 'm_btnPrevious', 'm_btnNext', 'm_btnDetail', 'm_btnDetail2', 'm_page', 'm_subTitle'].forEach(function(key) {
            try {
                if (key !== 'm_content' && tipBg[key]) {
                    tipBg[key].visible = false;
                    tipBg[key].touchable = false;
                    tipBg[key].alpha = 0;
                }
            } catch (error) {}
        });
        syncCommonComplexTipBackground(tipBg);
    }

    function hideNativeTipContent(tipContent) {
        if (!tipContent) {
            return;
        }
        tipContent.touchable = true;
        for (let i = 0; i < Number(tipContent.numChildren || 0); i += 1) {
            const child = tipContent.getChildAt?.(i);
            if (!child) {
                continue;
            }
            child.visible = false;
            child.touchable = false;
            child.alpha = 0;
        }
    }

    function showTip(content) {
        if (!content) {
            return;
        }
        try {
            const tipsManager = getModule('TipsManager');
            const manager = tipsManager && (tipsManager.instance || tipsManager.TipsManager?.instance);
            const indexUi = getModule('index-ui');
            const layer = indexUi?.UILayer && (indexUi.UILayer.Console || indexUi.UILayer.Tip);
            if (manager && typeof manager.showTip === 'function') {
                manager.showTip(content, null, 0, layer);
                return;
            }
            if (typeof tipsManager?.SHOW_TIP === 'function') {
                tipsManager.SHOW_TIP(content);
            }
        } catch (error) {}
    }

    function showOverlayTip(popup, content) {
        if (!content) {
            return;
        }
        let tipLayer = null;
        let prevSort = null;
        try {
            const indexUi = getModule('index-ui');
            tipLayer = indexUi?.UILayer?.Tip || indexUi?.UILayer?.Console || null;
            if (tipLayer && tipLayer.sortingOrder !== undefined && tipLayer.sortingOrder !== null) {
                prevSort = tipLayer.sortingOrder;
                tipLayer.sortingOrder = SETTINGS_DIALOG_SORT + 100;
            }
            const tipsManager = getModule('TipsManager');
            if (typeof tipsManager?.SHOW_TIP === 'function') {
                tipsManager.SHOW_TIP(content);
                return;
            }
            const manager = tipsManager && (tipsManager.instance || tipsManager.TipsManager?.instance);
            if (manager && typeof manager.showTip === 'function') {
                manager.showTip(content, null, 0, tipLayer);
                return;
            }
            showTip(content);
        } catch (error) {
            showTip(content);
        } finally {
            if (tipLayer && prevSort !== null) {
                setTimeout(function() {
                    try { tipLayer.sortingOrder = prevSort; } catch (restoreError) {}
                }, 2200);
            }
        }
    }

    function applySystemDefaultFont(target) {
        if (!target) {
            return;
        }
        const queue = [target];
        const visited = new Set();
        while (queue.length) {
            const node = queue.shift();
            if (!node || visited.has(node)) {
                continue;
            }
            visited.add(node);
            try {
                if (node.font !== undefined) {
                    node.font = '';
                }
            } catch (error) {}
            try {
                if (node.fontName !== undefined) {
                    node.fontName = '';
                }
            } catch (error) {}
            try {
                if (node.displayObject && node.displayObject.font !== undefined) {
                    node.displayObject.font = '';
                }
            } catch (error) {}
            try {
                const textField = node.getTextField?.();
                if (textField && textField !== node) {
                    queue.push(textField);
                }
            } catch (error) {}
            for (let i = 0; i < Number(node.numChildren || 0); i += 1) {
                try {
                    queue.push(node.getChildAt(i));
                } catch (error) {}
            }
        }
    }

    function applyOptionTitleColor(title, option) {
        if (!title || !option || !option.color) {
            return;
        }
        try {
            const cc = unsafeWindow.cc;
            if (cc && cc.Color) {
                title.color = new cc.Color(option.color[0], option.color[1], option.color[2], option.color[3]);
            }
        } catch (error) {}
    }

    function getSettingsInputValue(inputComp, minValue) {
        const input = inputComp?.m_input || inputComp?.getChild?.('input') || inputComp?.getChild?.('lockPassword') || inputComp;
        const raw = String(input?.text || '').trim();
        if (!raw) {
            return null;
        }
        const value = Math.max(Number(minValue || 1), Number(raw) || 0);
        return Number.isFinite(value) && value > 0 ? value : null;
    }

    function configureSettingsInputField(inputComp, placeholder, value, maxLength) {
        if (!inputComp) {
            return;
        }
        const input = inputComp.m_input || inputComp.getChild?.('input') || inputComp.getChild?.('lockPassword') || inputComp;
        const counter = inputComp.m_num || inputComp.getChild?.('num') || null;
        const bg = inputComp.getChildAt?.(0) || inputComp.getChild?.('n15') || null;
        const inputWidth = Math.max(0, Number(inputComp.width || 0) - 10);
        if (bg) {
            try { bg.width = Number(inputComp.width || bg.width || 0); } catch (error) {}
            try { bg.setSize?.(Number(inputComp.width || bg.width || 0), Number(inputComp.height || bg.height || 0)); } catch (error) {}
        }
        if (input) {
            try { input.x = 5; } catch (error) {}
            try { input.width = inputWidth; } catch (error) {}
            try { input.setSize?.(inputWidth, Number(input.height || 0)); } catch (error) {}
            try { input.text = String(value || ''); } catch (error) {}
            try { input.promptText = placeholder || ''; } catch (error) {}
            try { input.maxLength = Number(maxLength || 4); } catch (error) {}
            try { input.restrict = '0-9'; } catch (error) {}
            try { input.password = false; } catch (error) {}
            try { input.singleLine = true; } catch (error) {}
            try { input.verticalAlign = unsafeWindow.fgui?.VertAlignType?.Middle ?? 1; } catch (error) {}
            try { input.background = false; } catch (error) {}
            try { input.opaque = false; } catch (error) {}
        }
        if (counter) {
            try { counter.visible = false; } catch (error) {}
        }
        const editBox = input?._editBox || null;
        const ccRef = unsafeWindow.cc;
        if (editBox && ccRef?.EditBox) {
            try { editBox.enabled = true; } catch (error) {}
            try { editBox.inputMode = ccRef.EditBox.InputMode.SINGLE_LINE; } catch (error) {}
            try { editBox.returnType = ccRef.EditBox.KeyboardReturnType.DONE; } catch (error) {}
            try { editBox.inputFlag = ccRef.EditBox.InputFlag.DEFAULT; } catch (error) {}
            try { editBox.placeholder = placeholder || ''; } catch (error) {}
        }
    }

    function findNativeInputBackground(container, inputComp) {
        if (!container || !inputComp || typeof container.getChildAt !== 'function' || typeof container.getChildIndex !== 'function') {
            return null;
        }
        const inputIndex = Number(container.getChildIndex(inputComp));
        if (inputIndex < 0) {
            return null;
        }
        const inputName = String(inputComp.name || '');
        const exactBackgroundMap = {
            lockPassword: 'n3',
            unlockPassword: 'n28',
            forceUnlockPassword: 'n55'
        };
        const exactBgName = exactBackgroundMap[inputName] || '';
        if (exactBgName) {
            for (let i = inputIndex - 1; i >= 0; i -= 1) {
                const child = container.getChildAt(i);
                if (String(child?.name || '') === exactBgName) {
                    return child;
                }
            }
        }
        return inputIndex > 0 ? container.getChildAt(inputIndex - 1) : null;
    }

    function wrapSettingsInputWithBackground(nativeInput, nativeBackground) {
        const fgui = unsafeWindow.fgui;
        if (!nativeInput || !fgui || typeof fgui.GComponent !== 'function' || typeof fgui.GGraph !== 'function') {
            return nativeInput;
        }
        const wrapper = new fgui.GComponent();
        wrapper.name = 'customQuenchInput';
        wrapper.setSize(DIALOG_LAYOUT.inputWidth, DIALOG_LAYOUT.inputHeight);
        const bg = nativeBackground || new fgui.GGraph();
        bg.name = 'bg';
        if (!nativeBackground) {
            bg.drawRect(1, '#9C8578', '#C8AB9A');
        }
        try { bg.removeFromParent?.(); } catch (error) {}
        bg.x = 0;
        bg.y = 0;
        try { bg.setSize?.(DIALOG_LAYOUT.inputWidth, DIALOG_LAYOUT.inputHeight); } catch (error) {}
        try { bg.width = DIALOG_LAYOUT.inputWidth; bg.height = DIALOG_LAYOUT.inputHeight; } catch (error) {}
        wrapper.addChild(bg);
        try { nativeInput.removeFromParent?.(); } catch (error) {}
        nativeInput.name = 'input';
        nativeInput.x = 8;
        nativeInput.y = Math.max(0, Math.round((DIALOG_LAYOUT.inputHeight - Number(nativeInput.height || DIALOG_LAYOUT.inputHeight)) / 2));
        try { nativeInput.setSize?.(DIALOG_LAYOUT.inputWidth - 16, Math.max(0, Number(nativeInput.height || DIALOG_LAYOUT.inputHeight))); } catch (error) {}
        try { nativeInput.width = DIALOG_LAYOUT.inputWidth - 16; } catch (error) {}
        wrapper.addChild(nativeInput);
        return wrapper;
    }

    function createFallbackSettingsValueInput(value, placeholder, maxLength) {
        const fgui = unsafeWindow.fgui;
        if (!fgui || typeof fgui.GComponent !== 'function' || typeof fgui.GGraph !== 'function') {
            return null;
        }
        const comp = new fgui.GComponent();
        comp.name = 'customQuenchInput';
        comp.setSize(DIALOG_LAYOUT.inputWidth, DIALOG_LAYOUT.inputHeight);
        const bg = new fgui.GGraph();
        bg.drawRect(1, '#9C8578', '#C8AB9A');
        bg.setSize(DIALOG_LAYOUT.inputWidth, DIALOG_LAYOUT.inputHeight);
        comp.addChild(bg);
        let input = null;
        if (typeof fgui.GTextInput === 'function') {
            input = new fgui.GTextInput();
        } else if (typeof fgui.GTextField === 'function') {
            input = new fgui.GTextField();
        }
        if (!input) {
            return comp;
        }
        input.name = 'input';
        input.setSize(DIALOG_LAYOUT.inputWidth - 16, DIALOG_LAYOUT.inputHeight);
        input.x = 8;
        input.y = 0;
        input.fontSize = 22;
        input.text = String(value || '');
        input.promptText = placeholder || '';
        input.color = '#333333';
        try { input.maxLength = Number(maxLength || 4); } catch (error) {}
        try { input.restrict = '0-9'; } catch (error) {}
        try { input.singleLine = true; } catch (error) {}
        try { input.verticalAlign = fgui.VertAlignType?.Middle ?? 1; } catch (error) {}
        try { input.background = false; } catch (error) {}
        comp.addChild(input);
        return comp;
    }

    function createNativeQuenchValueInput(value, placeholder, maxLength) {
        const quenchPasswordDialog = createPackageObject('ui_equipQuench', 'QuenchPasswordDialog', 'UI_QuenchPasswordDialog');
        const inputComp = quenchPasswordDialog?.m_lockPassword || quenchPasswordDialog?.getChild?.('lockPassword') || null;
        if (!quenchPasswordDialog || !inputComp) {
            return null;
        }
        const nativeBackground = findNativeInputBackground(quenchPasswordDialog, inputComp);
        const wrappedInput = wrapSettingsInputWithBackground(inputComp, nativeBackground);
        wrappedInput.name = 'customQuenchInput';
        wrappedInput.setSize?.(DIALOG_LAYOUT.inputWidth, DIALOG_LAYOUT.inputHeight);
        configureSettingsInputField(wrappedInput, placeholder, value, maxLength);
        return wrappedInput;
    }

    function createSettingsValueInput(value, placeholder, maxLength, name) {
        let inputComp = null;
        try {
            inputComp = createNativeQuenchValueInput(value, placeholder, maxLength);
        } catch (error) {}
        if (!inputComp) {
            inputComp = createFallbackSettingsValueInput(value, placeholder, maxLength);
        }
        if (inputComp) {
            inputComp.name = name || 'customQuenchInput';
        }
        return inputComp;
    }

    function bindSettingsInputChange(inputComp, onChange) {
        const fgui = unsafeWindow.fgui;
        const input = inputComp?.m_input || inputComp?.getChild?.('input') || inputComp?.getChild?.('lockPassword') || null;
        if (!input || typeof onChange !== 'function') {
            return;
        }
        function commit() {
            const val = getSettingsInputValue(inputComp, 1);
            if (val !== null) {
                onChange(val);
            }
        }
        try {
            input.on(fgui.Event.TEXT_CHANGE, commit, input);
        } catch (error) {}
        try {
            input.on(fgui.Event.FOCUS_OUT, commit, input);
        } catch (error) {}
    }

    function getChallengeListNode(comp) {
        return comp?.m_list || comp?.getChild?.('list') || null;
    }

    function setChallengeListTitle(comp, text) {
        try {
            if (comp?.m_title) {
                comp.m_title.text = text;
                applySystemDefaultFont(comp.m_title);
                return;
            }
            const title = comp?.getChild?.('title');
            if (title) {
                title.text = text;
                applySystemDefaultFont(title);
            }
        } catch (error) {}
    }

    function setChallengeListVisible(comp, visible) {
        const list = getChallengeListNode(comp);
        try { if (list) list.visible = !!visible; } catch (error) {}
        const bg = comp?.getChild?.('n1');
        try { if (bg) bg.visible = !!visible; } catch (error) {}
    }

    function setChallengeListExpanded(comp, expanded) {
        try {
            const ctrl = comp?.m_isExpand || comp?.getController?.('isExpand');
            if (ctrl) {
                ctrl.selectedPage = String(!!expanded);
            }
        } catch (error) {}
    }

    function syncChallengeListDropdownLayout(comp, visibleItems) {
        const list = getChallengeListNode(comp);
        if (!comp || !list) {
            return;
        }
        const itemHeight = 51;
        const itemWidth = 200;
        const visibleCount = Math.max(1, Number(visibleItems || 5));
        const itemCount = Math.max(1, Number(list.numChildren || list.numItems || visibleCount));
        const displayCount = Math.min(visibleCount, itemCount);
        const listHeight = displayCount * itemHeight;
        const popupBg = comp.getChild?.('n1');
        if (popupBg) {
            try { popupBg.x = 5; popupBg.y = 47; } catch (error) {}
            try { popupBg.setSize?.(225, listHeight + 20); } catch (error) {}
            try { popupBg.width = 225; popupBg.height = listHeight + 20; } catch (error) {}
        }
        try { list.x = 17; list.y = 57; } catch (error) {}
        try { list.setSize?.(itemWidth, listHeight); } catch (error) {}
        try { list.width = itemWidth; list.height = listHeight; } catch (error) {}
        for (let i = 0; i < Number(list.numChildren || 0); i += 1) {
            const item = list.getChildAt?.(i);
            if (!item) {
                continue;
            }
            try { item.x = 0; item.y = i * itemHeight; } catch (error) {}
            try { item.setSize?.(itemWidth, itemHeight); } catch (error) {}
            try { item.width = itemWidth; item.height = itemHeight; } catch (error) {}
            const title = item.m_title || item.getChild?.('title');
            if (title) {
                try { title.y = 10; title.height = 34; title.verticalAlign = unsafeWindow.fgui?.VertAlignType?.Middle ?? 1; } catch (error) {}
                applySystemDefaultFont(title);
            }
        }
    }

    function createChallengeListSelector(name, placeholder, options, selectedValue, onExpandedChange, onSelect, fixedWidth) {
        const selector = createPackageObject('ui_teamUp', 'NightmareChallengeList', 'UI_NightmareChallengeList');
        if (!selector) {
            return null;
        }
        const comp = selector.asCom || selector;
        comp.name = name || 'customQuenchSelector';
        comp.touchable = true;
        comp.__multiQuenchExpanded = false;
        comp.__multiQuenchSuppressToggleOnce = false;
        const selectorHeight = DIALOG_LAYOUT.entryConditionRowHeight;
        if (fixedWidth) {
            applySelectorLayoutSize(comp, fixedWidth, selectorHeight);
        } else {
            try { comp.height = selectorHeight; } catch (error) {}
        }
        setChallengeListExpanded(comp, false);
        setChallengeListVisible(comp, false);

        const listNode = getChallengeListNode(comp);
        const normalizedOptions = Array.isArray(options) && options.length ? options : [{
            value: 0,
            label: placeholder || '词条选择'
        }];
        if (listNode) {
            try { listNode.removeChildren?.(0, -1, true); } catch (error) {}
        }
        const initialOption = normalizedOptions.find(function(item) {
            return Number(item.value || 0) === Number(selectedValue || 0);
        }) || null;
        setChallengeListTitle(comp, initialOption?.label || placeholder || normalizedOptions[0]?.label || '词条选择');

        normalizedOptions.forEach(function(option) {
            const item = createPackageObject('ui_teamUp', 'NightmareChallengeListitem', 'UI_NightmareChallengeListitem');
            const itemComp = item && (item.asCom || item);
            if (!itemComp) {
                return;
            }
            itemComp.touchable = true;
            try {
                const title = itemComp.m_title || itemComp.getChild?.('title');
                if (title) {
                    title.text = option.label;
                    applySystemDefaultFont(title);
                    applyOptionTitleColor(title, option);
                }
            } catch (error) {}
            bindClick(itemComp, function() {
                comp.__multiQuenchExpanded = false;
                comp.__multiQuenchSuppressToggleOnce = true;
                setChallengeListTitle(comp, option.label);
                setChallengeListExpanded(comp, false);
                setChallengeListVisible(comp, false);
                if (typeof onSelect === 'function') {
                    onSelect(option.value, option, comp);
                }
                if (typeof onExpandedChange === 'function') {
                    onExpandedChange(false, comp);
                }
            }, comp);
            listNode?.addChild?.(itemComp);
        });
        syncChallengeListDropdownLayout(comp, 5);

        bindClick(comp, function() {
            if (comp.__multiQuenchSuppressToggleOnce) {
                comp.__multiQuenchSuppressToggleOnce = false;
                return;
            }
            const next = !comp.__multiQuenchExpanded;
            comp.__multiQuenchExpanded = next;
            setChallengeListExpanded(comp, next);
            setChallengeListVisible(comp, next);
            syncChallengeListDropdownLayout(comp, 5);
            if (typeof onExpandedChange === 'function') {
                onExpandedChange(next, comp);
            }
        }, comp);
        return comp;
    }

    function createSmallActionButton(compName, fallbackText) {
        const btnW = DIALOG_LAYOUT.entryActionBtnWidth;
        const btnH = DIALOG_LAYOUT.entryActionBtnHeight;
        const button = createPackageObject('ui_common', compName, '');
        if (button) {
            const btn = button.asButton || button.asCom || button;
            const nativeW = Math.max(1, Number(btn.width || btnW));
            const nativeH = Math.max(1, Number(btn.height || btnH));
            const scaleX = btnW / nativeW;
            const scaleY = btnH / nativeH;
            try { btn.setScale?.(scaleX, scaleY); } catch (error) {}
            try { btn.scaleX = scaleX; btn.scaleY = scaleY; } catch (error) {}
            return btn;
        }
        const fgui = unsafeWindow.fgui;
        if (!fgui || typeof fgui.GButton !== 'function') {
            return null;
        }
        const fallback = new fgui.GButton();
        fallback.title = fallbackText || '';
        fallback.setSize(btnW, btnH);
        return fallback;
    }

    function createSettingsToggle(title, selected) {
        const toggle = createPackageObject('ui_common', 'BtnFilter', 'UI_BtnFilter');
        if (toggle) {
            toggle.touchable = true;
            toggle.visible = true;
            setComponentText(toggle, title || '');
            try { toggle.selected = !!selected; } catch (error) {}
            if (toggle.m_checkBox) {
                toggle.m_checkBox.selected = !!selected;
            }
            try { if (toggle.m_redPoint) toggle.m_redPoint.visible = false; } catch (error) {}
            const toggleTitle = toggle.m_title || toggle.getChild?.('title') || null;
            applySystemDefaultFont(toggleTitle);
            return toggle.asButton || toggle.asCom || toggle;
        }
        const fgui = unsafeWindow.fgui;
        if (!fgui || typeof fgui.GButton !== 'function') {
            return null;
        }
        const fallback = new fgui.GButton();
        fallback.title = title || '';
        fallback.__selected = !!selected;
        fallback.setSize(190, DIALOG_LAYOUT.rowHeight);
        return fallback;
    }

    function getToggleSelected(toggle) {
        if (!toggle) {
            return false;
        }
        if (toggle.m_checkBox && toggle.m_checkBox.selected !== undefined) {
            return !!toggle.m_checkBox.selected;
        }
        if (toggle.selected !== undefined) {
            return !!toggle.selected;
        }
        return !!toggle.__selected;
    }

    function setToggleSelected(toggle, selected, title) {
        if (!toggle) {
            return;
        }
        if (toggle.m_checkBox) {
            toggle.m_checkBox.selected = !!selected;
        }
        try { toggle.selected = !!selected; } catch (error) {}
        toggle.__selected = !!selected;
        if (title) {
            setComponentText(toggle, title);
        }
    }

    const QUALITY_TEXT_COLOR = {
        1: [255, 255, 255, 255],
        2: [120, 220, 96, 255],
        3: [96, 186, 255, 255],
        4: [205, 140, 255, 255],
        5: [255, 170, 64, 255],
        6: [255, 96, 96, 255]
    };

    const COLOR_SELECTOR_WIDTH = 152;

    function getGRoot() {
        try {
            return unsafeWindow.fgui?.GRoot?.inst || null;
        } catch (error) {
            return null;
        }
    }

    function getDialogContentContainer(skin, fallback) {
        if (skin?.m_container && typeof skin.m_container.addChild === 'function') {
            return skin.m_container;
        }
        const candidates = [
            skin?.getChild?.('container'),
            skin?.getChild?.('view'),
            skin?.getChild?.('panel')
        ].filter(Boolean);
        for (const item of candidates) {
            if (typeof item.addChild === 'function') {
                return item;
            }
        }
        return fallback || null;
    }

    function syncDialogSkinShell(skin, tipBg, closeOffsetY) {
        if (!skin || !tipBg || !skin.m_container) {
            return;
        }
        const shellHeight = Number(tipBg.y || 0) + Number(tipBg.height || 0);
        try { skin.m_container.height = shellHeight; } catch (error) {}
        try { skin.m_container.setSize?.(Number(skin.m_container.width || tipBg.width || 0), shellHeight); } catch (error) {}
        try {
            if (skin.m_btnClose) {
                skin.m_btnClose.y = Number(skin.m_container.y || 0) + shellHeight + Number(closeOffsetY || 9);
            }
        } catch (error) {}
        try {
            if (skin.m_btnBG) {
                const bgHeight = Number(skin.m_btnBG.height || 0);
                skin.m_btnBG.y = Number(skin.m_container.y || 0) + shellHeight - Math.max(0, bgHeight - 32);
            }
        } catch (error) {}
    }

    function clearChildren(target) {
        if (!target) {
            return;
        }
        const children = [];
        for (let i = 0; i < Number(target.numChildren || 0); i += 1) {
            try {
                children.push(target.getChildAt(i));
            } catch (error) {}
        }
        children.forEach(removeFromParent);
    }

    function resolveContentText(text) {
        if (!text) {
            return '';
        }
        try {
            const languageExt = getModule('LanguageExt');
            if (typeof languageExt?.GET_CONTENT === 'function') {
                return languageExt.GET_CONTENT(text) || text;
            }
        } catch (error) {}
        return String(text);
    }

    function getQuenchAttrOptions() {
        try {
            const configs = getModule('Configs');
            const list = configs?.QuenchAttrConf?.list;
            if (Array.isArray(list) && list.length) {
                return list.map(function(item) {
                    return {
                        value: Number(item?.id || 0) || 0,
                        label: resolveContentText(item?.attrName || '') || `词条${item?.id || ''}`
                    };
                }).filter(function(item) {
                    return item.value > 0 && !!item.label;
                });
            }
        } catch (error) {}
        return buildCustomAttrOptions();
    }

    function getAvailableQuenchAttrOptions(allOptions, entries, currentRowIndex) {
        const selectedValues = new Set();
        (Array.isArray(entries) ? entries : []).forEach(function(item, index) {
            if (index === currentRowIndex) {
                return;
            }
            const attrId = Number(item?.attrId || 0) || 0;
            if (attrId > 0) {
                selectedValues.add(attrId);
            }
        });
        return (Array.isArray(allOptions) ? allOptions : []).filter(function(option) {
            const value = Number(option?.value || 0) || 0;
            return value <= 0 || !selectedValues.has(value);
        });
    }

    function buildCustomColorOptions() {
        const items = [];
        for (const cStr in CUSTOM_COLOR_MAP) {
            items.push({
                value: Number(cStr),
                label: CUSTOM_COLOR_MAP[cStr],
                color: QUALITY_TEXT_COLOR[Number(cStr)] || null
            });
        }
        return items;
    }

    function normalizeCustomSettings(settings) {
        const source = settings && typeof settings === 'object' ? settings : {};
        const entries = Array.isArray(source.entries) ? source.entries : [];
        const rowCount = Math.min(
            ENTRY_LIMIT.maxRows,
            Math.max(ENTRY_LIMIT.minRows, Number(source.entryRows || entries.length || ENTRY_LIMIT.minRows) || ENTRY_LIMIT.minRows)
        );
        const nextEntries = [];
        for (let i = 0; i < rowCount; i += 1) {
            const item = entries[i] || {};
            nextEntries.push({
                attrId: Number(item.attrId || 0) || 0,
                colorId: Number(item.colorId || 0) || 0
            });
        }
        const entryControl = source.entryControl !== false;
        let countControl = source.countControl !== false;
        if (entryControl && countControl) {
            countControl = false;
        }
        return {
            entryRows: rowCount,
            entries: nextEntries,
            entryControl: entryControl,
            ratio: Math.max(1, Number(source.ratio || DEFAULT_RATIO_THRESHOLD) || DEFAULT_RATIO_THRESHOLD),
            countControl: countControl,
            countLimit: Math.max(1, Number(source.countLimit || 1000) || 1000),
            pctOn: source.pctOn === true
        };
    }

    function customCfgToSettings(cfg) {
        const attrs = normalizeAttrRows(cfg.targetAttrs);
        return normalizeCustomSettings({
            entryControl: cfg.targetOn !== false,
            entryRows: Math.max(ENTRY_LIMIT.minRows, attrs.length || ENTRY_LIMIT.minRows),
            entries: attrs.map(function(row) {
                return { attrId: Number(row.a) || 0, colorId: Number(row.c) || 0 };
            }),
            ratio: cfg.targetPct || DEFAULT_RATIO_THRESHOLD,
            countControl: cfg.timesOn !== false,
            countLimit: cfg.times || 1000,
            pctOn: cfg.pctOn === true
        });
    }

    function applySettingsToCustomCfg(settings) {
        const s = normalizeCustomSettings(settings);
        const cfg = loadCustomCfg();
        cfg.targetOn = s.entryControl !== false;
        cfg.targetAttrs = s.entries.map(function(item) {
            return { a: Number(item.attrId) || 0, c: Number(item.colorId) || 0 };
        });
        cfg.targetPct = s.ratio;
        cfg.pctOn = false;
        cfg.timesOn = s.countControl !== false;
        cfg.times = s.countLimit;
        cfg.enabled = deriveCustomEnabled(cfg);
        saveCustomCfg(cfg);
        return cfg;
    }

    function persistCustomPopupSettings(popup) {
        if (!popup) {
            return null;
        }
        const settings = normalizeCustomSettings(popup.settings);
        const ratio = getSettingsInputValue(popup.ratioInput, 1);
        if (ratio !== null) {
            settings.ratio = ratio;
        }
        const count = getSettingsInputValue(popup.countInput, 1);
        if (count !== null) {
            settings.countLimit = count;
        }
        popup.settings = settings;
        applySettingsToCustomCfg(settings);
        return settings;
    }

    function getObjectBottom(obj) {
        if (!obj || obj.visible === false) {
            return 0;
        }
        const y = Number(obj.y || 0) || 0;
        const height = Number(obj.height || 0) * Number(obj.scaleY || 1);
        return y + Math.max(0, height);
    }

    function measureContentBottom(contentHost) {
        if (!contentHost || typeof contentHost.getChildAt !== 'function') {
            return 0;
        }
        let bottom = 0;
        for (let i = 0; i < Number(contentHost.numChildren || 0); i += 1) {
            try {
                bottom = Math.max(bottom, getObjectBottom(contentHost.getChildAt(i)));
            } catch (error) {}
        }
        return Math.ceil(bottom);
    }

    function getSelectorDropdownBottom(selector) {
        if (!selector || selector.__multiQuenchExpanded !== true) {
            return 0;
        }
        const list = getChallengeListNode(selector);
        if (!list || list.visible === false) {
            return 0;
        }
        return Number(selector.y || 0)
            + Number(list.y || 0)
            + Number(list.height || 0) * Number(list.scaleY || 1);
    }

    function getLastExpandedDropdownBottom(contentHost) {
        if (!contentHost || typeof contentHost.getChildAt !== 'function') {
            return 0;
        }
        let lastRow = null;
        let lastSelector = null;
        for (let i = 0; i < Number(contentHost.numChildren || 0); i += 1) {
            const row = contentHost.getChildAt?.(i);
            if (!row || row.visible === false || typeof row.getChildAt !== 'function') {
                continue;
            }
            for (let j = 0; j < Number(row.numChildren || 0); j += 1) {
                const child = row.getChildAt?.(j);
                const name = String(child?.name || '');
                if (name.indexOf('QuenchAttrSelector') >= 0 || name.indexOf('QuenchColorSelector') >= 0) {
                    if (!lastRow || Number(row.y || 0) >= Number(lastRow.y || 0)) {
                        lastRow = row;
                        lastSelector = child;
                    }
                }
            }
        }
        const dropdownBottom = getSelectorDropdownBottom(lastSelector);
        if (!lastRow || dropdownBottom <= 0) {
            return 0;
        }
        return Number(lastRow.y || 0) + dropdownBottom + DIALOG_LAYOUT.lastDropdownExtraHeight;
    }

    function getSettingsRequiredHeight(popup) {
        const contentBottom = Math.max(
            measureContentBottom(popup?.contentHost),
            getLastExpandedDropdownBottom(popup?.contentHost)
        );
        if (contentBottom > 0) {
            return DIALOG_LAYOUT.formY + contentBottom + DIALOG_LAYOUT.bottomPadding + DIALOG_LAYOUT.bottomWoodSafePadding;
        }
        return DIALOG_LAYOUT.tipHeight;
    }

    function getSettingsTipWidth(containerWidth) {
        const width = Math.max(0, Number(containerWidth || 0) || DIALOG_LAYOUT.tipWidth);
        const minWidth = DIALOG_LAYOUT.formWidth + DIALOG_LAYOUT.formX * 2;
        return Math.min(DIALOG_LAYOUT.tipWidth, Math.max(minWidth, width - 28));
    }

    function syncSettingsDialogLayout(popup) {
        if (!popup?.tipBg) {
            return;
        }
        const container = popup.container || popup.layer;
        const containerWidth = Number(container?.width || DIALOG_LAYOUT.tipWidth);
        const tipWidth = getSettingsTipWidth(containerWidth);
        const requiredHeight = getSettingsRequiredHeight(popup);
        const tipHeight = Math.max(DIALOG_LAYOUT.tipHeight, requiredHeight);

        popup.tipBg.setSize?.(tipWidth, tipHeight);
        popup.tipBg.x = Math.round((containerWidth - tipWidth) / 2);
        popup.tipBg.y = DIALOG_LAYOUT.tipY;
        syncCommonComplexTipBackground(popup.tipBg);

        if (popup.tipContent) {
            popup.tipContent.setSize?.(DIALOG_LAYOUT.formWidth, Math.max(requiredHeight, tipHeight - DIALOG_LAYOUT.formY));
        }
        if (popup.contentHost) {
            popup.contentHost.setSize?.(DIALOG_LAYOUT.formWidth, Math.max(requiredHeight, Number(popup.tipContent?.height || 0)));
            popup.contentHost.x = DIALOG_LAYOUT.formX;
            popup.contentHost.y = DIALOG_LAYOUT.formY;
        }
        if (popup.skin) {
            syncDialogSkinShell(popup.skin, popup.tipBg, 9);
        }
    }

    function createNormalButton(title) {
        const button = createPackageObject('ui_common', 'BtnNormal', 'UI_BtnNormal')
            || createPackageObject('ui_common', 'btnNormal', 'UI_BtnNormal');
        if (button) {
            setComponentText(button, title || '确定');
            try { if (button.m_redPoint) button.m_redPoint.visible = false; } catch (error) {}
            try { if (button.m_showResIcon) button.m_showResIcon.selectedPage = 'false'; } catch (error) {}
            return button.asButton || button.asCom || button;
        }
        const fgui = unsafeWindow.fgui;
        if (!fgui || typeof fgui.GButton !== 'function') {
            return null;
        }
        const fallback = new fgui.GButton();
        fallback.title = title || '确定';
        fallback.setSize(170, DIALOG_LAYOUT.buttonHeight);
        return fallback;
    }

    function buildCustomAttrOptions() {
        const items = [];
        for (const idStr in CUSTOM_ATTR_MAP) {
            items.push({ value: Number(idStr), label: CUSTOM_ATTR_MAP[idStr] });
        }
        return items;
    }

    function createEntrySettingHeader(popup, settings) {
        const fgui = unsafeWindow.fgui;
        if (!fgui || typeof fgui.GComponent !== 'function') {
            return null;
        }
        const row = new fgui.GComponent();
        row.setSize(DIALOG_LAYOUT.formWidth, DIALOG_LAYOUT.entryToggleRowHeight);

        const toggle = createSettingsToggle('词条设置', settings.entryControl !== false);
        if (toggle) {
            toggle.x = 0;
            setObjectCenterY(toggle, getSettingsRowCenterY(DIALOG_LAYOUT.entryToggleRowHeight));
            row.addChild(toggle);
            bindClick(toggle, function() {
                const latest = persistCustomPopupSettings(popup) || settings;
                latest.entryControl = !getToggleSelected(toggle);
                if (latest.entryControl !== false) {
                    latest.countControl = false;
                }
                if (latest.entryControl !== false && latest.entryRows < ENTRY_LIMIT.minRows) {
                    latest.entryRows = ENTRY_LIMIT.minRows;
                    while ((latest.entries || []).length < ENTRY_LIMIT.minRows) {
                        latest.entries.push({ attrId: 0, colorId: 0 });
                    }
                }
                setToggleSelected(toggle, latest.entryControl, '词条设置');
                popup.settings = normalizeCustomSettings(latest);
                applySettingsToCustomCfg(popup.settings);
                renderCustomQuenchSettings(popup);
            }, row);
        }

        if (settings.entryControl !== false) {
            const minus = createSmallActionButton('SubtractOneBtn', '-');
            const plus = createSmallActionButton('PlusOneBtn', '+');
            layoutEntryActionButtons(minus, plus, DIALOG_LAYOUT.formWidth, DIALOG_LAYOUT.entryToggleRowHeight, toggle);
            if (minus) {
                setButtonEnabled(minus, settings.entryRows > ENTRY_LIMIT.minRows);
                row.addChild(minus);
                if (settings.entryRows > ENTRY_LIMIT.minRows) {
                    bindClick(minus, function() {
                        const latest = persistCustomPopupSettings(popup) || settings;
                        latest.entryRows = Math.max(ENTRY_LIMIT.minRows, latest.entryRows - 1);
                        latest.entries = latest.entries.slice(0, latest.entryRows);
                        popup.settings = normalizeCustomSettings(latest);
                        applySettingsToCustomCfg(popup.settings);
                        renderCustomQuenchSettings(popup);
                    }, row);
                }
            }
            if (plus) {
                setButtonEnabled(plus, settings.entryRows < ENTRY_LIMIT.maxRows);
                row.addChild(plus);
                if (settings.entryRows < ENTRY_LIMIT.maxRows) {
                    bindClick(plus, function() {
                        const latest = persistCustomPopupSettings(popup) || settings;
                        latest.entryRows = Math.min(ENTRY_LIMIT.maxRows, latest.entryRows + 1);
                        latest.entries.push({ attrId: 0, colorId: 0 });
                        popup.settings = normalizeCustomSettings(latest);
                        applySettingsToCustomCfg(popup.settings);
                        renderCustomQuenchSettings(popup);
                    }, row);
                }
            }
        }
        return row;
    }

    function createEntrySettingRow(popup, settings, attrOptions, entry, rowIndex) {
        const fgui = unsafeWindow.fgui;
        if (!fgui || typeof fgui.GComponent !== 'function') {
            return null;
        }
        const row = new fgui.GComponent();
        row.setSize(DIALOG_LAYOUT.formWidth, DIALOG_LAYOUT.entryConditionRowHeight);
        const selectorOptions = getAvailableQuenchAttrOptions(attrOptions, settings.entries, rowIndex);
        const colorOptions = buildCustomColorOptions();

        const selector = createChallengeListSelector(
            `customQuenchAttrSelector${rowIndex}`,
            `词条${rowIndex + 1}`,
            selectorOptions,
            entry.attrId,
            function(expanded) {
                if (expanded) {
                    moveChildToFront(popup.contentHost, row);
                }
                if (rowIndex === Number(popup.settings?.entryRows || 0) - 1) {
                    syncSettingsDialogLayout(popup);
                }
            },
            function(value) {
                const latest = persistCustomPopupSettings(popup) || settings;
                latest.entries[rowIndex].attrId = Number(value || 0) || 0;
                popup.settings = normalizeCustomSettings(latest);
                applySettingsToCustomCfg(popup.settings);
                renderCustomQuenchSettings(popup);
            },
            DIALOG_LAYOUT.attrSelectorWidth
        );
        if (selector) {
            selector.x = DIALOG_LAYOUT.entryIndentX;
            setObjectCenterY(selector, getSettingsRowCenterY(DIALOG_LAYOUT.entryConditionRowHeight));
            row.addChild(selector);
        }

        const attrWidth = NIGHTMARE_CHALLENGE_LIST_NATIVE_WIDTH;
        const colorSelector = createChallengeListSelector(
            `customQuenchColorSelector${rowIndex}`,
            CUSTOM_COLOR_MAP[entry.colorId] || '任意颜色',
            colorOptions,
            entry.colorId || 0,
            function(expanded) {
                if (expanded) {
                    moveChildToFront(popup.contentHost, row);
                }
                if (rowIndex === Number(popup.settings?.entryRows || 0) - 1) {
                    syncSettingsDialogLayout(popup);
                }
            },
            function(value) {
                const latest = persistCustomPopupSettings(popup) || settings;
                latest.entries[rowIndex].colorId = Number(value || 0) || 0;
                popup.settings = normalizeCustomSettings(latest);
                applySettingsToCustomCfg(popup.settings);
                renderCustomQuenchSettings(popup);
            },
            DIALOG_LAYOUT.colorSelectorWidth
        );
        if (colorSelector) {
            colorSelector.x = DIALOG_LAYOUT.entryIndentX + attrWidth + DIALOG_LAYOUT.selectorGap;
            setObjectCenterY(colorSelector, getSettingsRowCenterY(DIALOG_LAYOUT.entryConditionRowHeight));
            row.addChild(colorSelector);
        }
        return row;
    }

    function renderCustomQuenchSettings(popup) {
        if (!popup?.contentHost) {
            return;
        }
        warmupSettingsPackages();
        const settings = normalizeCustomSettings(popup.settings);
        popup.settings = settings;
        popup.ratioInput = null;
        popup.countInput = null;
        clearChildren(popup.contentHost);

        const attrOptions = getQuenchAttrOptions();
        let currentY = DIALOG_LAYOUT.startY;
        const entryHeader = createEntrySettingHeader(popup, settings);
        if (entryHeader) {
            entryHeader.x = 0;
            entryHeader.y = currentY;
            popup.contentHost.addChild(entryHeader);
        }
        currentY += DIALOG_LAYOUT.entryToggleRowHeight;

        if (settings.entryControl !== false) {
            currentY += DIALOG_LAYOUT.entryConditionGap;
            for (let i = 0; i < settings.entryRows; i += 1) {
                const entry = settings.entries[i] || { attrId: 0, colorId: 0 };
                const row = createEntrySettingRow(popup, settings, attrOptions, entry, i);
                if (row) {
                    row.x = 0;
                    row.y = currentY;
                    popup.contentHost.addChild(row);
                    currentY += DIALOG_LAYOUT.entryConditionRowHeight + DIALOG_LAYOUT.entryRowGap;
                }
            }
            currentY -= DIALOG_LAYOUT.entryRowGap;
        }

        currentY += DIALOG_LAYOUT.entryToCountControlGap;

        const countToggle = createSettingsToggle('次数设置', settings.countControl !== false);
        if (countToggle) {
            countToggle.x = 0;
            setObjectCenterY(countToggle, currentY + getSettingsRowCenterY(DIALOG_LAYOUT.rowHeight));
            popup.contentHost.addChild(countToggle);
            bindClick(countToggle, function() {
                const latest = persistCustomPopupSettings(popup) || settings;
                latest.countControl = !getToggleSelected(countToggle);
                if (latest.countControl !== false) {
                    latest.entryControl = false;
                }
                setToggleSelected(countToggle, latest.countControl, '次数设置');
                popup.settings = normalizeCustomSettings(latest);
                applySettingsToCustomCfg(popup.settings);
                renderCustomQuenchSettings(popup);
            }, popup.contentHost);
        }
        if (settings.countControl !== false && countToggle) {
            const countInput = createSettingsValueInput(settings.countLimit, '次数', 5, 'customQuenchTimesInput');
            if (countInput) {
                countInput.x = getCountInputStartX(countToggle);
                setObjectCenterY(countInput, currentY + DIALOG_LAYOUT.rowHeight / 2);
                popup.contentHost.addChild(countInput);
                popup.countInput = countInput;
            }
            const countUnit = createTextLabel('次', DIALOG_LAYOUT.unitWidth, DIALOG_LAYOUT.inputHeight, 24);
            if (countUnit && popup.countInput) {
                countUnit.x = popup.countInput.x + DIALOG_LAYOUT.inputWidth + 8;
                setObjectCenterY(countUnit, currentY + DIALOG_LAYOUT.rowHeight / 2);
                popup.contentHost.addChild(countUnit);
            }
        }

        currentY += DIALOG_LAYOUT.rowHeight + DIALOG_LAYOUT.startButtonTopGap;
        const startButton = createNormalButton('保存设置');
        if (startButton) {
            const hostWidth = Number(popup.contentHost?.width || DIALOG_LAYOUT.formWidth);
            const btnWidth = Number(startButton.width || 170) * Number(startButton.scaleX || 1);
            startButton.x = Math.round(hostWidth / 2 - btnWidth / 2);
            startButton.y = currentY + DIALOG_LAYOUT.saveButtonExtraYOffset;
            popup.saveButtonY = startButton.y;
            popup.contentHost.addChild(startButton);
            bindClick(startButton, function() {
                persistCustomPopupSettings(popup);
                showOverlayTip(popup, '设置已保存');
            }, popup.contentHost);
        }

        syncSettingsDialogLayout(popup);
        ensureSettingsOverlayClickable(popup);
        if (settingsUiNeedsRefresh(popup) && !popup.__settingsUiRetried) {
            popup.__settingsUiRetried = true;
            setTimeout(function() {
                if (!popup?.contentHost?.parent) {
                    return;
                }
                try {
                    warmupSettingsPackages();
                    renderCustomQuenchSettings(popup);
                } catch (error) {}
            }, 150);
        }
    }

    function isUnderCustomPanel(node) {
        let current = node;
        while (current) {
            if (current.name === CUSTOM_PANEL_NAME) {
                return true;
            }
            current = current.parent;
        }
        return false;
    }

    function collectLegacyPaperNodesInInner(inner) {
        if (!inner) {
            return [];
        }
        const results = [];
        const seen = new Set();

        const named = ['n10', 'n9'];
        for (let i = 0; i < named.length; i += 1) {
            const node = findDescendantByName(inner, named[i], 0);
            if (node && !seen.has(node) && !isUnderCustomPanel(node)) {
                results.push(node);
                seen.add(node);
            }
        }

        if (typeof inner.numChildren === 'number') {
            for (let j = 0; j < inner.numChildren; j += 1) {
                const child = inner.getChildAt(j);
                if (!child || seen.has(child) || nodeText(child) || isUnderCustomPanel(child)) {
                    continue;
                }
                const w = Number(child.width || 0);
                const h = Number(child.height || 0);
                const y = Number(child.y || 0);
                if (w >= 580 && w <= 750 && h >= 380 && h <= 500 && y >= 140 && y <= 280) {
                    results.push(child);
                    seen.add(child);
                }
            }
        }

        return results;
    }

    function hideLegacyPaperNodes(dialog, inner) {
        const nodes = collectLegacyPaperNodesInInner(inner);
        for (let i = 0; i < nodes.length; i += 1) {
            const node = nodes[i];
            setBlankVisible(dialog, node, false);
            setBlankAlpha(dialog, node, 0);
            console.log('[指定洗炼] 已隐藏原设置背景板:', node.name || '(unnamed)', node.width, node.height);
        }
        return nodes.length;
    }

    function bringOverlayLayerToFront(popup) {
        const layer = popup && popup.layer;
        if (!layer || !layer.parent) {
            return;
        }
        try {
            layer.sortingOrder = SETTINGS_DIALOG_SORT;
        } catch (error) {}
        try {
            const parent = layer.parent;
            if (typeof parent.setChildIndex === 'function') {
                parent.setChildIndex(layer, Math.max(0, Number(parent.numChildren || 1) - 1));
            }
        } catch (error) {}
    }

    function hideAllInnerChildren(dialog, inner) {
        if (!inner || typeof inner.numChildren !== 'number') {
            return;
        }
        for (let i = 0; i < inner.numChildren; i += 1) {
            const child = inner.getChildAt(i);
            if (!child) {
                continue;
            }
            setBlankVisible(dialog, child, false);
        }
    }

    function ensureSubtreeTouchable(node) {
        if (!node) {
            return;
        }
        try {
            node.touchable = true;
        } catch (error) {}
        if (typeof node.numChildren !== 'number') {
            return;
        }
        for (let i = 0; i < node.numChildren; i += 1) {
            ensureSubtreeTouchable(node.getChildAt(i));
        }
    }

    function ensureSettingsOverlayClickable(popup) {
        if (!popup) {
            return;
        }
        const skin = popup.skin;
        const tipBg = popup.tipBg;
        const contentHost = popup.contentHost;
        const container = popup.container;
        try {
            if (skin?.m_btnBG) {
                skin.m_btnBG.touchable = false;
                skin.m_btnBG.opaque = false;
            }
        } catch (error) {}
        try {
            if (tipBg) {
                tipBg.touchable = true;
            }
        } catch (error) {}
        try {
            if (contentHost) {
                contentHost.touchable = true;
                ensureSubtreeTouchable(contentHost);
            }
        } catch (error) {}
        try {
            if (skin?.m_btnClose) {
                skin.m_btnClose.touchable = true;
                moveChildToFront(skin, skin.m_btnClose);
            }
        } catch (error) {}
        try {
            if (skin?.m_container) {
                moveChildToFront(skin, skin.m_container);
            }
        } catch (error) {}
        try {
            if (tipBg && container) {
                moveChildToFront(container, tipBg);
            }
        } catch (error) {}
    }

    function closeCustomQuenchSettingsOverlay(dialog) {
        const popup = dialog && dialog[CUSTOM_SETTINGS_OVERLAY_KEY];
        if (!popup) {
            return;
        }
        try {
            persistCustomPopupSettings(popup);
        } catch (error) {}
        try {
            removeFromParent(popup.layer);
        } catch (error) {}
        dialog[CUSTOM_SETTINGS_OVERLAY_KEY] = null;
    }

    function openCustomQuenchSettingsOverlay(dialog) {
        if (!dialog) {
            return;
        }
        const existing = dialog[CUSTOM_SETTINGS_OVERLAY_KEY];
        if (existing?.layer?.parent) {
            existing.__settingsUiRetried = false;
            syncSettingsDialogLayout(existing);
            bringOverlayLayerToFront(existing);
            ensureSettingsOverlayClickable(existing);
            scheduleSettingsUiRefresh(existing);
            return;
        }
        closeCustomQuenchSettingsOverlay(dialog);

        warmupSettingsPackages();
        const fgui = unsafeWindow.fgui;
        const root = getGRoot();
        if (!fgui || !root) {
            return;
        }

        const layer = new fgui.GComponent();
        layer.name = CUSTOM_SETTINGS_LAYER_NAME;
        layer.setSize(Number(root.width || DIALOG_LAYOUT.tipWidth), Number(root.height || DIALOG_LAYOUT.tipHeight));
        layer.touchable = true;
        layer.sortingOrder = SETTINGS_DIALOG_SORT;

        const skin = createPackageObject('ui_common', 'CommonDialogSkin', 'UI_CommonDialogSkin');
        if (skin) {
            skin.setSize?.(layer.width, layer.height);
            skin.touchable = true;
            layer.addChild(skin);
            try {
                if (skin.m_btnBG) {
                    skin.m_btnBG.touchable = false;
                    skin.m_btnBG.opaque = false;
                }
            } catch (error) {}
            setComponentText(skin.getChild?.('title') || skin.m_title || skin, '装备洗练设置');
            bindClick(skin.m_btnClose || skin.getChild?.('btnClose'), function() {
                closeCustomQuenchSettingsOverlay(dialog);
            });
            bindClick(skin.m_btnBG || skin.getChild?.('btnBG'), function() {
                closeCustomQuenchSettingsOverlay(dialog);
            });
        } else {
            const mask = new fgui.GGraph();
            mask.drawRect(0, '#000000', '#000000');
            mask.alpha = 0.55;
            mask.setSize(layer.width, layer.height);
            layer.addChild(mask);
        }

        const container = getDialogContentContainer(skin, layer);
        const tipBg = createPackageObject('ui_common', 'CommonComplexTip', 'UI_CommonComplexTip');
        if (!tipBg || !container) {
            removeFromParent(layer);
            console.warn('[指定洗炼] 无法创建 CommonComplexTip/CommonDialogSkin');
            return;
        }
        tipBg.setSize?.(DIALOG_LAYOUT.tipWidth, DIALOG_LAYOUT.tipHeight);
        tipBg.x = Math.round((Number(container.width || layer.width) - DIALOG_LAYOUT.tipWidth) / 2);
        tipBg.y = DIALOG_LAYOUT.tipY;
        container.addChild(tipBg);
        prepareCommonComplexTip(tipBg);
        const tipContent = getTipContentArea(tipBg);
        hideNativeTipContent(tipContent);

        const contentHost = new fgui.GComponent();
        contentHost.name = 'customQuenchContentHost';
        contentHost.setSize(DIALOG_LAYOUT.formWidth, DIALOG_LAYOUT.tipHeight);
        contentHost.x = DIALOG_LAYOUT.formX;
        contentHost.y = DIALOG_LAYOUT.formY;
        contentHost.touchable = true;
        (tipContent || tipBg).addChild(contentHost);

        const popup = {
            dialog: dialog,
            layer: layer,
            skin: skin,
            container: container,
            tipBg: tipBg,
            tipContent: tipContent,
            contentHost: contentHost,
            settings: customCfgToSettings(loadCustomCfg()),
            ratioInput: null,
            countInput: null
        };
        layer.__customQuenchPopup = popup;
        popup.__settingsUiRetried = false;
        renderCustomQuenchSettings(popup);
        scheduleSettingsUiRefresh(popup);
        ensureSettingsOverlayClickable(popup);

        try {
            root.addChild(layer);
            rememberBlankChange(dialog, layer, 'remove', null);
            dialog[CUSTOM_SETTINGS_OVERLAY_KEY] = popup;
            bringOverlayLayerToFront(popup);
            console.log('[指定洗炼] 设置 UI 已挂载 GRoot（physics openSettingsDialog 同款）');
        } catch (error) {
            console.warn('[指定洗炼] 构建设置 UI 失败:', error);
        }
    }

    function buildCustomQuenchPanel(dialog, inner) {
        openCustomQuenchSettingsOverlay(dialog);
    }


    function patchDialogClass(DialogClass) {
        if (!DialogClass || DialogClass.prototype[PATCH_KEY]) {
            return !!DialogClass;
        }

        const originalOnShow = DialogClass.prototype.onShow;
        const originalOnHide = DialogClass.prototype.onHide;
        const originalOnClickAutoQuench = DialogClass.prototype._onClickAutoQuench;
        const originalOnClickSkipOrange = DialogClass.prototype._onClickSkipOrange;
        const originalChangeAutoState = DialogClass.prototype._changeAutoState;
        const originalResetToggles = DialogClass.prototype._resetTogToDefault;
        const originalUpdateQuench = DialogClass.prototype._updateQuench;
        const originalChangeOrangeState = DialogClass.prototype._changeOrangeConfrimState;
        const originalCheckQuenchConfirm = DialogClass.prototype._checkQuenchConfirm;
        const originalDoEquipQuench = DialogClass.prototype._doEquipQuench;
        const originalRefreshItems = DialogClass.prototype._refreshItems;

        DialogClass.prototype.onShow = function() {
            const result = originalOnShow.apply(this, arguments);
            try {
                this[AUTO_CONFIRMING_RED_KEY] = false;
                // 记录当前淬炼面板实例，供设置面板的「开始洗炼」按钮取用
                unsafeWindow.__lastQuenchDialog = this;
                ensureRedToggle(this);
                scheduleEnchantLayout(this);
                applyQuenchAnimationAccel(this);
            } catch (error) {
                console.error('[跳过红色] onShow 注入失败:', error);
            }
            return result;
        };

        DialogClass.prototype.onHide = function() {
            try {
                stopCustomQuench(this, '面板关闭');
                closeCustomQuenchSettingsOverlay(this);
                if (unsafeWindow.__lastQuenchDialog === this) {
                    unsafeWindow.__lastQuenchDialog = null;
                }
                const toggle = this[RED_TOGGLE_KEY];
                if (toggle) {
                    try {
                        toggle.dispose();
                    } catch (error) {}
                    this[RED_TOGGLE_KEY] = null;
                }
                const enchantClone = this[ENCHANT_CLONE_KEY];
                if (enchantClone) {
                    try {
                        enchantClone.dispose();
                    } catch (error) {}
                    this[ENCHANT_CLONE_KEY] = null;
                }
                this.__quenchSettingsBtnTemplate = null;
                this[RED_STATE_KEY] = false;
                this[AUTO_CONFIRMING_RED_KEY] = false;
                this[ORIGIN_POS_KEY] = null;
            } catch (error) {}
            return originalOnHide.apply(this, arguments);
        };

        DialogClass.prototype._onClickAutoQuench = function() {
            if (typeof originalChangeAutoState === 'function') {
                const result = originalChangeAutoState.apply(this, arguments);
                // 用户取消勾选自动淬炼 = 中止进行中的指定洗炼任务
                if (!this._isOpenAuto && this[CUSTOM_RUN_KEY]) {
                    try {
                        stopCustomQuench(this, '取消自动淬炼');
                    } catch (error) {}
                }
                refreshToggleGroup(this);
                return result;
            }
            return originalOnClickAutoQuench ? originalOnClickAutoQuench.apply(this, arguments) : undefined;
        };

        DialogClass.prototype._onClickSkipOrange = function() {
            if (typeof originalChangeOrangeState === 'function') {
                const result = originalChangeOrangeState.apply(this, arguments);
                if (!this._isSkipOrange) {
                    resetRedState(this);
                }
                refreshToggleGroup(this);
                return result;
            }
            return originalOnClickSkipOrange ? originalOnClickSkipOrange.apply(this, arguments) : undefined;
        };

        DialogClass.prototype._changeAutoState = function() {
            const result = originalChangeAutoState.apply(this, arguments);
            // 用户取消勾选自动淬炼 = 中止进行中的指定洗炼任务
            if (!this._isOpenAuto && this[CUSTOM_RUN_KEY]) {
                try {
                    stopCustomQuench(this, '取消自动淬炼');
                } catch (error) {}
            }
            refreshToggleGroup(this);
            return result;
        };

        DialogClass.prototype._changeOrangeConfrimState = function() {
            const result = originalChangeOrangeState.apply(this, arguments);
            if (!this._isSkipOrange) {
                resetRedState(this);
            }
            refreshToggleGroup(this);
            return result;
        };

        DialogClass.prototype._resetTogToDefault = function() {
            const result = originalResetToggles.apply(this, arguments);
            resetRedState(this);
            refreshToggleGroup(this);
            return result;
        };

        DialogClass.prototype._updateQuench = async function() {
            if (this._isInQuenchAnim || this._isInQuench || this._quenchTimes <= 0 || this[AUTO_CONFIRMING_RED_KEY]) {
                return;
            }

            const needConfirm = this._checkQuenchConfirm();
            const shouldAutoConfirmRed = !!this[RED_STATE_KEY]
                && needConfirm
                && this._needConfrimQuenches.length > 0;

            if (!shouldAutoConfirmRed) {
                return originalUpdateQuench.apply(this, arguments);
            }

            const moduleManager = getModule('ModuleManager');
            const configs = getModule('Configs');
            if (!moduleManager || !configs || !this._equipInfo) {
                return;
            }

            const showVersion = this._showVersion;
            const equipInfo = this._equipInfo;
            const heroId = equipInfo.heroId;
            const part = equipInfo.part;
            const quenchId = equipInfo.curQuenchId;
            const equipModule = moduleManager.GET_MODULE(configs.ModuleType.EQUIP);
            if (!equipModule || typeof equipModule.sendConfirm !== 'function') {
                return;
            }

            this[AUTO_CONFIRMING_RED_KEY] = true;
            try {
                const success = await equipModule.sendConfirm(heroId, part, this._equipInfo.quenches || new Map(), quenchId);
                if (!success) {
                    return;
                }

                if (!this.isShow || this._showVersion !== showVersion) {
                    return;
                }

                const latestEquipInfo = this._equipInfo;
                if (!latestEquipInfo
                    || latestEquipInfo.heroId !== heroId
                    || latestEquipInfo.part !== part
                    || latestEquipInfo.curQuenchId !== quenchId) {
                    return;
                }

                this._clearQuenchAnims();
                if (this._isOpenAuto) {
                    this._quenchTimes = this.AUTO_QUENCH_TIMES;
                }
                this._refreshItems();
                this._seed = this._equipInfo && this._equipInfo.seed || 0;
                this._doEquipQuench();
            } finally {
                this[AUTO_CONFIRMING_RED_KEY] = false;
            }
        };

        DialogClass.prototype._refreshItems = function() {
            const result = originalRefreshItems.apply(this, arguments);
            try {
                scheduleEnchantLayout(this);
            } catch (error) {}
            try {
                tickCustomQuench(this);
            } catch (error) {}
            return result;
        };

        // 关键：连洗的洗炼响应不走 _refreshItems，而是每次都经过 _onQuenchEffectComplete；
        // 词条达标判定（基于洗炼返回写入 _equipInfo.quenches 的数据）必须挂在这里才能即时停。
        const originalOnQuenchEffectComplete = DialogClass.prototype._onQuenchEffectComplete;
        if (typeof originalOnQuenchEffectComplete === 'function') {
            DialogClass.prototype._onQuenchEffectComplete = function() {
                const result = originalOnQuenchEffectComplete.apply(this, arguments);
                try {
                    tickCustomQuench(this);
                } catch (error) {}
                return result;
            };
        }

        DialogClass.prototype._doEquipQuench = function() {
            try {
                let run = this[CUSTOM_RUN_KEY];
                // 无进行中任务时，若总开关开启，点淬炼按钮即自动接管为指定洗炼
                if (!run && !this[CUSTOM_TAKEOVER_GUARD_KEY]) {
                    const cfg = loadCustomCfg();
                    if (deriveCustomEnabled(cfg)) {
                        this[CUSTOM_TAKEOVER_GUARD_KEY] = true;
                        try {
                            startCustomQuench(this);
                        } finally {
                            this[CUSTOM_TAKEOVER_GUARD_KEY] = false;
                        }
                        run = this[CUSTOM_RUN_KEY];
                    }
                }
                if (run) {
                    if (run.left <= 0) {
                        stopCustomQuench(this, '次数完成');
                        return undefined;
                    }
                    run.left -= 1;
                    updateQuenchBtnProgress(this);
                }
            } catch (error) {}
            const quenchPromise = originalDoEquipQuench.apply(this, arguments);
            // 词条达标基于「洗炼返回的数据」判定：响应落地（写入 _equipInfo.quenches）后立即检查，
            // 优先级高于指定次数 —— 达标即停，不等次数耗尽
            try {
                const self = this;
                if (quenchPromise && typeof quenchPromise.then === 'function') {
                    quenchPromise.then(function() {
                        try {
                            tickCustomQuench(self);
                        } catch (error) {}
                    });
                }
            } catch (error) {}
            return quenchPromise;
        };

        DialogClass.prototype._checkQuenchConfirm = function() {
            if (!this._equipInfo || !this._equipInfo.quenches) {
                return originalCheckQuenchConfirm.apply(this, arguments);
            }

            let needConfirm = false;
            this._needConfrimQuenches.length = 0;

            const threshold = (this._isSkipOrange || this[RED_STATE_KEY]) ? 6 : 5;
            this._equipInfo.quenches.forEach((quench, slot) => {
                if (quench.colorId >= threshold && !this._locks.has(slot)) {
                    needConfirm = true;
                    this._needConfrimQuenches.push(quench);
                }
            });

            return needConfirm;
        };

        DialogClass.prototype[PATCH_KEY] = true;
        console.log('[跳过红色] 已补丁 QuenchStageUpDialog.prototype');
        return true;
    }

    function getEnchantDialogClass() {
        const mod = getModule(ENCHANT_DIALOG_MODULE);
        if (!mod) {
            return null;
        }
        return mod.EquipEnchantDialog || mod.default || null;
    }

    function getUiChild(ui, name) {
        if (!ui) {
            return null;
        }
        try {
            if (ui['m_' + name]) {
                return ui['m_' + name];
            }
        } catch (error) {}
        try {
            if (typeof ui.getChild === 'function') {
                const child = ui.getChild(name);
                if (child) {
                    return child;
                }
            }
        } catch (error) {}
        if (typeof ui.numChildren === 'number') {
            for (let i = 0; i < ui.numChildren; i += 1) {
                const child = ui.getChildAt(i);
                if (child && child.name === name) {
                    return child;
                }
            }
        }
        return null;
    }

    function findDescendantByName(root, name, depth) {
        if (!root || depth > 22) {
            return null;
        }
        if (root.name === name) {
            return root;
        }
        if (typeof root.numChildren === 'number') {
            for (let i = 0; i < root.numChildren; i += 1) {
                const found = findDescendantByName(root.getChildAt(i), name, depth + 1);
                if (found) {
                    return found;
                }
            }
        }
        return null;
    }

    function rememberBlankChange(dialog, node, kind, oldValue) {
        if (!dialog[BLANK_STORE_KEY]) {
            dialog[BLANK_STORE_KEY] = [];
        }
        dialog[BLANK_STORE_KEY].push({ node: node, kind: kind, old: oldValue });
    }

    function setBlankVisible(dialog, node, visible) {
        if (!node || node.visible === visible) {
            return;
        }
        rememberBlankChange(dialog, node, 'visible', node.visible);
        try {
            node.visible = visible;
        } catch (error) {}
    }

    function setBlankText(dialog, node, text) {
        if (!node || typeof node.text !== 'string' || node.text === text) {
            return;
        }
        rememberBlankChange(dialog, node, 'text', node.text);
        try {
            node.text = text;
        } catch (error) {}
    }

    function setBlankAlpha(dialog, node, alpha) {
        if (!node || typeof node.alpha !== 'number' || node.alpha === alpha) {
            return;
        }
        rememberBlankChange(dialog, node, 'alpha', node.alpha);
        try {
            node.alpha = alpha;
        } catch (error) {}
    }

    // 是否处于名字以 btn/equip 开头的祖先节点内（排除按钮内部/装备槽内部的同名文字）
    function hasAncestorPrefixed(node, prefixes) {
        let current = node && node.parent;
        while (current) {
            const name = (current.name || '').toLowerCase();
            for (let i = 0; i < prefixes.length; i += 1) {
                if (name.indexOf(prefixes[i]) === 0) {
                    return true;
                }
            }
            current = current.parent;
        }
        return false;
    }

    // 取对话框所在窗口的顶层节点：标题横幅挂在窗框装饰层（ui 的祖先链），不在 ui 子树内。
    // 向上爬到 GRoot 的直接子节点为止（即本窗口根），避免越界搜到其它面板。
    function getDialogWindowRoot(ui) {
        const fgui = unsafeWindow.fgui;
        const groot = fgui && fgui.GRoot && fgui.GRoot.inst ? fgui.GRoot.inst : null;
        let root = ui;
        let steps = 0;
        while (root && root.parent && root.parent !== groot && steps < 4) {
            root = root.parent;
            steps += 1;
        }
        return root || ui;
    }

    // 深度收集横幅标题节点：text 精确等于关键字、宽>=150、不在按钮/装备槽内。
    // 返回全部候选（含 text 代理到内部标题的窗框容器），按 y 升序。
    function findBannerTitleNodes(root, keyword) {
        const candidates = [];
        function walk(node, depth) {
            if (!node || depth > 22) {
                return;
            }
            try {
                if (typeof node.text === 'string'
                    && node.text === keyword
                    && node.width >= 150
                    && !hasAncestorPrefixed(node, ['btn', 'equip'])) {
                    candidates.push(node);
                }
            } catch (error) {}
            if (typeof node.numChildren === 'number') {
                for (let i = 0; i < node.numChildren; i += 1) {
                    walk(node.getChildAt(i), depth + 1);
                }
            }
        }
        walk(root, 0);
        candidates.sort(function(a, b) {
            return (a.y | 0) - (b.y | 0);
        });
        return candidates;
    }

    function revertBlankChanges(dialog) {
        closeCustomQuenchSettingsOverlay(dialog);
        const store = dialog && dialog[BLANK_STORE_KEY];
        if (!store || !store.length) {
            return;
        }
        for (let i = store.length - 1; i >= 0; i -= 1) {
            const entry = store[i];
            try {
                if (entry.kind === 'visible') {
                    entry.node.visible = entry.old;
                } else if (entry.kind === 'text') {
                    entry.node.text = entry.old;
                } else if (entry.kind === 'alpha') {
                    entry.node.alpha = entry.old;
                } else if (entry.kind === 'remove') {
                    if (entry.node.parent) {
                        entry.node.parent.removeChild(entry.node, true);
                    }
                } else if (entry.kind === 'rect') {
                    entry.node.setPosition(entry.old.x, entry.old.y);
                    entry.node.setSize(entry.old.w, entry.old.h);
                    entry.node[BLANK_BG_STRETCH_FLAG] = false;
                }
            } catch (error) {}
        }
        dialog[BLANK_STORE_KEY] = null;
        dialog[BLANK_TITLE_NODE_KEY] = null;
    }

    // 空白设置模式：仅隐藏 inner 内旧纸面（n10 等），新壳层挂 GRoot；不碰赐福窗外框与其它 UI 贴图
    function applyBlankInnerLayout(dialog, inner) {
        if (!inner) {
            return;
        }

        hideLegacyPaperNodes(dialog, inner);

        for (let i = 0; i < BLANK_HIDE_INNER.length; i += 1) {
            setBlankVisible(dialog, findDescendantByName(inner, BLANK_HIDE_INNER[i], 0), false);
        }

        try {
            buildCustomQuenchPanel(dialog, inner);
        } catch (error) {
            console.warn('[指定洗炼] 设置 UI 构建异常:', error);
        }
    }

    function applyEnchantDialogMode(dialog, blank) {
        const ui = dialog && dialog.ui;
        if (!ui) {
            return;
        }
        const titleNode = getUiChild(ui, 'title');
        if (titleNode && typeof titleNode.text === 'string' && dialog[ORIG_TITLE_KEY] == null) {
            dialog[ORIG_TITLE_KEY] = titleNode.text;
        }

        if (blank) {
            let banners = dialog[BLANK_TITLE_NODE_KEY];
            if (!banners || !banners.length || !banners[0].parent) {
                const winRoot = getDialogWindowRoot(ui);
                banners = findBannerTitleNodes(winRoot, dialog[ORIG_TITLE_KEY] || '赐福');
                if (!banners.length) {
                    banners = findBannerTitleNodes(winRoot, '赐福');
                }
                if (!banners.length && titleNode && typeof titleNode.text === 'string') {
                    banners = [titleNode];
                }
                dialog[BLANK_TITLE_NODE_KEY] = banners;
            }
            for (let i = 0; i < banners.length; i += 1) {
                setBlankText(dialog, banners[i], BLANK_TITLE_TEXT);
            }
            let closeBtn = findDescendantByName(getDialogWindowRoot(ui), 'btnClose', 0)
                || findDescendantByName(ui, 'btnClose', 0);
            if (!closeBtn) {
                const fguiRef = unsafeWindow.fgui;
                if (fguiRef && fguiRef.GRoot && fguiRef.GRoot.inst) {
                    closeBtn = findDescendantByName(fguiRef.GRoot.inst, 'btnClose', 0);
                }
            }
            if (closeBtn) {
                dialog.__cfCloseBtn = closeBtn;
                setBlankAlpha(dialog, closeBtn, 0);
                if (typeof closeBtn.numChildren === 'number') {
                    for (let i = 0; i < closeBtn.numChildren; i += 1) {
                        setBlankVisible(dialog, closeBtn.getChildAt(i), false);
                    }
                }
            }
            for (let i = 0; i < BLANK_HIDE_CHILDREN.length; i += 1) {
                const node = getUiChild(ui, BLANK_HIDE_CHILDREN[i]);
                if (node) {
                    try {
                        node.visible = false;
                    } catch (error) {}
                }
            }
            const inner = findDescendantByName(ui, ENCHANT_DIALOG_MODULE, 0) || ui;
            applyBlankInnerLayout(dialog, inner);
        } else {
            if (titleNode && dialog[ORIG_TITLE_KEY] != null) {
                try {
                    titleNode.text = dialog[ORIG_TITLE_KEY];
                } catch (error) {}
            }
            for (let i = 0; i < BLANK_HIDE_CHILDREN.length; i += 1) {
                const node = getUiChild(ui, BLANK_HIDE_CHILDREN[i]);
                if (node) {
                    try {
                        node.visible = true;
                    } catch (error) {}
                }
            }
            // 还原空白模式的所有内部改动（背景尺寸/各节点显隐）
            revertBlankChanges(dialog);
        }
    }

    function patchEnchantDialogClass(DialogClass) {
        if (!DialogClass || !DialogClass.prototype || DialogClass.prototype[ENCHANT_DIALOG_PATCH_KEY]) {
            return !!DialogClass;
        }

        const originalOnShow = DialogClass.prototype.onShow;
        const originalOnHide = DialogClass.prototype.onHide;
        if (typeof originalOnShow !== 'function') {
            return false;
        }

        DialogClass.prototype.onShow = function() {
            if (unsafeWindow[BLANK_REQUEST_KEY]) {
                this[BLANK_MODE_KEY] = true;
                unsafeWindow[BLANK_REQUEST_KEY] = false;
            }
            const result = originalOnShow.apply(this, arguments);
            const dialog = this;
            const blank = !!this[BLANK_MODE_KEY];
            function apply() {
                try {
                    if (dialog.isShow !== false) {
                        applyEnchantDialogMode(dialog, blank && !!dialog[BLANK_MODE_KEY]);
                    }
                } catch (error) {
                    console.error('[设置面板] onShow 注入失败:', error);
                }
            }
            apply();
            // 游戏会在 onShow 后异步刷新子节点（装备列表/按钮状态），延迟重套空白布局
            if (blank) {
                setTimeout(apply, 0);
                setTimeout(apply, 120);
                setTimeout(apply, 400);
                setTimeout(apply, 800);
            }
            return result;
        };

        DialogClass.prototype.onHide = function() {
            try {
                revertBlankChanges(this);
                this[BLANK_MODE_KEY] = false;
            } catch (error) {}
            return originalOnHide ? originalOnHide.apply(this, arguments) : undefined;
        };

        DialogClass.prototype[ENCHANT_DIALOG_PATCH_KEY] = true;
        console.log('[设置面板] 已补丁 EquipEnchantDialog.prototype（克隆按钮 → 空白设置面板）');
        return true;
    }

    function startInjectionChecker() {
        let checkCount = 0;
        const timer = setInterval(() => {
            checkCount += 1;

            if (checkCount >= MAX_CHECK_COUNT) {
                clearInterval(timer);
                console.warn('[跳过红色] 注入超时，未找到目标模块');
                return;
            }

            if (typeof unsafeWindow.__require !== 'function' || typeof unsafeWindow.fgui !== 'object') {
                return;
            }

            const EnchantDialogClass = getEnchantDialogClass();
            if (EnchantDialogClass) {
                patchEnchantDialogClass(EnchantDialogClass);
            }

            const DialogClass = getQuenchDialogClass();
            const ToggleClass = getSkipOrangeToggleClass();
            if (!DialogClass || !ToggleClass) {
                return;
            }

            if (patchDialogClass(DialogClass)) {
                clearInterval(timer);
                console.log('[跳过红色] 注入完成');
            }
        }, CHECK_INTERVAL_MS);
    }

    startInjectionChecker();
})();
