// ==UserScript==


// @name         英雄队伍增强


// @namespace    http://tampermonkey.net/


// @version      3.1.0


// @description  在英雄队伍面板的帮助按钮左侧添加自定义功能按钮，支持英雄交换、等级升级、战斗位置调整、鱼灵管理、鱼珠技能管理、水晶切换、装备正反面切换、俱乐部科技管理、主公武器切换等功能，增加角色隔离功能，修复多颗相同鱼珠的分配问题，优化iPhone导出兼容性，修复俱乐部科技切换问题，优化科技保存和恢复逻辑，修复鱼灵配置时的变量作用域错误，修复未装备鱼灵时的卸载错误，修复科技逐级升级逻辑, 修复头像为png和pvr资源加载逻辑, 优化科技升级提示信息, 修复科技重置逻辑只重置有科技的职业, 增加战力显示功能, 修复科技升级顺序问题区分普通科技和高级科技, 修复高级科技前置条件检查逻辑, v3.0.0重构科技升级逻辑简化升级流程去除前置条件判断, v3.0.1修复导入队伍智能合并逻辑和鱼珠技能自我交换bug, v3.1.0科技精准匹配优化只重置需要降级的职业


// @author       非酋


// @match        *://*


// @grant        unsafeWindow


// @grant        GM_xmlhttpRequest


// @connect      8.133.250.145


// ==/UserScript==





;(function() {


    'use strict';


    var unsafeWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;





    // ========== 云端存档（按卡密 + gameId + namespace 隔离） ==========


    // 依赖 APP 侧注入的 window.__h5web_cardKey / window.__h5web_deviceId，并复用 GM_xmlhttpRequest 跨域能力


    var CloudSave = (function () {





        var SERVER_URL = 'http://8.133.250.145:9001';


        function getCardKey() {


            return String(window.__h5web_cardKey || '');


        }


        function getDeviceId() {


            return String(window.__h5web_deviceId || (window.h5webBridge && window.h5webBridge.getDeviceId && window.h5webBridge.getDeviceId()) || '');


        }


        function isAvailable() {


            return !!(getCardKey() && getDeviceId() && (typeof GM_xmlhttpRequest === 'function' || typeof fetch === 'function'));


        }


        function request(path, body) {


            return new Promise(function (resolve, reject) {


                if (!isAvailable()) return reject({ success: false, message: '云端存档上下文不可用' });


                var payload = Object.assign({


                    cardKey: getCardKey(),


                    deviceId: getDeviceId(),


                    platform: /iPad|iPhone|iPod/i.test(navigator.userAgent) ? 'ios' : 'apk'


                }, body || {});


                var url = SERVER_URL + path;


                if (typeof GM_xmlhttpRequest === 'function') {


                    GM_xmlhttpRequest({


                        method: 'POST',


                        url: url,


                        headers: { 'Content-Type': 'application/json' },


                        data: JSON.stringify(payload),


                        timeout: 20000,


                        onload: function (resp) {


                            try {


                                var parsed = JSON.parse(resp.responseText || '{}');


                                if (parsed && parsed.error && !parsed.message) parsed.message = parsed.error.message;


                                resolve(parsed);


                            } catch (e) {


                                reject({ success: false, message: '云端响应解析失败' });


                            }





                        },


                        onerror: function (err) { reject(err || { success: false, message: '网络请求失败' }); },


                        ontimeout: function () { reject({ success: false, message: '云端请求超时' }); }


                    });


                    return;


                }


                fetch(url, {


                    method: 'POST',


                    headers: { 'Content-Type': 'application/json' },


                    body: JSON.stringify(payload)


                }).then(function (r) { return r.json(); }).then(function (parsed) {


                    if (parsed && parsed.error && !parsed.message) parsed.message = parsed.error.message;


                    resolve(parsed);


                }).catch(reject);





            });


        }


        function normalizeGet(resp) {


            if (!resp || !resp.success) return resp || { success: false, message: '云端请求失败' };


            return {


                success: true,


                exists: !!resp.exists,


                content: resp.data && resp.data.content || '',


                data: resp.data || null


            };





        }


        return {


            isAvailable: isAvailable,


            put: function (gameId, ns, content) {


                return request('/api/cloud-save/put', { gameId: String(gameId), namespace: String(ns), content: String(content) });


            },


            get: function (gameId, ns) {


                return request('/api/cloud-save/get', { gameId: String(gameId), namespace: String(ns) }).then(normalizeGet);


            },


            list: function (gameId) {


                return request('/api/cloud-save/list', { gameId: String(gameId) });


            },


            del: function (gameId, ns) {


                return request('/api/cloud-save/delete', { gameId: String(gameId), namespace: String(ns) });


            },


        };


    })();


    unsafeWindow.CloudSave = CloudSave;





    class HeroTeamEnhancer {


        constructor() {


            this.version = '3.1.0';


            this.customButton = null;


            this.managementPanel = null;


            this.storageKey = 'hero_team_data';


            this.tipManager = null;


            


            // 进阶等级配置表


            this.LEVEL_ORDER_MAP = [


                { level: 100, order: 1 },


                { level: 200, order: 2 },


                { level: 300, order: 3 },


                { level: 500, order: 4 },


                { level: 700, order: 5 },


                { level: 900, order: 6 },


                { level: 1100, order: 7 },


                { level: 1300, order: 8 },


                { level: 1500, order: 9 },


                { level: 1800, order: 10 },


                { level: 2100, order: 11 },


                { level: 2400, order: 12 },


                { level: 2800, order: 13 },


                { level: 3200, order: 14 },


                { level: 3600, order: 15 },


                { level: 4000, order: 16 },


                { level: 4500, order: 17 },


                { level: 5000, order: 18 },


                { level: 5500, order: 19 },


            ];


            


            this.init();


        }





        init() {


            this.startInjection();


            this.initManagementPanel();


        }





        // 显示提示信息


        // 显示提示信息


        showTip(message, type = 'info') {


            try {


                // 按需获取TipManager


                if (typeof unsafeWindow.__require === 'function') {


                    const TipsManager = unsafeWindow.__require('TipsManager');


                    if (TipsManager && typeof TipsManager.SHOW_TIP === 'function') {


                        TipsManager.SHOW_TIP(message);


                        return;


                    }


                }


                console.warn('[英雄队伍增强] TipsManager不可用');


            } catch (error) {


                console.error('[英雄队伍增强] 显示提示失败:', error);


            }


        }





        // 数据管理方法


        // 加载当前角色的队伍数据


        loadCurrentRoleTeams() {


            try {


                const allTeams = this.loadTeams();


                const ServerData = unsafeWindow.__require('ServerData');


                const currentRoleId = ServerData?.ROLE?.roleId;


                


                if (!currentRoleId) {


                    console.warn('[英雄队伍增强] 无法获取当前角色ID');


                    return allTeams; // 如果无法获取角色ID，返回所有队伍


                }


                


                // 过滤出当前角色的队伍


                return allTeams.filter(team => team.formation?.roleId === currentRoleId);


            } catch (error) {


                console.error('[英雄队伍增强] 加载当前角色队伍数据失败:', error);


                return [];


            }


        }





        loadTeams() {


            try {


                const data = localStorage.getItem(this.storageKey);


                return data ? JSON.parse(data) : [];


            } catch (error) {


                console.error('[英雄队伍增强] 加载数据失败:', error);


                return [];


            }


        }


        // 显示输入对话框


        showInputDialog(title, defaultValue = '', placeholder = '') {


            return new Promise((resolve) => {


                const overlay = document.createElement('div');


                overlay.className = 'input-dialog-overlay';


                overlay.style.display = 'flex';


                


                const dialog = document.createElement('div');


                dialog.className = 'input-dialog';


                


                dialog.innerHTML = `


                    <div class="input-dialog-title">${title}</div>


                    <div class="input-dialog-content">


                        <input type="text" class="input-dialog-input" value="${defaultValue}" placeholder="${placeholder}" />


                    </div>


                    <div class="input-dialog-buttons">


                        <button class="input-dialog-btn input-dialog-btn-cancel">取消</button>


                        <button class="input-dialog-btn input-dialog-btn-confirm">确定</button>


                    </div>


                `;


                


                overlay.appendChild(dialog);


                document.body.appendChild(overlay);


                


                const input = dialog.querySelector('.input-dialog-input');


                const cancelBtn = dialog.querySelector('.input-dialog-btn-cancel');


                const confirmBtn = dialog.querySelector('.input-dialog-btn-confirm');


                


                // 自动聚焦并选中文本


                setTimeout(() => {


                    input.focus();


                    if (defaultValue) {


                        input.select();


                    }


                }, 100);


                


                // 关闭对话框


                const closeDialog = (result) => {


                    overlay.remove();


                    resolve(result);


                };


                


                // 取消按钮


                cancelBtn.onclick = () => closeDialog(null);


                


                // 点击遮罩关闭


                overlay.onclick = (e) => {


                    if (e.target === overlay) {


                        closeDialog(null);


                    }


                };


                


                // 确定按钮


                confirmBtn.onclick = () => {


                    const value = input.value.trim();


                    closeDialog(value || null);


                };


                


                // 回车确认


                input.onkeydown = (e) => {


                    if (e.key === 'Enter') {


                        const value = input.value.trim();


                        closeDialog(value || null);


                    } else if (e.key === 'Escape') {


                        closeDialog(null);


                    }


                };


            });


        }





        // 显示阵容槽确认对话框


        showPresetTeamConfirmDialog(currentSlot, targetSlot) {


            return new Promise((resolve) => {


                const overlay = document.createElement('div');


                overlay.className = 'input-dialog-overlay';


                overlay.style.display = 'flex';


                


                const dialog = document.createElement('div');


                dialog.className = 'input-dialog';


                


                dialog.innerHTML = `


                    <div class="input-dialog-title">阵容槽不一致</div>


                    <div class="input-dialog-content">


                        <div style="padding: 10px 0; line-height: 1.5;">


                            当前阵容槽：<strong>${currentSlot || '未知'}</strong><br>


                            保存阵容槽：<strong>${targetSlot || '未知'}</strong><br><br>


                            当前阵容槽与保存阵容槽不一致，是否进行切换？


                        </div>


                    </div>


                    <div class="input-dialog-buttons">


                        <button class="input-dialog-btn input-dialog-btn-cancel">取消</button>


                        <button class="input-dialog-btn input-dialog-btn-confirm">继续</button>


                    </div>


                `;


                


                overlay.appendChild(dialog);


                document.body.appendChild(overlay);


                


                const cancelBtn = dialog.querySelector('.input-dialog-btn-cancel');


                const confirmBtn = dialog.querySelector('.input-dialog-btn-confirm');


                


                // 关闭对话框


                const closeDialog = (result) => {


                    overlay.remove();


                    resolve(result);


                };


                


                // 取消按钮


                cancelBtn.onclick = () => closeDialog(false);


                


                // 点击遮罩关闭（默认取消）


                overlay.onclick = (e) => {


                    if (e.target === overlay) {


                        closeDialog(false);


                    }


                };


                


                // 继续按钮


                confirmBtn.onclick = () => closeDialog(true);


                


                // 键盘事件


                document.addEventListener('keydown', function keyHandler(e) {


                    if (e.key === 'Escape') {


                        document.removeEventListener('keydown', keyHandler);


                        closeDialog(false);


                    } else if (e.key === 'Enter') {


                        document.removeEventListener('keydown', keyHandler);


                        closeDialog(true);


                    }


                });


            });


        }





        // 显示确认对话框（替代原生 confirm，修复 iOS WebView 中 confirm 被禁用导致无法删除等问题）


        showConfirmDialog(message, title = '确认操作', confirmText = '确定', cancelText = '取消') {


            return new Promise((resolve) => {


                const overlay = document.createElement('div');


                overlay.className = 'input-dialog-overlay';


                overlay.style.display = 'flex';





                const dialog = document.createElement('div');


                dialog.className = 'input-dialog';


                // 转义 message 中的 HTML 特殊字符，并将换行转为 <br>


                const safeMessage = String(message)


                    .replace(/&/g, '&amp;')


                    .replace(/</g, '&lt;')


                    .replace(/>/g, '&gt;')


                    .replace(/\n/g, '<br>');





                dialog.innerHTML = `


                    <div class="input-dialog-title">${title}</div>


                    <div class="input-dialog-content">


                        <div style="padding: 10px 0; line-height: 1.5;">${safeMessage}</div>


                    </div>


                    <div class="input-dialog-buttons">


                        <button class="input-dialog-btn input-dialog-btn-cancel">${cancelText}</button>


                        <button class="input-dialog-btn input-dialog-btn-confirm">${confirmText}</button>


                    </div>


                `;





                overlay.appendChild(dialog);


                document.body.appendChild(overlay);





                const cancelBtn = dialog.querySelector('.input-dialog-btn-cancel');


                const confirmBtn = dialog.querySelector('.input-dialog-btn-confirm');


                const keyHandler = (e) => {


                    if (e.key === 'Escape') closeDialog(false);


                    else if (e.key === 'Enter') closeDialog(true);


                };


                const closeDialog = (result) => {


                    overlay.remove();


                    document.removeEventListener('keydown', keyHandler);


                    resolve(result);


                };





                cancelBtn.onclick = () => closeDialog(false);


                confirmBtn.onclick = () => closeDialog(true);


                overlay.onclick = (e) => {


                    if (e.target === overlay) closeDialog(false);


                };


                document.addEventListener('keydown', keyHandler);


            });


        }





        // 手动映射对话框（exchange 指纹反查失败时用）


        //   入参：failedSaveds (Set<savedHeroId>), ROLE


        //   返回：Promise<Map<savedHeroId, currentHeroId>>，Map 为空表示全部跳过


        showManualExchangeDialog(failedSaveds, ROLE) {


            return new Promise((resolve) => {


                const savedArr = Array.from(failedSaveds).map(x => parseInt(x));


                if (savedArr.length === 0) { resolve(new Map()); return; }





                // 收集当前账号所有英雄用于下拉选择


                const heroes = [];


                try {


                    if (ROLE.heroes && typeof ROLE.heroes.forEach === 'function') {


                        ROLE.heroes.forEach((h, hid) => {


                            heroes.push({


                                id: parseInt(hid),


                                name: this.getHeroName(hid),


                                order: (h && h.order) || 0,


                                level: (h && h.level) || 1,


                            });


                        });


                    } else if (ROLE.heroes) {


                        for (const [hid, h] of Object.entries(ROLE.heroes)) {


                            heroes.push({


                                id: parseInt(hid),


                                name: this.getHeroName(hid),


                                order: (h && h.order) || 0,


                                level: (h && h.level) || 1,


                            });


                        }


                    }


                } catch (e) { console.warn('[英雄队伍增强] 收集 ROLE.heroes 失败:', e); }


                heroes.sort((a, b) => a.id - b.id);





                // 武将品质颜色（与星驰-无登录.js/武将配速 一致）


                const qualityColor = (heroId) => {


                    const id = parseInt(heroId);


                    if (id >= 101 && id <= 121) return '#e53e3e'; // 红


                    if (id === 215 || id === 227 || id === 228 || (id >= 301 && id <= 312)) return '#9f7aea'; // 紫


                    if ((id >= 201 && id <= 214) || (id >= 216 && id <= 226) || id === 313 || id === 314) return '#ed8936'; // 橙


                    return 'inherit';


                };





                // 一次性注入下拉框样式（与星驰-无登录.js 武将配速一致）


                if (!document.getElementById('xc-manual-map-style')) {


                    const st = document.createElement('style');


                    st.id = 'xc-manual-map-style';


                    st.textContent = `


                        .xc-mm-dropdown-option { transition: background .15s ease; }


                        .xc-mm-dropdown-option:hover { background: rgba(49,130,206,0.1); }


                        .xc-mm-dropdown-option.selected { background: rgba(49,130,206,0.15); font-weight: 600; }


                        .xc-mm-options::-webkit-scrollbar { display: none; }


                    `;


                    document.head.appendChild(st);


                }





                const overlay = document.createElement('div');


                overlay.className = 'input-dialog-overlay';


                overlay.style.display = 'flex';





                const dialog = document.createElement('div');


                dialog.className = 'input-dialog';


                dialog.style.maxWidth = '600px';


                dialog.style.maxHeight = '85vh';


                dialog.style.overflowY = 'auto';





                // 帮 saved 英雄构造装备简述（前 4 件 confId）便于辨认


                const equipSummary = (sid) => {


                    try {


                        const teams = this.loadTeams();


                        for (const t of teams) {


                            if (!t.formation || !Array.isArray(t.formation)) continue;


                            for (const f of t.formation) {


                                if (f && f.heroes && f.heroes[sid] && f.heroes[sid].equipment) {


                                    const eq = f.heroes[sid].equipment;


                                    const slots = [];


                                    for (let k = 1; k <= 4; k++) {


                                        const s = eq[k] || eq[String(k)];


                                        if (s) {


                                            const cid = s.equipConfId || s.confId || (s.equip && (s.equip.confId || s.equip.equipConfId)) || 0;


                                            const lv = s.level != null ? s.level : (s.equip && s.equip.level) || 0;


                                            const fg = s.forge != null ? s.forge : (s.equip && s.equip.forge) || 0;


                                            slots.push(`槽${k}:#${cid}/Lv${lv}/锻${fg}`);


                                        }


                                    }


                                    if (slots.length) return slots.join('  ');


                                }


                            }


                        }


                    } catch (e) {}


                    return '（无装备特征）';


                };





                let html = '';


                html += `<div class="input-dialog-title">⚠️ 装备反查失败 — 需手动指认载体</div>`;


                html += `<div class="input-dialog-content" style="font-size:12px;line-height:1.6;">`;


                // 详细说明


                html += `<div style="background:#fff8e1;border:1px solid #ffe082;border-radius:6px;padding:10px 12px;margin-bottom:10px;color:#5d4037;">


                    <div style="font-weight:600;margin-bottom:4px;">📖 这是什么 / 为什么需要你确认？</div>


                    <div>切换队伍时脚本通过<b>装备指纹</b>把 saved 的培养数据无损搬到当前对应英雄上。下面 ${savedArr.length} 个 saved 英雄因 <b>装备已被多次洗炼/重铸</b> 导致指纹漂移，自动反查（精确指纹 / 弹性指纹 / 槽位兜底）全部失败，需要你<b>手动指认</b>当前账号上"戴着这件装备"的英雄。</div>


                    <div style="margin-top:6px;color:#b71c1c;">⚠️ 选错会把别人的装备/培养转走，请<b>对照 saved 的装备特征</b>仔细选；不确定就选"跳过"，跳过的 saved 英雄本次不会执行 exchange。</div>


                </div>`;


                // 操作步骤


                html += `<div style="background:#e8f5e9;border:1px solid #a5d6a7;border-radius:6px;padding:10px 12px;margin-bottom:10px;color:#1b5e20;">


                    <div style="font-weight:600;margin-bottom:4px;">✅ 怎么选？</div>


                    <div>① 看每行<b>"saved 装备特征"</b>里的 <code>#confId / Lv / 锻造</code>；</div>


                    <div>② 在游戏里翻到那件装备 → 看它现在戴在哪个武将身上；</div>


                    <div>③ 在下拉框中选中那个武将。</div>


                </div>`;





                for (const sid of savedArr) {


                    const savedName = this.getHeroName(sid);


                    const summary = equipSummary(sid);


                    html += `<div style="margin:10px 0;padding:10px;border:1px solid #ddd;border-radius:6px;background:#fafafa;">`;


                    html += `<div style="font-weight:600;margin-bottom:4px;font-size:13px;">saved：<span style="color:${qualityColor(sid)};">${savedName}(${sid})</span></div>`;


                    html += `<div style="font-size:11px;color:#616161;margin-bottom:8px;font-family:monospace;">装备特征：${summary}</div>`;


                    html += `<div style="font-size:12px;color:#424242;margin-bottom:4px;">当前账号上这件装备戴在 →</div>`;


                    // 自定义下拉框


                    html += `<div class="xc-mm-dropdown" data-saved="${sid}" data-value="" style="position:relative;">


                        <div class="xc-mm-selected" style="padding:6px 10px;border:1px solid rgba(0,0,0,0.15);border-radius:6px;background:white;font-size:12px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;">


                            <span class="xc-mm-selected-text" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">-- 跳过（不 exchange） --</span>


                            <span style="margin-left:4px;">▼</span>


                        </div>


                        <div class="xc-mm-options" style="display:none;position:fixed;max-height:60vh;overflow-y:scroll;overflow-x:hidden;background:white;border:1px solid rgba(0,0,0,0.15);border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,0.15);z-index:10001;-webkit-overflow-scrolling:touch;scrollbar-width:none;-ms-overflow-style:none;">


                            <div class="xc-mm-dropdown-option selected" data-value="" style="padding:6px 10px;font-size:12px;cursor:pointer;color:#999;">-- 跳过（不 exchange） --</div>`;


                    for (const h of heroes) {


                        const c = qualityColor(h.id);


                        html += `<div class="xc-mm-dropdown-option" data-value="${h.id}" data-color="${c}" data-label="${h.name}(${h.id}) Lv${h.level} 阶${h.order}" style="padding:6px 10px;font-size:12px;cursor:pointer;color:${c};">${h.name}(${h.id}) Lv${h.level} 阶${h.order}</div>`;


                    }


                    html += `</div></div></div>`;


                }


                html += `</div><div class="input-dialog-buttons">`;


                html += `<button class="input-dialog-btn input-dialog-btn-cancel">全部跳过</button>`;


                html += `<button class="input-dialog-btn input-dialog-btn-confirm">确认映射</button>`;


                html += `</div>`;





                dialog.innerHTML = html;


                overlay.appendChild(dialog);


                document.body.appendChild(overlay);





                // 自定义下拉框交互（同一时间仅展开一个）


                const closeAllOptions = () => {


                    dialog.querySelectorAll('.xc-mm-options').forEach(o => o.style.display = 'none');


                };


                dialog.querySelectorAll('.xc-mm-dropdown').forEach(dd => {


                    const sel = dd.querySelector('.xc-mm-selected');


                    const opts = dd.querySelector('.xc-mm-options');


                    const txt = dd.querySelector('.xc-mm-selected-text');


                    sel.addEventListener('click', (e) => {


                        e.stopPropagation();


                        const isOpen = opts.style.display === 'block';


                        closeAllOptions();


                        if (!isOpen) {


                            const r = sel.getBoundingClientRect();


                            opts.style.left = r.left + 'px';


                            opts.style.top = (r.bottom + 2) + 'px';


                            opts.style.width = r.width + 'px';


                            opts.style.display = 'block';


                        }


                    });


                    opts.querySelectorAll('.xc-mm-dropdown-option').forEach(opt => {


                        opt.addEventListener('click', (e) => {


                            e.stopPropagation();


                            const v = opt.dataset.value;


                            dd.dataset.value = v;


                            txt.textContent = opt.dataset.label || opt.textContent;


                            txt.style.color = v ? (opt.dataset.color || 'inherit') : '#999';


                            opts.querySelectorAll('.xc-mm-dropdown-option').forEach(o => o.classList.remove('selected'));


                            opt.classList.add('selected');


                            opts.style.display = 'none';


                        });


                    });


                });


                document.addEventListener('click', closeAllOptions, { once: false });





                const close = (m) => {


                    document.removeEventListener('click', closeAllOptions);


                    overlay.remove();


                    resolve(m);


                };


                dialog.querySelector('.input-dialog-btn-cancel').onclick = () => close(new Map());


                dialog.querySelector('.input-dialog-btn-confirm').onclick = () => {


                    const m = new Map();


                    const usedCurr = new Set();


                    dialog.querySelectorAll('.xc-mm-dropdown').forEach(dd => {


                        const sid = parseInt(dd.dataset.saved);


                        const cid = parseInt(dd.dataset.value);


                        if (cid && !usedCurr.has(cid)) {


                            m.set(sid, cid);


                            usedCurr.add(cid);


                        }


                    });


                    close(m);


                };


                overlay.addEventListener('click', (e) => { if (e.target === overlay) close(new Map()); });


            });


        }





        saveTeams(teams) {


            try {


                localStorage.setItem(this.storageKey, JSON.stringify(teams));


                return true;


            } catch (error) {


                console.error('[英雄队伍增强] 保存数据失败:', error);


                return false;


            }


        }





        addTeam(name, formation) {


            const teams = this.loadTeams();


            const newTeam = {


                id: Date.now(),


                name: name,


                formation: formation || [],


                createDate: new Date().toISOString()


            };


            teams.push(newTeam);


            this.saveTeams(teams);


            return newTeam;


        }





        deleteTeam(id) {


            const teams = this.loadTeams();


            const filtered = teams.filter(t => t.id !== id);


            this.saveTeams(filtered);


        }





        updateTeam(id, updates) {


            const teams = this.loadTeams();


            const index = teams.findIndex(t => t.id === id);


            if (index !== -1) {


                teams[index] = { ...teams[index], ...updates };


                this.saveTeams(teams);


                return true;


            }


            return false;


        }


        // 初始化管理面板


        initManagementPanel() {


            // 注入样式


            const style = document.createElement('style');


            style.textContent = `


                #hero-team-panel {


                    display: none;


                    position: fixed;


                    top: 50%;


                    left: 50%;


                    transform: translate(-50%, -50%);


                    width: 88%;


                    min-width: 100px;


                    max-width: 560px;


                    min-height: 100px;


                    max-height: 78vh;


                    background: rgba(248, 248, 250, 0.98);


                    backdrop-filter: blur(40px) saturate(180%);


                    -webkit-backdrop-filter: blur(40px) saturate(180%);


                    border-radius: 16px;


                    box-shadow: 0 24px 80px rgba(0,0,0,0.22), 0 0 0 0.5px rgba(255,255,255,0.25) inset;


                    z-index: 10000;


                    flex-direction: column;


                    overflow: hidden;


                    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Helvetica Neue', sans-serif;


                }


                


                .hero-team-header {


                    padding: 16px 16px 12px 16px;


                    background: linear-gradient(180deg, rgba(255,255,255,0.8), rgba(255,255,255,0));


                    border-bottom: 0.5px solid rgba(0, 0, 0, 0.06);


                    display: flex;


                    justify-content: space-between;


                    align-items: center;


                    flex-shrink: 0;


                }


                


                .hero-team-header h3 {


                    margin: 0;


                    color: #1c1c1e;


                    font-size: 16px;


                    font-weight: 700;


                    letter-spacing: -0.3px;


                }


                


                .hero-team-header-actions {


                    display: flex;


                    gap: 6px;


                    align-items: center;


                }


                


                .hero-team-header-btn {


                    background: rgba(120, 120, 128, 0.1);


                    border: none;


                    color: #007AFF;


                    width: 30px;


                    height: 30px;


                    border-radius: 50%;


                    cursor: pointer;


                    display: flex;


                    align-items: center;


                    justify-content: center;


                    transition: all 0.15s ease;


                }


                


                .hero-team-header-btn svg {


                    width: 16px;


                    height: 16px;


                    fill: currentColor;


                }


                


                .hero-team-header-btn:active {


                    background: rgba(0, 122, 255, 0.15);


                    transform: scale(0.9);


                }


                


                .hero-team-close {


                    background: rgba(120, 120, 128, 0.1);


                    border: none;


                    color: #8e8e93;


                    width: 30px;


                    height: 30px;


                    border-radius: 50%;


                    cursor: pointer;


                    transition: all 0.15s ease;


                    display: flex;


                    align-items: center;


                    justify-content: center;


                }


                


                .hero-team-close svg {


                    width: 14px;


                    height: 14px;


                    fill: currentColor;


                }


                


                .hero-team-close:active {


                    background: rgba(120, 120, 128, 0.2);


                    transform: scale(0.9);


                }


                


                .hero-team-search {


                    padding: 4px 16px 8px;


                    background: transparent;


                    flex-shrink: 0;


                }


                


                .hero-team-search input {


                    width: 100%;


                    padding: 8px 12px;


                    border: none;


                    border-radius: 8px;


                    background: rgba(120, 120, 128, 0.08);


                    font-size: 13px;


                    outline: none;


                    color: #1c1c1e;


                    box-sizing: border-box;


                    transition: all 0.2s ease;


                }


                


                .hero-team-search input:focus {


                    background: rgba(120, 120, 128, 0.12);


                    box-shadow: 0 0 0 2px rgba(0, 122, 255, 0.18);


                }


                


                .hero-team-search input::placeholder {


                    color: rgba(60, 60, 67, 0.35);


                }


                


                .hero-team-list {


                    flex: 1;


                    overflow-y: auto;


                    overflow-x: hidden;


                    padding: 0 16px 16px 16px;


                    min-height: 0;


                }


                


                .hero-team-list::-webkit-scrollbar {


                    width: 3px;


                }


                


                .hero-team-list::-webkit-scrollbar-track {


                    background: transparent;


                }


                


                .hero-team-list::-webkit-scrollbar-thumb {


                    background: rgba(0, 0, 0, 0.1);


                    border-radius: 3px;


                }


                


                .hero-team-item {


                    position: relative;


                    display: flex;


                    user-select: none;


                    overflow: hidden;


                    width: 100%;


                    background: #fff;


                    border-radius: 10px;


                    box-shadow: 0 1px 3px rgba(0,0,0,0.05), 0 0 0 0.5px rgba(0,0,0,0.04);


                    margin-bottom: 8px;


                    transition: box-shadow 0.15s ease;


                }


                


                .hero-team-item:active {


                    box-shadow: 0 0 1px rgba(0,0,0,0.04);


                }


                


                .hero-team-item:last-child { 


                    margin-bottom: 0;


                }


                


                .hero-team-item-wrapper {


                    display: flex;


                    min-width: 100%;


                    transition: transform 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);


                }


                


                .hero-team-item-content {


                    display: flex;


                    flex-direction: column;


                    width: 100%;


                    min-width: 100%;


                    padding: 10px 12px;


                    background: #fff;


                    flex-shrink: 0;


                    box-sizing: border-box;


                    border-radius: 10px;


                    gap: 7px;


                }


                


                .hero-team-item-actions-bg {


                    display: flex;


                    align-items: stretch;


                    flex-shrink: 0;


                    width: 130px;


                }


                


                .hero-team-swipe-btn {


                    width: 65px;


                    border: none;


                    color: white;


                    font-size: 11px;


                    cursor: pointer;


                    display: flex;


                    flex-direction: column;


                    align-items: center;


                    justify-content: center;


                    gap: 3px;


                    padding: 0;


                    transition: opacity 0.15s;


                    flex-shrink: 0;


                }


                


                .hero-team-swipe-btn:active {


                    opacity: 0.7;


                }


                


                .hero-team-swipe-btn svg {


                    width: 18px;


                    height: 18px;


                }


                


                .hero-team-swipe-btn-edit {


                    background: #8e8e93;


                }


                


                .hero-team-swipe-btn-delete {


                    background: #ff3b30;


                }


                


                .hero-team-item-info {


                    flex: 1;


                    min-width: 0;


                    text-align: left;


                }


                


                .hero-team-item-header {


                    display: flex;


                    justify-content: space-between;


                    align-items: center;


                    gap: 6px;


                }


                


                .hero-team-item-name {


                    font-size: 13px;


                    font-weight: 600;


                    color: #1c1c1e;


                    white-space: nowrap;


                    overflow: hidden;


                    text-overflow: ellipsis;


                    flex: 1;


                    min-width: 0;


                }


                


                .hero-team-item-meta {


                    display: flex;


                    align-items: center;


                    gap: 5px;


                    flex-shrink: 0;


                }


                


                .hero-team-item-slot {


                    font-size: 9px;


                    color: #007AFF;


                    background: rgba(0, 122, 255, 0.08);


                    padding: 1px 5px;


                    border-radius: 4px;


                    white-space: nowrap;


                    font-weight: 500;


                }


                


                .hero-team-item-date,


                .hero-team-item-time {


                    font-size: 9px;


                    color: rgba(60, 60, 67, 0.35);


                    white-space: nowrap;


                }


                


                .hero-team-item-heroes {


                    display: flex;


                    gap: 3px;


                    flex-wrap: nowrap;


                    align-items: stretch;


                }


                .hero-icon-img {


                    flex: 1 1 0;


                    max-width: 30px;


                    min-width: 0;


                    aspect-ratio: 1;


                    border-radius: 5px;


                    object-fit: cover;


                    background: rgba(0,0,0,0.03);


                    border: 0.5px solid rgba(0,0,0,0.06);


                }


                /* 全身立绘（纵向 portrait，立绘 3:4 比例） */


                .hero-team-heroes-list {


                    display: flex;


                    gap: 4px;


                    flex: 1 1 auto;


                    min-width: 0;


                    align-items: flex-start;


                }


                /* 单个英雄竖向列：立绘 + 信息行 */


                .hero-fullbody-col {


                    flex: 1 1 0;


                    max-width: 54px;


                    min-width: 0;


                    display: flex;


                    flex-direction: column;


                    gap: 3px;


                }


                .hero-fullbody-wrap {


                    width: 100%;


                    aspect-ratio: 3 / 4;


                    border-radius: 6px;


                    overflow: hidden;


                    background: linear-gradient(180deg, rgba(0,0,0,0.04), rgba(0,0,0,0.08));


                    border: 0.5px solid rgba(0,0,0,0.08);


                    box-shadow: 0 1px 2px rgba(0,0,0,0.08);


                }


                .hero-fullbody-img {


                    width: 100%;


                    height: 100%;


                    object-fit: cover;


                    object-position: top center;


                    display: block;


                }


                /* 等级独占一行（立绘下方第一行；不截断，允许轻微溢出） */


                .hero-lv-text {


                    font-size: 10px;


                    font-weight: 800;


                    color: #d97706;


                    line-height: 1;


                    text-align: center;


                    white-space: nowrap;


                    letter-spacing: -0.6px;


                    min-height: 11px;


                    overflow: visible;


                }


                /* 第二行：鱼灵图 + 鱼珠技能名 同行排列 */


                .hero-art-pearl-row {


                    display: flex;


                    align-items: center;


                    justify-content: center;


                    gap: 2px;


                    min-height: 14px;


                    min-width: 0;


                }


                .hero-artifact-icon {


                    width: 14px;


                    height: 14px;


                    object-fit: contain;


                    border-radius: 3px;


                    background: rgba(0,0,0,0.04);


                    flex: 0 0 auto;


                }


                .hero-pearl-name {


                    font-size: 9px;


                    font-weight: 600;


                    line-height: 1.1;


                    white-space: nowrap;


                    overflow: hidden;


                    text-overflow: ellipsis;


                    text-shadow: 0 0 2px rgba(255,255,255,0.8);


                    min-width: 0;


                    flex: 1 1 auto;


                    text-align: left;


                }


                /* 主公武器图标（卡片右侧固定区块） */


                .hero-team-weapon-box {


                    flex: 0 0 auto;


                    display: flex;


                    align-items: center;


                    justify-content: center;


                    margin-left: 6px;


                    padding-left: 6px;


                    border-left: 1px dashed rgba(0,0,0,0.12);


                }


                .hero-team-weapon-img {


                    width: 40px;


                    height: 40px;


                    object-fit: contain;


                    border-radius: 6px;


                    background: rgba(0,0,0,0.04);


                    border: 0.5px solid rgba(0,0,0,0.08);


                    padding: 2px;


                }


                .hero-team-weapon-empty {


                    width: 40px;


                    height: 40px;


                    border-radius: 6px;


                    background: rgba(0,0,0,0.03);


                    border: 0.5px dashed rgba(0,0,0,0.12);


                    display: flex;


                    align-items: center;


                    justify-content: center;


                    font-size: 9px;


                    color: rgba(60,60,67,0.4);


                }


                


                .hero-team-use-btn {


                    background: #34C759;


                    color: #fff;


                    border: none;


                    border-radius: 6px;


                    padding: 4px 10px;


                    font-size: 11px;


                    font-weight: 600;


                    cursor: pointer;


                    transition: all 0.15s ease;


                    display: flex;


                    align-items: center;


                    justify-content: center;


                    gap: 3px;


                    flex-shrink: 0;


                    letter-spacing: 0.2px;


                }


                


                .hero-team-use-btn svg {


                    width: 11px;


                    height: 11px;


                    fill: currentColor;


                }


                


                .hero-team-use-btn:active {


                    background: #2db84e;


                    transform: scale(0.94);


                }


                


                .hero-team-empty {


                    text-align: center;


                    padding: 48px 20px;


                    color: rgba(60, 60, 67, 0.3);


                    font-size: 13px;


                }


                .hero-team-empty::before {


                    content: '📋';


                    display: block;


                    font-size: 32px;


                    margin-bottom: 8px;


                    opacity: 0.5;


                }


                


                /* 输入对话框样式 */


                .input-dialog-overlay {


                    display: none;


                    position: fixed;


                    top: 0;


                    left: 0;


                    right: 0;


                    bottom: 0;


                    background: rgba(0, 0, 0, 0.35);


                    z-index: 10002;


                    align-items: center;


                    justify-content: center;


                }


                .input-dialog {


                    background: rgba(255, 255, 255, 0.98);


                    backdrop-filter: blur(40px) saturate(180%);


                    -webkit-backdrop-filter: blur(40px) saturate(180%);


                    border-radius: 14px;


                    width: 80%;


                    max-width: 300px;


                    overflow: hidden;


                    box-shadow: 0 24px 80px rgba(0,0,0,0.22);


                }


                .input-dialog-title {


                    padding: 20px 16px 8px 16px;


                    text-align: center;


                    font-size: 15px;


                    font-weight: 600;


                    color: #1c1c1e;


                }


                .input-dialog-content {


                    padding: 10px 16px 20px 16px;


                }


                .input-dialog-input {


                    width: 100%;


                    padding: 10px 12px;


                    border: none;


                    border-radius: 8px;


                    background: rgba(120, 120, 128, 0.08);


                    font-size: 14px;


                    box-sizing: border-box;


                    outline: none;


                    color: #1c1c1e;


                    transition: all 0.2s ease;


                }


                .input-dialog-input:focus {


                    background: rgba(120, 120, 128, 0.1);


                    box-shadow: 0 0 0 2px rgba(0, 122, 255, 0.18);


                }


                .input-dialog-input::placeholder {


                    color: rgba(60, 60, 67, 0.35);


                }


                .input-dialog-buttons {


                    display: flex;


                    border-top: 0.5px solid rgba(0, 0, 0, 0.06);


                }


                .input-dialog-btn {


                    flex: 1;


                    padding: 13px;


                    border: none;


                    background: transparent;


                    font-size: 15px;


                    cursor: pointer;


                    transition: background 0.15s;


                    color: #007AFF;


                }


                .input-dialog-btn:active {


                    background: rgba(0, 0, 0, 0.03);


                }


                .input-dialog-btn + .input-dialog-btn {


                    border-left: 0.5px solid rgba(0, 0, 0, 0.06);


                }


                .input-dialog-btn-cancel {


                    color: #8e8e93;


                }


                .input-dialog-btn-confirm {


                    font-weight: 600;


                }





                /* ========== UI v2：头部操作区重构 ========== */


                .hero-team-actions {


                    display: flex;


                    gap: 8px;


                    padding: 0 12px;


                    margin-top: 8px;


                    margin-bottom: 10px;


                    align-items: stretch;


                }


                .act-btn {


                    flex: 1;


                    display: flex;


                    flex-direction: column;


                    align-items: center;


                    justify-content: center;


                    gap: 3px;


                    min-width: 0;


                    padding: 6px 4px;


                    border: none;


                    border-radius: 10px;


                    background: transparent;


                    cursor: pointer;


                    transition: background 0.15s ease, transform 0.1s ease;


                    position: relative;


                    color: inherit;


                }


                .act-btn svg {


                    width: 18px;


                    height: 18px;


                    pointer-events: none;


                }


                .act-btn .act-label {


                    font-size: 10px;


                    line-height: 1;


                    font-weight: 500;


                    color: rgba(60, 60, 67, 0.72);


                    letter-spacing: 0.2px;


                    pointer-events: none;


                }


                .act-btn:hover  { background: rgba(0, 0, 0, 0.04); }


                .act-btn:active { background: rgba(0, 0, 0, 0.08); transform: scale(0.96); }


                .act-btn[disabled], .act-btn.disabled {


                    opacity: 0.35;


                    pointer-events: none;


                    cursor: not-allowed;


                }





                /* 主操作：新建 */


                .act-btn.act-primary {


                    flex: 0 0 64px;


                    background: rgba(0, 122, 255, 0.10);


                }


                .act-btn.act-primary:hover { background: rgba(0, 122, 255, 0.16); }


                .act-btn.act-primary svg { fill: #007AFF; }


                .act-btn.act-primary .act-label { color: #007AFF; font-weight: 600; }





                /* 分段容器（本地文件 / 云端同步） */


                .act-group {


                    flex: 1;


                    display: flex;


                    flex-direction: column;


                    background: rgba(120, 120, 128, 0.08);


                    border-radius: 12px;


                    padding: 4px;


                    gap: 2px;


                    position: relative;


                }


                .act-group-row {


                    display: flex;


                    gap: 4px;


                }


                .act-group-row > .act-btn {


                    padding: 4px 2px;


                }


                .act-group-label {


                    text-align: center;


                    font-size: 9px;


                    line-height: 1;


                    color: rgba(60, 60, 67, 0.55);


                    padding-bottom: 2px;


                    letter-spacing: 0.3px;


                    pointer-events: none;


                }





                /* 语义色（图标+标签同色） */


                .act-btn.act-import svg { fill: #34C759; }


                .act-btn.act-import .act-label { color: #34C759; }


                .act-btn.act-export svg { fill: #FF9500; }


                .act-btn.act-export .act-label { color: #FF9500; }


                .act-btn.act-cloud-up svg { fill: #5AC8FA; }


                .act-btn.act-cloud-up .act-label { color: #5AC8FA; }


                .act-btn.act-cloud-down svg { fill: #AF52DE; }


                .act-btn.act-cloud-down .act-label { color: #AF52DE; }





                /* 云端组禁用态（桥不可用） */


                .act-group.cloud-unavailable {


                    opacity: 0.45;


                    pointer-events: none;


                }


                .act-group.cloud-unavailable::after {


                    content: '未绑定卡密';


                    position: absolute;


                    right: 6px;


                    top: 4px;


                    font-size: 9px;


                    padding: 1px 5px;


                    border-radius: 6px;


                    background: rgba(142, 142, 147, 0.18);


                    color: rgba(60, 60, 67, 0.7);


                    pointer-events: none;


                }





                /* Loading 旋转态 */


                @keyframes act-spin { to { transform: rotate(360deg); } }


                .act-btn.loading svg { animation: act-spin 0.8s linear infinite; }


                .act-btn.loading .act-label::after {


                    content: '...';


                }





                /* Tooltip 气泡（hover 显示，移动端 touchstart 长按触发） */


                .act-btn[data-tip]:hover::after,


                .act-btn[data-tip].show-tip::after {


                    content: attr(data-tip);


                    position: absolute;


                    bottom: calc(100% + 4px);


                    left: 50%;


                    transform: translateX(-50%);


                    white-space: nowrap;


                    background: rgba(28, 28, 30, 0.92);


                    color: #fff;


                    font-size: 11px;


                    font-weight: 400;


                    padding: 4px 8px;


                    border-radius: 6px;


                    pointer-events: none;


                    z-index: 10;


                    box-shadow: 0 4px 12px rgba(0,0,0,0.15);


                }


                .act-btn[data-tip]:hover::before,


                .act-btn[data-tip].show-tip::before {


                    content: '';


                    position: absolute;


                    bottom: calc(100% - 1px);


                    left: 50%;


                    transform: translateX(-50%);


                    border: 4px solid transparent;


                    border-top-color: rgba(28, 28, 30, 0.92);


                    pointer-events: none;


                    z-index: 10;


                }





                /* 云端组底部 label 带"清空"迷你按钮 */


                .act-group-label-cloud {


                    display: flex;


                    align-items: center;


                    justify-content: center;


                    gap: 4px;


                    pointer-events: auto;


                }


                .act-group-label-cloud > span {


                    pointer-events: none;


                }


                .act-cloud-clear {


                    all: unset;


                    display: inline-flex;


                    align-items: center;


                    justify-content: center;


                    width: 14px;


                    height: 14px;


                    border-radius: 4px;


                    cursor: pointer;


                    opacity: 0.5;


                    transition: opacity 0.15s ease, background 0.15s ease;


                    position: relative;


                }


                .act-cloud-clear:hover {


                    opacity: 1;


                    background: rgba(255, 59, 48, 0.12);


                }


                .act-cloud-clear:active {


                    background: rgba(255, 59, 48, 0.22);


                }


                .act-cloud-clear svg {


                    width: 10px;


                    height: 10px;


                    fill: #FF3B30;


                }


                /* 复用 tooltip 气泡逻辑到清空按钮 */


                .act-cloud-clear[data-tip]:hover::after,


                .act-cloud-clear[data-tip].show-tip::after {


                    content: attr(data-tip);


                    position: absolute;


                    bottom: calc(100% + 4px);


                    left: 50%;


                    transform: translateX(-50%);


                    white-space: nowrap;


                    background: rgba(28, 28, 30, 0.92);


                    color: #fff;


                    font-size: 11px;


                    padding: 4px 8px;


                    border-radius: 6px;


                    pointer-events: none;


                    z-index: 10;


                }





                /* 列表项左侧槽位色条（叠加到现有 .hero-team-item 上，不破坏右滑手势） */


                .hero-team-item { position: relative; }


                .hero-team-item[data-slot="1"] > .hero-team-item-wrapper { box-shadow: inset 3px 0 0 0 #007AFF; }


                .hero-team-item[data-slot="2"] > .hero-team-item-wrapper { box-shadow: inset 3px 0 0 0 #34C759; }


                .hero-team-item[data-slot="3"] > .hero-team-item-wrapper { box-shadow: inset 3px 0 0 0 #FF9500; }


                .hero-team-item[data-slot="4"] > .hero-team-item-wrapper { box-shadow: inset 3px 0 0 0 #AF52DE; }


            `;


            document.head.appendChild(style);


            // 创建面板 HTML


            const panel = document.createElement('div');


            panel.id = 'hero-team-panel';


            panel.innerHTML = `


                <div class="hero-team-header">


                    <h3>队伍管理</h3>


                    <button class="hero-team-close" title="关闭" aria-label="关闭">


                        <svg viewBox="0 0 1024 1024"><path d="M556.8 512L832 236.8c12.8-12.8 12.8-32 0-44.8-12.8-12.8-32-12.8-44.8 0L512 467.2l-275.2-277.333333c-12.8-12.8-32-12.8-44.8 0-12.8 12.8-12.8 32 0 44.8l275.2 277.333333-277.333333 275.2c-12.8 12.8-12.8 32 0 44.8 6.4 6.4 14.933333 8.533333 23.466666 8.533333s17.066667-2.133333 23.466667-8.533333L512 556.8 787.2 832c6.4 6.4 14.933333 8.533333 23.466667 8.533333s17.066667-2.133333 23.466666-8.533333c12.8-12.8 12.8-32 0-44.8L556.8 512z" fill="currentColor"/></svg>


                    </button>


                </div>


                <div class="hero-team-search">


                    <input type="text" id="hero-team-search-input" placeholder="搜索队伍名称..." />


                </div>


                <div class="hero-team-actions">


                    <button id="hero-team-save-btn" class="act-btn act-primary" data-tip="新建队伍 · 保存当前阵容" aria-label="新建队伍">


                        <svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>


                        <span class="act-label">新建</span>


                    </button>


                    <div class="act-group" aria-label="本地文件">


                        <div class="act-group-row">


                            <div id="hero-team-import-btn" class="act-btn act-import" data-tip="从 JSON 文件导入" aria-label="导入 JSON" style="position: relative; overflow: hidden;">


                                <input type="file" id="hero-team-file-input" accept=".json,application/json,text/plain,*/*" style="position: absolute; left: 0; top: 0; width: 100%; height: 100%; opacity: 0.01; cursor: pointer; z-index: 10;" />


                                <svg viewBox="0 0 24 24"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>


                                <span class="act-label">导入</span>


                            </div>


                            <button id="hero-team-export-btn" class="act-btn act-export" data-tip="导出为 JSON 文件" aria-label="导出 JSON">


                                <svg viewBox="0 0 24 24"><path d="M19 12v7H5v-7H3v9h18v-9h-2zM12 3L6.5 8.5 8 10l3-3v10h2V7l3 3 1.5-1.5z"/></svg>


                                <span class="act-label">导出</span>


                            </button>


                        </div>


                        <div class="act-group-label">本地文件</div>


                    </div>


                    <div class="act-group act-group-cloud" id="hero-team-cloud-group" aria-label="云端同步">


                        <div class="act-group-row">


                            <button id="hero-team-cloud-upload-btn" class="act-btn act-cloud-up" data-tip="上传到云端（按卡密隔离）" aria-label="上传到云端">


                                <svg viewBox="0 0 24 24"><path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z"/></svg>


                                <span class="act-label">上云</span>


                            </button>


                            <button id="hero-team-cloud-download-btn" class="act-btn act-cloud-down" data-tip="从云端下载合并" aria-label="从云端下载">


                                <svg viewBox="0 0 24 24"><path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/></svg>


                                <span class="act-label">下云</span>


                            </button>


                        </div>


                        <div class="act-group-label act-group-label-cloud">


                            <span>云端同步</span>


                            <button id="hero-team-cloud-delete-btn" class="act-cloud-clear" data-tip="清空云端存档" aria-label="清空云端存档">


                                <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>


                            </button>


                        </div>


                    </div>


                </div>


                <div class="hero-team-list" id="hero-team-list"></div>


            `;


            document.body.appendChild(panel);





            this.managementPanel = panel;


            this.bindPanelEvents();


        }





        // 绑定面板事件


        bindPanelEvents() {


            const panel = this.managementPanel;


            const closeBtn = panel.querySelector('.hero-team-close');


            const searchInput = panel.querySelector('#hero-team-search-input');


            const saveBtn = panel.querySelector('#hero-team-save-btn');


            const exportBtn = panel.querySelector('#hero-team-export-btn');


            const importBtn = panel.querySelector('#hero-team-import-btn');


            const cloudUploadBtn = panel.querySelector('#hero-team-cloud-upload-btn');


            const cloudDownloadBtn = panel.querySelector('#hero-team-cloud-download-btn');


            const fileInput = panel.querySelector('#hero-team-file-input');





            // 关闭按钮


            closeBtn.addEventListener('click', () => {


                this.hidePanel();


            });





            // 搜索功能


            searchInput.addEventListener('input', (e) => {


                this.renderTeamList(e.target.value);


            });





            // 保存按钮


            saveBtn.addEventListener('click', () => {


                this.handleSave();


            });





            // 导出按钮


            exportBtn.addEventListener('click', () => {


                this.handleExport();


            });





            // 文件选择（通过透明 input 原生触发，绕过 Android WebView 对 JS click() 的拦截）


            fileInput.addEventListener('change', (e) => {


                if (e.target.files && e.target.files.length > 0) {


                    this.handleImport(e.target.files[0]);


                }


                e.target.value = '';


            });





            // 云端上传


            if (cloudUploadBtn) {


                cloudUploadBtn.addEventListener('click', () => { this.handleCloudUpload(); });


            }


            // 云端下载


            if (cloudDownloadBtn) {


                cloudDownloadBtn.addEventListener('click', () => { this.handleCloudDownload(); });


            }


            // 清空云端存档（危险操作，带二次确认）


            const cloudDeleteBtn = panel.querySelector('#hero-team-cloud-delete-btn');


            if (cloudDeleteBtn) {


                cloudDeleteBtn.addEventListener('click', () => { this.handleCloudDelete(); });


            }





            // 云端组可用性刷新


            this.refreshCloudBtnsState();





            // 移动端/触屏：长按 400ms 显示 tooltip（桌面依赖 :hover 伪类，无需 JS）


            panel.querySelectorAll('.act-btn[data-tip], .act-cloud-clear[data-tip]').forEach((btn) => {


                let pressTimer = null;


                const showTip = () => btn.classList.add('show-tip');


                const hideTip = () => btn.classList.remove('show-tip');


                btn.addEventListener('touchstart', () => {


                    pressTimer = setTimeout(showTip, 400);


                }, { passive: true });


                btn.addEventListener('touchend', () => {


                    clearTimeout(pressTimer);


                    setTimeout(hideTip, 1200);


                });


                btn.addEventListener('touchmove', () => {


                    clearTimeout(pressTimer);


                    hideTip();


                });


                btn.addEventListener('touchcancel', () => {


                    clearTimeout(pressTimer);


                    hideTip();


                });


            });


        }





        // 显示面板


        showPanel() {


            if (this.managementPanel) {


                this.managementPanel.style.display = 'flex';


                this.renderTeamList();


                // 首次打开时自动拉一次云端存档（若可用），合并后刷新列表


                this.autoPullCloudOnce();


            }


        }





        // 自动拉取一次云端存档：按 roleId 节流，每个角色每次会话仅拉一次


        // 仅静默合并新增/更新，不覆盖本地更晚的记录（复用 mergeTeams 逻辑）


        autoPullCloudOnce() {


            try {


                if (!CloudSave.isAvailable()) return;


                const gameId = this.getCloudGameId();


                if (!gameId || gameId === 'default') return;


                this._cloudPulledGames = this._cloudPulledGames || new Set();


                if (this._cloudPulledGames.has(gameId)) return;


                this._cloudPulledGames.add(gameId);





                CloudSave.get(gameId, this.storageKey).then((resp) => {


                    if (!resp || !resp.success || !resp.exists) return;


                    let remoteTeams = [];


                    try {


                        const parsed = JSON.parse(resp.content || '{}');


                        remoteTeams = Array.isArray(parsed) ? parsed : (parsed.teams || []);


                    } catch (_) { return; }


                    if (!Array.isArray(remoteTeams) || remoteTeams.length === 0) return;





                    const existing = this.loadTeams();


                    const merged = this.mergeTeams(existing, remoteTeams);


                    const added = merged.length - existing.length;


                    // 变动才持久化 + 重绘


                    if (added > 0 || JSON.stringify(merged) !== JSON.stringify(existing)) {


                        this.saveTeams(merged);


                        this.renderTeamList();


                        if (added > 0) {


                            this.showTip(`已从云端同步 ${added} 个新队伍`, 'success');


                        }


                        console.log('[英雄队伍增强] 云端自动同步完成:', { remote: remoteTeams.length, added });


                    }


                }).catch((err) => {


                    // 自动拉取失败保持静默，避免打扰用户


                    console.warn('[英雄队伍增强] 云端自动拉取失败:', err && err.message);


                });


            } catch (e) {


                console.warn('[英雄队伍增强] autoPullCloudOnce 异常:', e && e.message);


            }


        }





        // 隐藏面板


        hidePanel() {


            if (this.managementPanel) {


                this.managementPanel.style.display = 'none';


            }


        }





        // 获取当前云端存档 gameId（优先使用游戏内 roleId；取不到则回退到 "default"）


        getCloudGameId() {


            try {


                const ServerData = unsafeWindow.__require && unsafeWindow.__require('ServerData');


                const rid = ServerData && ServerData.ROLE && ServerData.ROLE.roleId;


                if (rid) return String(rid);


            } catch (_) {}


            return 'default';


        }





        // 根据 CloudSave 桥可用性切换云端组禁用态


        refreshCloudBtnsState() {


            if (!this.managementPanel) return;


            const group = this.managementPanel.querySelector('#hero-team-cloud-group');


            if (!group) return;


            if (CloudSave.isAvailable()) {


                group.classList.remove('cloud-unavailable');


            } else {


                group.classList.add('cloud-unavailable');


            }


        }





        // 给按钮临时加 loading 态（旋转图标）


        setBtnLoading(selector, on) {


            if (!this.managementPanel) return;


            const btn = this.managementPanel.querySelector(selector);


            if (!btn) return;


            if (on) {


                btn.classList.add('loading');


                btn.setAttribute('disabled', 'disabled');


            } else {


                btn.classList.remove('loading');


                btn.removeAttribute('disabled');


            }


        }





        // 上传到云端（按卡密+gameId 覆盖式同步：仅上传当前角色的队伍，云端同 gameId 的旧存档整体被替换）


        async handleCloudUpload() {


            this.setBtnLoading('#hero-team-cloud-upload-btn', true);


            try {


                if (!CloudSave.isAvailable()) {


                    this.showTip('需要绑定卡密才能上传云端', 'error');


                    return;


                }


                const gameId = this.getCloudGameId();


                if (gameId === 'default') {


                    this.showTip('未获取到角色ID，无法上传', 'error');


                    return;


                }


                // 仅上传当前角色的队伍：云端按 gameId 隔离，覆盖式同步保证"同 id 新阵容覆盖旧阵容"


                const teams = this.loadCurrentRoleTeams();


                const payload = {


                    version: this.version,


                    updatedAt: new Date().toISOString(),


                    gameId: gameId,


                    teams: teams,


                };


                this.showTip('正在上传到云端...', 'info');


                const resp = await CloudSave.put(gameId, this.storageKey, JSON.stringify(payload));


                if (resp && resp.success) {


                    this.showTip(`云端保存成功（当前角色 ${teams.length} 个队伍，已覆盖旧存档）`, 'success');


                    console.log('[英雄队伍增强] 云端上传成功:', { gameId, count: teams.length, resp });


                } else {


                    this.showTip(`云端保存失败：${(resp && resp.message) || '未知错误'}`, 'error');


                }


            } catch (e) {


                console.error('[英雄队伍增强] 云端上传失败:', e);


                this.showTip(`云端保存失败：${(e && e.message) || '网络异常'}`, 'error');


            } finally {


                this.setBtnLoading('#hero-team-cloud-upload-btn', false);


            }


        }





        // 从云端下载（会与本地智能合并，沿用 mergeTeams）


        async handleCloudDownload() {


            this.setBtnLoading('#hero-team-cloud-download-btn', true);


            try {


                if (!CloudSave.isAvailable()) {


                    this.showTip('需要绑定卡密才能下载云端', 'error');


                    return;


                }


                const gameId = this.getCloudGameId();


                this.showTip('正在从云端拉取...', 'info');


                const resp = await CloudSave.get(gameId, this.storageKey);


                if (!resp || !resp.success) {


                    this.showTip(`云端读取失败：${(resp && resp.message) || '未知错误'}`, 'error');


                    return;


                }


                if (!resp.exists) {


                    this.showTip('云端暂无该角色的存档', 'info');


                    return;


                }


                let remoteTeams = [];


                try {


                    const parsed = JSON.parse(resp.content || '{}');


                    remoteTeams = Array.isArray(parsed) ? parsed : (parsed.teams || []);


                } catch (parseErr) {


                    this.showTip('云端数据格式异常', 'error');


                    return;


                }


                if (!Array.isArray(remoteTeams)) {


                    this.showTip('云端数据结构异常', 'error');


                    return;


                }


                const existingTeams = this.loadTeams();


                const merged = this.mergeTeams(existingTeams, remoteTeams);


                this.saveTeams(merged);


                this.renderTeamList();


                const addedCount = merged.length - existingTeams.length;


                const updatedCount = remoteTeams.length - Math.max(0, addedCount);


                let msg = '云端同步完成！';


                if (addedCount > 0) msg += ` 新增${addedCount}个`;


                if (updatedCount > 0) msg += ` 更新${updatedCount}个`;


                this.showTip(msg, 'success');


                console.log('[英雄队伍增强] 云端下载成功:', { addedCount, updatedCount });


            } catch (e) {


                console.error('[英雄队伍增强] 云端下载失败:', e);


                this.showTip(`云端读取失败：${(e && e.message) || '网络异常'}`, 'error');


            } finally {


                this.setBtnLoading('#hero-team-cloud-download-btn', false);


            }


        }





        // 清空云端存档（删除当前 roleId 对应的云端整条存档，不影响本地）


        async handleCloudDelete() {


            try {


                if (!CloudSave.isAvailable()) {


                    this.showTip('需要绑定卡密才能操作云端', 'error');


                    return;


                }


                const gameId = this.getCloudGameId();


                // 二次确认，防止误触（改用自定义对话框，修复 iOS 删除阵容失败）


                const ok = await this.showConfirmDialog(


                    `确定要清空角色【${gameId}】在云端的队伍存档吗？\n此操作不可恢复，但不会影响本地已保存的队伍。`,


                    '清空云端存档',


                    '清空'


                );


                if (!ok) return;





                this.setBtnLoading('#hero-team-cloud-download-btn', true);


                this.showTip('正在清空云端存档...', 'info');


                const resp = await CloudSave.del(gameId, this.storageKey);


                if (resp && resp.success) {


                    this.showTip('云端存档已清空', 'success');


                    console.log('[英雄队伍增强] 云端清空成功:', resp);


                    // 允许本次会话重新自动拉取（下次打开面板时不会立即覆盖本地）


                    if (this._cloudPulledGames) this._cloudPulledGames.delete(gameId);


                } else {


                    this.showTip(`云端清空失败：${(resp && resp.message) || '未知错误'}`, 'error');


                }


            } catch (e) {


                console.error('[英雄队伍增强] 云端清空失败:', e);


                this.showTip(`云端清空失败：${(e && e.message) || '网络异常'}`, 'error');


            } finally {


                this.setBtnLoading('#hero-team-cloud-download-btn', false);


            }


        }





        // 处理队伍操作


        handleTeamAction(action, id) {


            const teams = this.loadTeams();


            const team = teams.find(t => t.id === id);


            if (!team) return;





            switch (action) {


                case 'use':


                    this.switchToTeam(team);


                    break;


                case 'edit':


                    this.handleEdit(team);


                    break;


                case 'delete':


                    // 改用自定义确认对话框，修复 iOS WebView 中原生 confirm 被禁用导致无法删除阵容的问题


                    this.showConfirmDialog(`确定要删除队伍“${team.name}”吗？`, '删除队伍', '删除').then((ok) => {


                        if (!ok) return;


                        this.deleteTeam(id);


                        this.renderTeamList();


                    });


                    break;


            }


        }





        // 切换到指定队伍


        async switchToTeam(team) {


            try {


                this.showTip(`开始切换到队伍"${team.name}"...`, 'info');


                


                // 关闭管理面板


                this.hidePanel();


                


                // 步骤1：获取游戏数据


                this.showTip('步骤1/13：获取游戏数据...', 'info');


                const ServerData = unsafeWindow.__require('ServerData');


                if (!ServerData || !ServerData.ROLE) {


                    throw new Error('无法获取游戏数据对象');


                }


                const ROLE = ServerData.ROLE;


                const formation = team.formation;


                


                if (!formation) {


                    throw new Error('队伍阵容数据无效');


                }


                // 步骤2：检查阵容槽


                this.showTip('步骤2/13：检查阵容槽位...', 'info');


                const currentPresetTeamId = ROLE.presetTeamId;


                const targetPresetTeamId = formation.presetTeamId;


                


                if (currentPresetTeamId !== targetPresetTeamId) {                    


                    const shouldContinue = await this.showPresetTeamConfirmDialog(currentPresetTeamId, targetPresetTeamId);


                    if (!shouldContinue) {


                        this.showTip('已取消切换队伍', 'info');


                        return;


                    }


                }


                // 步骤3：获取服务对象


                this.showTip('步骤3/13：初始化游戏服务...', 'info');


                const dataIndex = unsafeWindow.__require("data-index");


                if (!dataIndex || !dataIndex.HeroService) {


                    throw new Error('无法获取HeroService');


                }


                const HeroService = dataIndex.HeroService;


                // 步骤4：英雄交换


                this.showTip('步骤4/13：处理英雄交换...', 'info');


                await this.processHeroExchange(formation, ROLE, HeroService);


                


                // 步骤5：英雄等级升级


                this.showTip('步骤5/13：检查英雄等级...', 'info');


                await this.processHeroLevelUpgrade(formation, ROLE, HeroService);


                


                // 步骤6：鱼灵配置


                this.showTip('步骤6/13：配置鱼灵装备...', 'info');


                await this.processHeroArtifacts(formation, ROLE, dataIndex.ArtifactService);


                


                // 步骤7：鱼珠技能配置


                this.showTip('步骤7/13：配置鱼珠技能...', 'info');


                await this.processHeroPearlSkills(formation, ROLE, dataIndex.PearlService);


                


                // 步骤8：水晶和装备正反面


                this.showTip('步骤8/13：配置水晶和装备...', 'info');


                await this.processHeroTrumpAndEquipment(formation, ROLE, dataIndex.TrumpService, dataIndex.EquipmentService);


                


                // 步骤9：俱乐部科技


                this.showTip('步骤9/13：配置俱乐部科技...', 'info');


                await this.processLegionResearch(formation, ROLE, dataIndex.LegionService);





                // 步骤10：主公武器


                this.showTip('步骤10/13：配置玩具...', 'info');


                await this.processLordWeapon(formation, ROLE, dataIndex.LordWeaponService);





                // 步骤11：皮肤切换


                this.showTip('步骤11/13：检查英雄皮肤...', 'info');


                await this.processHeroSkins(formation, ROLE, HeroService);





                // 步骤12：调整英雄位置


                this.showTip('步骤12/13：调整战斗位置...', 'info');


                await this.processHeroBattlePosition(formation, ROLE, HeroService);





                // 步骤13：刷新界面


                this.showTip('步骤13/13：刷新游戏界面...', 'info');


                await this.refreshMainPageFormation(dataIndex.FightService);


                


                // 应用其他配置


                await this.applyFormation(formation, ROLE);





                // 切换成功后自动刷新 saved 指纹（防止洗炼漂移累积导致下次切换失配）


                console.log('[英雄队伍增强] 调用 refreshTeamFingerprints…');


                try { await this.refreshTeamFingerprints(team, ROLE); } catch (e) { console.warn('[英雄队伍增强] refreshTeamFingerprints 异常:', e); }





                this.showTip(`✅ 成功切换到队伍"${team.name}"`, 'success');


                


            } catch (error) {


                console.error('[英雄队伍增强] 切换队伍失败:', error);


                this.showTip(`❌ 切换失败: ${error.message}`, 'error');


            }


        }





        // 处理英雄交换


        async processHeroExchange(formation, ROLE, HeroService) {


            try {


                if (!formation.heroes || !ROLE.heroes) {


                    console.log('[英雄队伍增强] 跳过英雄交换：无英雄数据');


                    return;


                }





                let exchangeCount = 0;


                const totalHeroes = Object.keys(formation.heroes).length;





                // ── 兼容新版游戏：hero.attachmentUid 字段被官方移除后用 battleTeam 槽位反查 ──


                // 老路径：saved.attachmentUid → 当前账号上同 attachmentUid 的英雄 B → exchange(saved, B)


                // 新路径：saved 在 saved.battleTeam 上占的 slot K → 当前账号 ROLE.battleTeam[K].heroId 即 B → exchange(saved, B)


                // 语义等价：都是把"当前已上阵的英雄 B"的培养数据无损转给"保存阵容期望的英雄 saved"


                const currentBattleSlotMap = {}; // slot -> currentHeroId


                try {


                    if (ROLE.battleTeam && typeof ROLE.battleTeam.forEach === 'function') {


                        ROLE.battleTeam.forEach((d, slot) => {


                            if (d && d.heroId) currentBattleSlotMap[slot] = d.heroId;


                        });


                    }


                } catch (e) { console.warn('[英雄队伍增强] 读取当前 battleTeam 失败:', e); }





                const savedHeroToSlot = {}; // savedHeroId -> slot


                if (formation.battleTeam) {


                    for (const [s, hid] of Object.entries(formation.battleTeam)) {


                        if (hid) savedHeroToSlot[parseInt(hid)] = parseInt(s);


                    }


                }


                console.log('[英雄队伍增强][exchange-diag] currentBattleSlotMap=', JSON.stringify(currentBattleSlotMap),


                    'savedHeroToSlot=', JSON.stringify(savedHeroToSlot),


                    'formation.heroes keys=', Object.keys(formation.heroes || {}));





                // saved 陈旧检测：如果 saved.equipment 只有 curQuenchId（老版脚本 extractEquipment bug 的产物），


                // 提示用户重存阵容。这种 saved 的 stable fp 全是空签名，反查必碰撞 → 触发白板化


                try {


                    let staleCount = 0;


                    for (const [hid, h] of Object.entries(formation.heroes || {})) {


                        if (!h || !h.equipment) continue;


                        for (const slot of [1, 2, 3, 4]) {


                            const piece = h.equipment[slot] || h.equipment[String(slot)];


                            if (piece && typeof piece === 'object') {


                                const keys = Object.keys(piece);


                                const hasStableField = keys.some(k => ['level', 'forge', 'star', 'seed', 'attack'].includes(k));


                                if (!hasStableField && keys.length > 0) staleCount++;


                            }


                        }


                    }


                    if (staleCount > 0) {


                        console.warn(`[英雄队伍增强][exchange-diag] ⚠️ 检测到 ${staleCount} 个装备槽缺少稳定字段（老版本 extractEquipment bug），建议重新保存阵容以获得精确反查能力。当前会降级使用 battleSlot + pool 兜底。`);


                    }


                } catch (e) {}





                // 防止指纹冲突（fallback 分支可能误把多 saved 反查到同一个英雄）：


                // 一个 currentHeroId 只能被一个 saved 占用，第二个尝试占用时强制降级到下一路径


                const usedCurrentIds = new Set();





                // 白板保护：判断候选英雄是否已培养（有等级/装备/技能）


                // 避免兜底路径选到从未培养的新英雄 → exchange 后 saved 变 1 级无装备


                const isCultivated = (hero) => {


                    if (!hero) return false;


                    if ((hero.level || 1) > 1) return true;


                    if ((hero.order || 0) > 0) return true;


                    // 装备任一槽位有内容


                    try {


                        const eq = hero.equipment;


                        if (eq) {


                            for (const slot of [1, 2, 3, 4]) {


                                let piece = null;


                                if (typeof eq.get === 'function') piece = eq.get(slot) || eq.get(String(slot));


                                else piece = eq[slot] || eq[String(slot)];


                                if (piece && typeof piece === 'object') {


                                    const eid = Number(piece.equipId) || 0;


                                    const lv = Number(piece.level) || 0;


                                    const fg = Number(piece.forge) || 0;


                                    const st = Number(piece.star) || 0;


                                    if (eid > 0 || lv > 1 || fg > 0 || st > 0) return true;


                                }


                            }


                        }


                    } catch (e) {}


                    return false;


                };





                // 解析 fp 状态用于诊断输出


                const _fpKind = (fp) => {


                    if (!fp) return '<none>';


                    if (fp === '__none__') return '<none>';


                    return '<set>';


                };





                // ── exchange 任务收集与执行（两阶段）──


                // 阶段 1：先决定所有 saved → current 反查映射，不立即执行 exchange


                // 阶段 2：按依赖顺序执行——「current 是 saved 阵容内部英雄」的优先执行


                //


                // 必要性：当 saved 阵容与当前阵容存在共同英雄（heroId 同时在两边）时，


                // 共同英雄当前可能戴着属于 saved 阵容另一个英雄的装备（之前切换链路的副产物）。


                // 如果先 exchange(共同英雄, ...) 把装备换掉，后续 exchange(其他saved, 共同英雄) 就拿不到正确装备。


                // 所以「current ∈ saved 集合」的 exchange（即从 saved 阵容内部成员身上拿装备）必须先执行。


                const savedHeroIdSet = new Set(Object.keys(formation.heroes).map(k => parseInt(k)));


                const exchangeTasks = []; // {saved:number, current:number, internal:boolean, viaTag:string}


                // 追踪反查失败（跳过 exchange）的 saved —— 后续 processHeroLevelUpgrade 应跳过这些避免把白板强行升级


                this._exchangeFailedSaved = new Set();





                // 遍历保存阵容中的每个英雄（仅做反查，不执行 exchange）


                for (const [savedHeroId, heroConfig] of Object.entries(formation.heroes)) {


                    let currentHeroId = null;


                    let resolveBy = 'none';





                    // ── 反查策略（按用户诉求：装备跟着武将走）──


                    // 语义：saved 武将 X 当时穿戴的具体装备实例，现在戴在哪个英雄 B 身上 → exchange(X, B)


                    //       让 X 接管 B 的英雄身份（连同那件装备）。装备指纹是"装备实例身份"的唯一可识别特征，


                    //       所以指纹反查是最符合语义的路径。battleSlot 仅作为未培养装备（指纹无信号）的兜底。


                    //


                    // 路径 1：装备指纹反查（最优先，符合用户语义）


                    // 先做 self-check：当前账号上 heroId=savedHeroId 自己的装备指纹若匹配 saved.fp，


                    // 说明装备从未动过（或早已归位），exchange 自己 → 自己是 no-op，用自身即可


                    if (heroConfig.equipmentFp && heroConfig.equipmentFp !== '__none__') {


                        const savedHidNum = parseInt(savedHeroId);


                        const selfHero = this.getHeroFromMap(ROLE.heroes, savedHidNum);


                        let selfFpForDiag = null;


                        if (selfHero && !usedCurrentIds.has(savedHidNum)) {


                            try {


                                const selfFp = this.getEquipmentFingerprint(selfHero.equipment);


                                selfFpForDiag = selfFp;


                                if (selfFp === heroConfig.equipmentFp) {


                                    currentHeroId = savedHidNum;


                                    resolveBy = 'equipFp(self)';


                                }


                            } catch (e) {}


                        }


                        if (!currentHeroId) {


                            const found = this.findHeroByEquipmentFingerprint(heroConfig.equipmentFp, ROLE.heroes);


                            if (found && !usedCurrentIds.has(parseInt(found))) {


                                currentHeroId = found;


                                resolveBy = 'equipFp';


                            } else if (found) {


                                console.warn(`[英雄队伍增强][exchange-diag] saved=${savedHeroId} 指纹反查到 ${found} 已被占用（指纹冲突），降级`);


                            } else if (selfFpForDiag !== null) {


                                // 完全 fp 全英雄查找失败 → 打印具体差异，让用户判断装备 P 是否还存在/在哪


                                console.warn(`[英雄队伍增强][exchange-diag-fp] saved=${savedHeroId} 完全fp无匹配:\n  saved.fp = ${heroConfig.equipmentFp}\n  self.fp  = ${selfFpForDiag}\n  说明 saved 时的装备实例当前不存在/属性已变 → 走弹性fp或battleSlot兜底`);


                            }


                        }


                    }





                    // 路径 1.5：弹性装备指纹反查（fp 全部失败后用 stable 模式重试 — 容忍洗炼变化）


                    // 装备洗炼会改变 quenches/quenchTimes/quenchAttackExt 等字段，使完整 fp 失配；


                    // stable 模式仅比对 forge/forgeExp/star/seed/level/atk/def/hp 等洗炼不影响的字段


                    // 兼容旧 saved：如果 equipmentFpStable 字段不存在，从 saved.equipment 现场计算


                    let stableFp = heroConfig.equipmentFpStable;


                    if (!stableFp && heroConfig.equipment) {


                        try {


                            stableFp = this.getEquipmentFingerprint(heroConfig.equipment, 'stable');


                        } catch (e) {}


                    }


                    if (!currentHeroId && stableFp && stableFp !== '__none__') {


                        const savedHidNum = parseInt(savedHeroId);


                        const selfHero = this.getHeroFromMap(ROLE.heroes, savedHidNum);


                        if (selfHero && !usedCurrentIds.has(savedHidNum)) {


                            try {


                                const selfFpStable = this.getEquipmentFingerprint(selfHero.equipment, 'stable');


                                if (selfFpStable === stableFp) {


                                    currentHeroId = savedHidNum;


                                    resolveBy = 'equipFpStable(self)';


                                }


                            } catch (e) {}


                        }


                        if (!currentHeroId) {


                            const found = this.findHeroByEquipmentFingerprint(stableFp, ROLE.heroes, 'stable');


                            if (found && !usedCurrentIds.has(parseInt(found))) {


                                currentHeroId = found;


                                resolveBy = 'equipFpStable';


                            } else if (found) {


                                console.warn(`[英雄队伍增强][exchange-diag] saved=${savedHeroId} 弹性指纹反查到 ${found} 已被占用，降级`);


                            }


                        }


                    }





                    // 路径 2：attachmentUid 反查（旧版游戏字段兼容，新版已为 null）


                    if (!currentHeroId && heroConfig.attachmentUid) {


                        const found = this.findHeroByAttachmentUid(heroConfig.attachmentUid, ROLE.heroes);


                        if (found && !usedCurrentIds.has(parseInt(found))) {


                            currentHeroId = found;


                            resolveBy = 'attachmentUid';


                        }


                    }





                    // 路径 3：battleSlot 槽位反查（兜底，仅当装备未练度/指纹无信号时使用）


                    // saved 在 saved.battleTeam 占的槽位 K → 当前 ROLE.battleTeam[K].heroId 即载体 B


                    // 白板保护：候选必须已培养，否则 exchange(saved, 白板) 会把 saved 变成 1 级无装备


                    if (!currentHeroId) {


                        const targetSlot = savedHeroToSlot[parseInt(savedHeroId)];


                        if (targetSlot !== undefined && currentBattleSlotMap[targetSlot]) {


                            const cand = currentBattleSlotMap[targetSlot];


                            if (!usedCurrentIds.has(parseInt(cand))) {


                                const candHero = this.getHeroFromMap(ROLE.heroes, parseInt(cand));


                                if (isCultivated(candHero)) {


                                    currentHeroId = cand;


                                    resolveBy = 'battleSlot';


                                } else {


                                    console.warn(`[英雄队伍增强][exchange-diag] saved=${savedHeroId} battleSlot候选 ${cand} 是白板英雄，跳过`);


                                }


                            }


                        }


                    }





                    // 路径 4：未占用池兜底（防止贪心顺序导致 saved 找不到目标的死锁）


                    // 当 fp/弹性fp/battleSlot 都失败/被占用时，从 ROLE.heroes 中找一个未占用的英雄


                    // 优先级：① saved 自己（如果未占用，exchange 自己 → 自己即可视为 no-op）


                    //         ② 与 saved 弹性 fp 最相似的未占用英雄


                    //         ③ 任意未占用英雄


                    if (!currentHeroId) {


                        const savedHidNum = parseInt(savedHeroId);


                        // ① saved 自身可用且已培养？（白板保护：避免 saved 因 no-op 保持 1 级状态）


                        const selfHero = this.getHeroFromMap(ROLE.heroes, savedHidNum);


                        if (selfHero && !usedCurrentIds.has(savedHidNum) && isCultivated(selfHero)) {


                            currentHeroId = savedHidNum;


                            resolveBy = 'pool(self)';


                        } else {


                            // ② 收集所有未占用的已培养英雄（白板不选，防止 saved 变 1 级）


                            const freeHeroes = [];


                            try {


                                if (typeof ROLE.heroes.forEach === 'function') {


                                    ROLE.heroes.forEach((h, hid) => {


                                        if (h && !usedCurrentIds.has(parseInt(hid)) && isCultivated(h)) freeHeroes.push(parseInt(hid));


                                    });


                                } else {


                                    Object.keys(ROLE.heroes).forEach(hid => {


                                        if (!usedCurrentIds.has(parseInt(hid))) {


                                            const h = this.getHeroFromMap(ROLE.heroes, parseInt(hid));


                                            if (isCultivated(h)) freeHeroes.push(parseInt(hid));


                                        }


                                    });


                                }


                            } catch (e) {}


                            if (freeHeroes.length > 0) {


                                // 优先选弹性 fp 相似的


                                let best = null;


                                if (heroConfig.equipmentFpStable && heroConfig.equipmentFpStable !== '__none__') {


                                    for (const hid of freeHeroes) {


                                        try {


                                            const h = this.getHeroFromMap(ROLE.heroes, hid);


                                            if (h && this.getEquipmentFingerprint(h.equipment, 'stable') === heroConfig.equipmentFpStable) {


                                                best = hid; break;


                                            }


                                        } catch (e) {}


                                    }


                                }


                                if (best === null) {


                                    // 取 saved.battleSlot 最近的未占用英雄（最大概率正确）


                                    const targetSlot = savedHeroToSlot[savedHidNum];


                                    if (targetSlot !== undefined) {


                                        // 按 currentBattleSlotMap 距离排序


                                        const slotsSorted = Object.keys(currentBattleSlotMap)


                                            .map(s => parseInt(s))


                                            .sort((a, b) => Math.abs(a - targetSlot) - Math.abs(b - targetSlot));


                                        for (const s of slotsSorted) {


                                            const cand = parseInt(currentBattleSlotMap[s]);


                                            if (freeHeroes.indexOf(cand) >= 0) { best = cand; break; }


                                        }


                                    }


                                }


                                if (best === null) best = freeHeroes[0];


                                currentHeroId = best;


                                resolveBy = 'pool';


                            }


                        }


                    }





                    if (currentHeroId) {


                        usedCurrentIds.add(parseInt(currentHeroId));


                    }





                    console.log(`[英雄队伍增强][exchange-diag] saved=${savedHeroId} fp=${_fpKind(heroConfig.equipmentFp)} attachUid=${heroConfig.attachmentUid} -> current=${currentHeroId} via=${resolveBy}`);





                    if (!currentHeroId) {


                        // 反查完全失败：装备找不到载体，同时池里也没有已培养英雄可兜底


                        // 记录下来 → processHeroLevelUpgrade 跳过，避免把白板 X 强行升到 saved.level


                        this._exchangeFailedSaved.add(parseInt(savedHeroId));


                        console.warn(`[英雄队伍增强][exchange-diag] ⚠️ saved=${savedHeroId} 反查全失败，将跳过等级升级以免白板被强行升级`);


                        continue;


                    }





                    // 比对英雄ID是否一致 → 加入 exchange 任务列表（不立即执行）


                    if (parseInt(savedHeroId) !== parseInt(currentHeroId)) {


                        const sId = parseInt(savedHeroId);


                        const cId = parseInt(currentHeroId);


                        exchangeTasks.push({


                            saved: sId,


                            current: cId,


                            internal: savedHeroIdSet.has(cId),


                            viaTag: resolveBy,


                        });


                    }


                }





                // ── 阶段 1.5：双向互指任务去重 ──


                // 关键 bug：当 saved A 反查到 current B，同时 saved B 反查到 current A（两武将装备被互换）时，


                // exchange(A, B) 后再 exchange(B, A) 会互相抵消 → 装备回到错误状态 → 用户报告"装备未切换"。


                // 解决：对称任务 (A↔B) 只保留其中一条（保留 viaTag 更可信、或 internal=true 的那条）。


                {


                    const pairPriority = { 'equipFp': 100, 'equipFp(self)': 95, 'equipFpStable': 80, 'equipFpStable(self)': 75, 'attachmentUid': 70, 'battleSlot': 50, 'pool(self)': 30, 'pool(nearest)': 20, 'pool(any)': 10 };


                    const keyMap = new Map(); // "A_B" (A<B) -> task index


                    const removedIdx = new Set();


                    for (let i = 0; i < exchangeTasks.length; i++) {


                        const t = exchangeTasks[i];


                        const a = Math.min(t.saved, t.current);


                        const b = Math.max(t.saved, t.current);


                        const key = `${a}_${b}`;


                        if (!keyMap.has(key)) { keyMap.set(key, i); continue; }


                        const prevIdx = keyMap.get(key);


                        const prev = exchangeTasks[prevIdx];


                        const curScore = (t.internal ? 1000 : 0) + (pairPriority[t.viaTag] || 0);


                        const prevScore = (prev.internal ? 1000 : 0) + (pairPriority[prev.viaTag] || 0);


                        if (curScore > prevScore) {


                            removedIdx.add(prevIdx); keyMap.set(key, i);


                        } else {


                            removedIdx.add(i);


                        }


                        console.log(`[英雄队伍增强][exchange-diag] 双向互指去重 ${a}↔${b}：保留 ${curScore > prevScore ? i : prevIdx}（score ${Math.max(curScore, prevScore)}），去掉 ${curScore > prevScore ? prevIdx : i}`);


                    }


                    if (removedIdx.size > 0) {


                        const filtered = exchangeTasks.filter((_, i) => !removedIdx.has(i));


                        exchangeTasks.length = 0;


                        exchangeTasks.push(...filtered);


                    }


                }





                // ── 阶段 2：按依赖顺序执行 exchange ──


                // 关键排序规则：internal=true（current ∈ saved 阵容）的优先执行


                // 这能避免「先把共同英雄装备换走 → 后续 saved 反查到共同英雄时拿到错误装备」的链路断裂


                exchangeTasks.sort((a, b) => {


                    // internal 优先（true=0, false=1）


                    if (a.internal !== b.internal) return a.internal ? -1 : 1;


                    return 0;


                });





                console.log(`[英雄队伍增强][exchange-diag] 任务执行顺序（internal 优先）:`,


                    exchangeTasks.map(t => `${t.saved}<-${t.current}(${t.internal?'内':'外'},${t.viaTag})`).join(' | '));





                // ── 阶段 2：执行 exchange（动态校验 + 实时重新反查） ──


                // 关键：阶段 1 的反查是基于初始 ROLE.heroes 快照的，阶段 2 执行过程中每个 exchange 都会


                // 改变 ROLE.heroes 状态。如果存在链/环（如 A→B, B→C），按计划先执行 A↔B 后，B 身上


                // 就不再是阶段 1 预期的数据，此时再 B↔C 会把错误的数据转给 C，导致 saved=B 最终拿到


                // 错乱状态 → 甚至和白板互换 → 升级强行拉高等级但装备空（用户痛点 1+2 的根因）。


                // 解决：每个 task 执行前检验 current 身上是否还戴着 saved 期望的装备；若不是，基于


                // 最新 ROLE.heroes 重新反查该 saved 的新载体。


                const executedCurrentIds = new Set();  // 已执行 exchange 的 current（避免重复使用）


                for (const task of exchangeTasks) {


                    const savedHeroId = task.saved;


                    const heroConfig = formation.heroes[savedHeroId] || formation.heroes[String(savedHeroId)];


                    let currentHeroId = task.current;


                    let reresolved = false;





                    // 校验 task.current 当前是否仍匹配 saved 的期望装备


                    // 关键：按 viaTag 使用对应模式的 fp 校验，不能混用：


                    //   - equipFp(self)/equipFp: 完全 fp 严格比对（保留洗炼等所有细节）


                    //   - equipFpStable(self)/equipFpStable: stable fp 宽松比对（忽略洗炼字段）


                    //   - battleSlot/pool/attachmentUid: 不校验 fp（语义不是装备匹配），仅检查未被占用


                    const isFullFpTask = task.viaTag === 'equipFp' || task.viaTag === 'equipFp(self)';


                    const isStableFpTask = task.viaTag === 'equipFpStable' || task.viaTag === 'equipFpStable(self)';


                    const isFpBasedTask = isFullFpTask || isStableFpTask;





                    if (isFpBasedTask && heroConfig) {


                        const curHero = this.getHeroFromMap(ROLE.heroes, currentHeroId);


                        const mode = isStableFpTask ? 'stable' : undefined;


                        const expectedFp = isStableFpTask


                            ? (heroConfig.equipmentFpStable || (heroConfig.equipment ? this.getEquipmentFingerprint(heroConfig.equipment, 'stable') : null))


                            : heroConfig.equipmentFp;


                        let curFp = null;


                        try { curFp = this.getEquipmentFingerprint(curHero && curHero.equipment, mode); } catch (e) {}


                        if (expectedFp && expectedFp !== '__none__' && curFp !== expectedFp) {


                            // 原定 current 身上的装备已变（被前面 exchange 污染）→ 重新反查


                            console.warn(`[英雄队伍增强][exchange-diag] ⚠️ task ${savedHeroId}↔${currentHeroId}(${task.viaTag}) 执行前校验失败，重新反查…`);


                            // 按原 viaTag 的模式优先重新反查；再尝试对方模式


                            let newTarget = this.findHeroByEquipmentFingerprint(expectedFp, ROLE.heroes, mode);


                            if ((!newTarget || executedCurrentIds.has(parseInt(newTarget))) && isFullFpTask) {


                                // 完全 fp 失败 → 退回 stable fp


                                let stableFp = heroConfig.equipmentFpStable;


                                if (!stableFp && heroConfig.equipment) {


                                    try { stableFp = this.getEquipmentFingerprint(heroConfig.equipment, 'stable'); } catch (e) {}


                                }


                                if (stableFp && stableFp !== '__none__') {


                                    newTarget = this.findHeroByEquipmentFingerprint(stableFp, ROLE.heroes, 'stable');


                                }


                            }


                            // 过滤已占用


                            while (newTarget && executedCurrentIds.has(parseInt(newTarget))) {


                                newTarget = null;  // 占用了就放弃，进入失败分支


                            }


                            if (newTarget) {


                                console.log(`[英雄队伍增强][exchange-diag] 重新反查成功：saved=${savedHeroId} 新载体=${newTarget}（原=${currentHeroId}）`);


                                currentHeroId = parseInt(newTarget);


                                reresolved = true;


                            } else {


                                // 找不到新载体 → 跳过此 task，加入失败集合，避免等级升级把白板升高


                                console.warn(`[英雄队伍增强][exchange-diag] ❌ saved=${savedHeroId} 重新反查失败，跳过 exchange 并加入失败集合`);


                                this._exchangeFailedSaved.add(parseInt(savedHeroId));


                                continue;


                            }


                        }


                    } else if (task.viaTag === 'battleSlot' || (task.viaTag && task.viaTag.startsWith('pool'))) {


                        // 池/槽位兜底路径：只检查 current 未被前面 exchange 占用（语义不是 fp 匹配）


                        if (executedCurrentIds.has(parseInt(currentHeroId))) {


                            console.warn(`[英雄队伍增强][exchange-diag] ⚠️ saved=${savedHeroId}(${task.viaTag}) current=${currentHeroId} 已被占用，跳过`);


                            this._exchangeFailedSaved.add(parseInt(savedHeroId));


                            continue;


                        }


                    }





                    // self-loop（saved=current）跳过


                    if (parseInt(savedHeroId) === parseInt(currentHeroId)) {


                        continue;


                    }





                    exchangeCount++;


                    const savedHeroName = this.getHeroName(savedHeroId);


                    const currentHeroName = this.getHeroName(currentHeroId);


                    this.showTip(`正在交换英雄 ${savedHeroName} ↔ ${currentHeroName} (${exchangeCount}/${totalHeroes})${reresolved ? ' [实时重定向]' : ''}`, 'info');


                    await this.exchangeHeroes(HeroService, savedHeroId, currentHeroId);


                    executedCurrentIds.add(parseInt(currentHeroId));


                    executedCurrentIds.add(parseInt(savedHeroId));  // saved 位置的数据也被改变了


                }





                if (exchangeCount > 0) {


                    console.log(`[英雄队伍增强] 英雄交换完成，共交换了${exchangeCount}个英雄`);


                } else {


                    console.log('[英雄队伍增强] 无需进行英雄交换');


                }





                // ── 阶段 2.5：失败 saved 的手动映射（指纹反查彻底失败时） ──


                // 场景：装备洗炼多次导致 fp 全漂移；用户一次点击即可修正所有歧义


                if (this._exchangeFailedSaved && this._exchangeFailedSaved.size > 0) {


                    const failedCopy = new Set(this._exchangeFailedSaved);


                    // 只弹出"当前未被占用"的失败 saved（被占用的说明指纹虽失败但 pool 兜底成功）


                    for (const sid of failedCopy) {


                        if (executedCurrentIds.has(parseInt(sid))) failedCopy.delete(sid);


                    }


                    if (failedCopy.size > 0) {


                        console.warn(`[英雄队伍增强] ${failedCopy.size} 个 saved 反查失败，弹出手动映射对话框`);


                        try {


                            const manualMap = await this.showManualExchangeDialog(failedCopy, ROLE);


                            for (const [sid, cid] of manualMap) {


                                if (parseInt(sid) === parseInt(cid)) continue;


                                if (executedCurrentIds.has(parseInt(cid))) {


                                    console.warn(`[英雄队伍增强] 手动映射目标 ${cid} 已被占用，跳过 saved=${sid}`);


                                    continue;


                                }


                                try {


                                    const sName = this.getHeroName(sid);


                                    const cName = this.getHeroName(cid);


                                    this.showTip(`手动映射 exchange: ${sName} ↔ ${cName}`, 'info');


                                    await this.exchangeHeroes(HeroService, sid, cid);


                                    executedCurrentIds.add(parseInt(cid));


                                    executedCurrentIds.add(parseInt(sid));


                                    this._exchangeFailedSaved.delete(parseInt(sid));


                                    exchangeCount++;


                                } catch (e) {


                                    console.error(`[英雄队伍增强] 手动 exchange(${sid},${cid}) 失败:`, e);


                                }


                            }


                        } catch (e) {


                            console.error('[英雄队伍增强] 手动映射对话框异常:', e);


                        }


                    }


                }





                // ── 阶段 3：执行后校验（告诉用户最终 saved 是否与预期一致） ──


                // 扫描所有 saved：检查当前英雄的完全 fp / stable fp 是否还与 saved 一致


                try {


                    const mismatch = [];


                    for (const [savedHeroId, heroConfig] of Object.entries(formation.heroes)) {


                        const hid = parseInt(savedHeroId);


                        if (this._exchangeFailedSaved.has(hid)) continue; // 已知失败的跳过


                        if (!heroConfig.equipmentFp || heroConfig.equipmentFp === '__none__') continue;


                        const h = this.getHeroFromMap(ROLE.heroes, hid);


                        if (!h) continue;


                        let curFullFp = null, curStableFp = null;


                        try { curFullFp = this.getEquipmentFingerprint(h.equipment); } catch (e) {}


                        try { curStableFp = this.getEquipmentFingerprint(h.equipment, 'stable'); } catch (e) {}


                        const savedStable = heroConfig.equipmentFpStable


                            || (heroConfig.equipment ? this.getEquipmentFingerprint(heroConfig.equipment, 'stable') : null);


                        const fullOk = curFullFp === heroConfig.equipmentFp;


                        const stableOk = savedStable && curStableFp === savedStable;


                        // 容差匹配（方案B）：吸收 exchange 过程中的洗炼微漂移。


                        // 规则：同段同字段 — 非数字字段必须全等；数字字段允许相对差 ≤5%（或绝对差 ≤50）。


                        const fuzzyOk = !fullOk && !stableOk && this._fuzzyFpMatch(curFullFp, heroConfig.equipmentFp, 0.05, 50);


                        if (!fullOk && !stableOk && !fuzzyOk) {


                            mismatch.push({ hid, name: this.getHeroName(savedHeroId), curFullFp, savedFullFp: heroConfig.equipmentFp });


                        }


                    }


                    if (mismatch.length > 0) {


                        console.warn(`[英雄队伍增强][post-verify] ⚠️ 交换后 ${mismatch.length} 个英雄装备与 saved 不一致：`);


                        for (const m of mismatch) {


                            console.warn(`  - ${m.name}(${m.hid}):\n      saved.fp = ${m.savedFullFp}\n      curFullFp = ${m.curFullFp}`);


                        }


                        // ── 二次救援：把 post-verify 不一致的 saved 加入失败集合 + 弹手动映射对话框 ──


                        // 原因：exchange 阶段虽执行成功，但实际转移目标错配（指纹漂移/swap 链冲突）


                        //      saved 期望的洗炼装备未真正转到当前位置 → 后续若不修，等级升级/鱼灵处理会污染


                        //      统一处理：标记失败 → 升级/鱼灵跳过（白板闸门兜底） → 弹对话框给用户最后一次手动救援机会


                        const rescueSet = new Set();


                        for (const m of mismatch) {


                            this._exchangeFailedSaved.add(m.hid);


                            // 仅对当前未被占用 / 占用非 saved 自身的弹救援（避免重复操作已成功路径）


                            rescueSet.add(m.hid);


                        }


                        this.showTip(`⚠️ ${mismatch.length} 个英雄装备未对齐 saved，弹出二次救援对话框…`, 'warning');


                        if (rescueSet.size > 0) {


                            try {


                                const manualMap = await this.showManualExchangeDialog(rescueSet, ROLE);


                                for (const [sid, cid] of manualMap) {


                                    if (parseInt(sid) === parseInt(cid)) continue;


                                    if (executedCurrentIds.has(parseInt(cid))) {


                                        console.warn(`[英雄队伍增强][post-verify-rescue] ⚠️ ${sid}↔${cid} cid 已被占用，跳过`);


                                        continue;


                                    }


                                    try {


                                        const sName = this.getHeroName(sid);


                                        const cName = this.getHeroName(cid);


                                        this.showTip(`二次救援 exchange: ${sName} ↔ ${cName}`, 'info');


                                        await this.exchangeHeroes(HeroService, sid, cid);


                                        executedCurrentIds.add(parseInt(cid));


                                        executedCurrentIds.add(parseInt(sid));


                                        this._exchangeFailedSaved.delete(parseInt(sid));


                                        exchangeCount++;


                                    } catch (e) {


                                        console.error(`[英雄队伍增强][post-verify-rescue] exchange(${sid},${cid}) 失败:`, e);


                                    }


                                }


                            } catch (e) {


                                console.error('[英雄队伍增强][post-verify-rescue] 救援对话框异常:', e);


                            }


                        }


                    } else {


                        console.log(`[英雄队伍增强][post-verify] ✅ 所有 saved 英雄装备与阵容一致`);


                    }


                } catch (e) {


                    console.warn('[英雄队伍增强][post-verify] 校验异常:', e);


                }


                


            } catch (error) {


                console.error('[英雄队伍增强] 处理英雄交换失败:', error);


                this.showTip(`英雄交换失败: ${error.message}`, 'error');


                throw error;


            }


        }





        // 英雄等级检查和升级处理


        async processHeroLevelUpgrade(formation, ROLE, HeroService) {


            try {


                if (!formation.heroes || !ROLE.heroes) {


                    console.log('[英雄队伍增强] 跳过英雄等级检查：无英雄数据');


                    return;


                }





                console.log('[英雄队伍增强] 开始检查英雄等级...');


                let upgradeCount = 0;


                let rebirthCount = 0;


                const totalHeroes = Object.keys(formation.heroes).length;





                // 遍历保存阵容中的每个英雄


                for (const [savedHeroId, heroConfig] of Object.entries(formation.heroes)) {


                    if (!heroConfig.level) {


                        continue; // 没有保存等级信息，跳过


                    }





                    // 跳过 exchange 反查全失败的 saved：装备无法恢复，升级只会让白板永久高级化


                    if (this._exchangeFailedSaved && this._exchangeFailedSaved.has(parseInt(savedHeroId))) {


                        const heroName = this.getHeroName(savedHeroId);


                        console.warn(`[英雄队伍增强] 英雄 ${heroName}(${savedHeroId}) 无损换将失败，跳过等级升级以免白板英雄被强行升级至 ${heroConfig.level}级`);


                        continue;


                    }





                    // 获取当前英雄数据


                    const currentHero = this.getHeroFromMap(ROLE.heroes, parseInt(savedHeroId));


                    if (!currentHero) {


                        const heroName = this.getHeroName(savedHeroId);                        continue;


                    }





                    // ── 白板最终闸门：即使 exchange 任务被执行（内部 swap 链冲突/post-verify 告警），


                    //    当前英雄实际仍可能是白板（等级1/无装备）。强行升级到 saved.level(60+) 会永久毁号。


                    //    判定：level<=1 且 order==0 且 四格装备 level/forge/star 全为 0（游戏版本 equipId=0 不可用）


                    const isBlankBoard = (() => {


                        try {


                            if ((currentHero.level || 1) > 1) return false;


                            if ((currentHero.order || 0) > 0) return false;


                            const eq = currentHero.equipment;


                            if (eq) {


                                for (const slot of [1, 2, 3, 4]) {


                                    let piece = null;


                                    if (typeof eq.get === 'function') piece = eq.get(slot) || eq.get(String(slot));


                                    else piece = eq[slot] || eq[String(slot)];


                                    if (piece && typeof piece === 'object') {


                                        const eid = Number(piece.equipId) || 0;


                                        const lv = Number(piece.level) || 0;


                                        const fg = Number(piece.forge) || 0;


                                        const st = Number(piece.star) || 0;


                                        if (eid > 0 || lv > 1 || fg > 0 || st > 0) return false;


                                    }


                                }


                            }


                            return true;


                        } catch (e) { return false; }


                    })();


                    // 仅当 saved 目标等级远高于 1 时才阻止（避免误伤刚好保存为 1 级的场景）


                    if (isBlankBoard && (heroConfig.level || 1) > 1) {


                        const heroName = this.getHeroName(savedHeroId);


                        console.warn(`[英雄队伍增强][白板闸门] 英雄 ${heroName}(${savedHeroId}) 当前实际为白板（level=${currentHero.level}/order=${currentHero.order}/装备全空），但 saved.level=${heroConfig.level} → 已阻止升级（exchange 可能未真正转移培养数据）`);


                        this.showTip(`⚠️ ${heroName} 当前为白板，已阻止升级`, 'warning');


                        continue;


                    }





                    const currentLevel = currentHero.level || 0;


                    const targetLevel = heroConfig.level;


                    const currentOrder = currentHero.order || 0;





                    // 自动计算正确的目标阶数


                    const targetOrder = this.calculateRequiredOrder(targetLevel);





                    const heroName = this.getHeroName(savedHeroId);


                    // 检查是否需要重生：当前等级大于目标等级，或者等级相同但阶数大于目标阶数


                    const needRebirth = currentLevel > targetLevel || 


                                      (currentLevel === targetLevel && currentOrder > targetOrder) ||


                                      (currentLevel > targetLevel && currentOrder >= targetOrder);





                    if (needRebirth) {


                        rebirthCount++;


                        const name = this.getHeroName(savedHeroId);


                        this.showTip(`正在下阵并重生英雄 ${name} (${rebirthCount}/${totalHeroes})`, 'info');


                        


                        // 在重生前先下阵，防止后续升级报错


                        try {


                            if (typeof HeroService.sendGoBackBattle === 'function') {


                                // 获取当前英雄在队伍中的位置


                                const currentSlot = currentHero.battleTeamSlot;


                                if (currentSlot !== undefined && currentSlot !== null && currentSlot !== -1) {


                                    await HeroService.sendGoBackBattle(currentSlot);


                                }


                            } else if (typeof HeroService.goBackBattle === 'function') {


                                const currentSlot = currentHero.slot || currentHero.battleTeamSlot;


                                if (currentSlot !== undefined && currentSlot !== null && currentSlot !== -1) {


                                    await HeroService.goBackBattle({ slot: currentSlot });


                                }


                            }


                        } catch (e) {


                            console.warn(`[英雄队伍增强] 下阵英雄 ${heroName} 失败或已在阵下:`, e);


                        }





                        await this.rebirthHero(HeroService, parseInt(savedHeroId));


                        // 重生后重新获取英雄数据并升级


                        const rebirthHero = this.getHeroFromMap(ROLE.heroes, parseInt(savedHeroId));


                        if (rebirthHero) {


                            upgradeCount++;


                            this.showTip(`正在升级英雄 ${heroName} 至 ${targetLevel}级/${targetOrder}阶`, 'info');


                            await this.upgradeHeroToTarget(HeroService, parseInt(savedHeroId), targetLevel, targetOrder);


                        }


                    } else if (currentLevel < targetLevel || currentOrder < targetOrder) {


                        // 需要升级但不需要重生


                        upgradeCount++;


                        this.showTip(`正在升级英雄 ${heroName} 至 ${targetLevel}级/${targetOrder}阶`, 'info');                        await this.upgradeHeroToTarget(HeroService, parseInt(savedHeroId), targetLevel, targetOrder);


                    } else {                    }


                }





                if (rebirthCount > 0 || upgradeCount > 0) {


                    console.log(`[英雄队伍增强] 英雄等级处理完成，重生${rebirthCount}个，升级${upgradeCount}个英雄`);


                } else {


                    console.log('[英雄队伍增强] 所有英雄等级已达标，无需处理');


                }


            } catch (error) {


                console.error('[英雄队伍增强] 处理英雄等级升级失败:', error);


                this.showTip(`英雄等级升级失败: ${error.message}`, 'error');


                throw error;


            }


        }








        // 获取英雄数据的辅助函数


        getHeroFromMap(heroes, heroId) {


            try {


                if (typeof heroes.get === 'function') {


                    // MobX Map方式


                    return heroes.get(heroId);


                } else if (typeof heroes === 'object') {


                    // 普通对象方式


                    return heroes[heroId];


                }


                return null;


            } catch (error) {


                console.error('[英雄队伍增强] 获取英雄数据失败:', error);


                return null;


            }


        }





        // 英雄重生


        async rebirthHero(HeroService, heroId) {


            try {


                const heroName = this.getHeroName(heroId);                


                if (typeof HeroService.rebirth === 'function') {


                    const result = await HeroService.rebirth({ heroId: heroId });


                    


                    if (result.code !== 0) {


                        const errorMsg = result.error || `重生失败，错误代码: ${result.code}`;


                        console.error(`[英雄队伍增强] 英雄 ${heroName}(${heroId}) 重生失败: ${errorMsg}`);


                        this.showTip(`英雄重生失败: ${errorMsg}`, 'error');


                        throw new Error(errorMsg);


                    }


                } else {


                    const errorMsg = 'HeroService.rebirth 方法不可用';


                    console.error(`[英雄队伍增强] ${errorMsg}`);


                    this.showTip(errorMsg, 'error');


                    throw new Error(errorMsg);


                }


            } catch (error) {


                const _hn = this.getHeroName(heroId);


                console.error(`[英雄队伍增强] 重生英雄 ${_hn}(${heroId}) 异常:`, error);


                this.showTip(`重生英雄异常: ${error.message}`, 'error');


                throw error;


            }


        }





        // 升级英雄到目标等级


        async upgradeHeroToTarget(HeroService, heroId, targetLevel, targetOrder) {


            try {


                const heroName = this.getHeroName(heroId);                


                const ServerData = unsafeWindow.__require('ServerData');


                const ROLE = ServerData.ROLE;


                


                let currentHero = this.getHeroFromMap(ROLE.heroes, heroId);


                if (!currentHero) {


                    throw new Error(`未找到英雄 ${heroName}(${heroId}) 的数据`);


                }





                let currentLevel = currentHero.level || 0;


                let currentOrder = currentHero.order || 0;


                const standardLevels = [1, 5, 10, 50];





                while ((currentLevel < targetLevel || currentOrder < targetOrder)) {


                    // 每次循环都重新获取最新的ROLE数据，确保数据同步


                    const ServerData = unsafeWindow.__require('ServerData');


                    const freshROLE = ServerData.ROLE;


                    const freshHero = this.getHeroFromMap(freshROLE.heroes, heroId);


                    if (freshHero) {


                        currentLevel = freshHero.level || 0;


                        currentOrder = freshHero.order || 0;


                    }


                    


                    // 检查是否需要进阶 - 如果当前等级达到了进阶要求就进阶


                    if (this.canOrderUpgrade(currentLevel, currentOrder) && currentOrder < targetOrder) {                        


                        const orderResult = await HeroService.heroUpgradeOrder({ heroId });


                        


                        // 检查进阶是否失败


                        if (orderResult && orderResult.errCode || orderResult && orderResult.code !== 0 || orderResult && orderResult.error) {


                            const errorMsg = orderResult.msg || orderResult.errMsg || orderResult.error || `进阶失败，错误代码: ${orderResult.code}`;


                            console.error(`[英雄队伍增强] 英雄 ${heroName}(${heroId}) 进阶失败: ${errorMsg}`);


                            this.showTip(`英雄进阶失败: ${errorMsg}`, 'error');


                            throw new Error(errorMsg);


                        }


                        


                        if (orderResult && orderResult.code === 0) {


                            // 更新英雄数据 - 使用正确的API响应结构


                            let updatedHero = null;


                            


                            if (orderResult.role && orderResult.role.heroes) {


                                updatedHero = orderResult.role.heroes[String(heroId)];


                            } else if (orderResult._rawData && orderResult._rawData.role && orderResult._rawData.role.heroes) {


                                updatedHero = orderResult._rawData.role.heroes[String(heroId)];


                            }


                            


                            if (updatedHero) {


                                const prevLevel = currentLevel;


                                const prevOrder = currentOrder;


                                currentLevel = updatedHero.level || 0;


                                currentOrder = updatedHero.order || 0;


                                


                                // 验证进阶是否真的生效了


                                if (currentOrder === prevOrder) {


                                    this.showTip('进阶未生效，可能进阶石不足', 'warning');


                                    throw new Error('进阶未生效');


                                }


                            } else {


                                // 如果没有返回英雄数据，等待数据同步后重新获取


                                // await new Promise(resolve => setTimeout(resolve, 1000)); // 等待数据同步


                                


                                // 重新从ROLE获取最新数据


                                const ServerData = unsafeWindow.__require('ServerData');


                                const freshROLE = ServerData.ROLE;


                                updatedHero = this.getHeroFromMap(freshROLE.heroes, heroId);


                                


                                if (updatedHero) {


                                    const prevOrder = currentOrder;


                                    currentLevel = updatedHero.level || 0;


                                    currentOrder = updatedHero.order || 0;


                                    


                                    // 验证进阶是否真的生效了


                                    if (currentOrder === prevOrder) {


                                        this.showTip('进阶未生效，可能进阶石不足', 'warning');


                                        throw new Error('进阶未生效');


                                    }


                                } else {


                                    throw new Error('进阶请求异常，无法获取更新数据');


                                }


                            }


                        } else {


                            const errorMsg = (orderResult && orderResult.error) || `进阶失败，错误代码: ${orderResult ? orderResult.code : 'unknown'}`;


                            console.error(`[英雄队伍增强] 英雄 ${heroName}(${heroId}) 进阶失败: ${errorMsg}`);


                            this.showTip(`英雄进阶失败: ${errorMsg}`, 'error');


                            throw new Error(errorMsg);


                        }


                        


                        // await new Promise(resolve => setTimeout(resolve, 500));


                        continue;


                    }





                    // 如果已达到目标阶数但等级不够，继续升级


                    if (currentLevel < targetLevel) {


                        // 计算可升级数


                        const remaining = targetLevel - currentLevel;


                        let useLevel = 1;


                        


                        for (const stdLevel of standardLevels.reverse()) {


                            if (stdLevel <= remaining) {


                                const judgement = this.judgeLevelUpgrade(currentLevel, stdLevel, currentOrder);


                                if (judgement === false) {


                                    useLevel = stdLevel;


                                    break;


                                }


                            }


                        }


                        standardLevels.reverse();                        


                        const result = await HeroService.heroUpgradeLevel({ heroId, upgradeNum: useLevel });


                        


                        // 检查升级是否失败


                        if (result && result.errCode || result && result.code !== 0 || result && result.error) {


                            const errorMsg = result.msg || result.errMsg || result.error || `升级失败，错误代码: ${result.code}`;


                            console.error(`[英雄队伍增强] 英雄 ${heroName}(${heroId}) 升级失败: ${errorMsg}`);


                            this.showTip(`英雄升级失败: ${errorMsg}`, 'error');


                            throw new Error(errorMsg);


                        }


                        


                        if (result && result.code === 0) {


                            // 更新英雄数据 - 使用正确的API响应结构


                            let updatedHero = null;


                            


                            if (result.role && result.role.heroes) {


                                updatedHero = result.role.heroes[String(heroId)];


                            } else if (result._rawData && result._rawData.role && result._rawData.role.heroes) {


                                updatedHero = result._rawData.role.heroes[String(heroId)];


                            }


                            


                            if (updatedHero) {


                                const prevLevel = currentLevel;


                                currentLevel = updatedHero.level || 0;


                                currentOrder = updatedHero.order || 0;


                                


                                // 验证升级是否真的生效了


                                if (currentLevel === prevLevel) {


                                    this.showTip('升级未生效，可能金币不足', 'warning');


                                    throw new Error('升级未生效');


                                }


                            } else {


                                // 如果没有返回英雄数据，等待数据同步后重新获取


                                // await new Promise(resolve => setTimeout(resolve, 1000)); // 等待数据同步


                                


                                // 重新从ROLE获取最新数据


                                const ServerData = unsafeWindow.__require('ServerData');


                                const freshROLE = ServerData.ROLE;


                                updatedHero = this.getHeroFromMap(freshROLE.heroes, heroId);


                                


                                if (updatedHero) {


                                    const prevLevel = currentLevel;


                                    currentLevel = updatedHero.level || 0;


                                    currentOrder = updatedHero.order || 0;


                                    


                                    // 验证升级是否真的生效了


                                    if (currentLevel === prevLevel) {


                                        this.showTip('升级未生效，可能金币不足', 'warning');


                                        throw new Error('升级未生效');


                                    }


                                } else {


                                    throw new Error('升级请求异常，无法获取更新数据');


                                }


                            }


                        } else {


                            const errorMsg = (result && result.error) || `升级失败，错误代码: ${result ? result.code : 'unknown'}`;


                            console.error(`[英雄队伍增强] 英雄 ${heroName}(${heroId}) 升级失败: ${errorMsg}`);


                            this.showTip(`英雄升级失败: ${errorMsg}`, 'error');


                            throw new Error(errorMsg);


                        }


                        


                        // await new Promise(resolve => setTimeout(resolve, 500));


                    } else {


                        // 等级和阶数都已达标


                        break;


                    }


                }                this.showTip(`英雄 ${heroName} 升级完成`, 'success');


                


            } catch (error) {


                const _hn = this.getHeroName(heroId);


                console.error(`[英雄队伍增强] 升级英雄 ${_hn}(${heroId}) 异常:`, error);


                this.showTip(`升级英雄异常: ${error.message}`, 'error');


                throw error;


            }


        }





        // 判断升级是否会跨越进阶门槛（从heroUpgrade.js复制）


        judgeLevelUpgrade(level, upgradeNum, order) {


            for (const item of this.LEVEL_ORDER_MAP) {


                if (order !== item.order && level <= item.level && item.level < (level + upgradeNum)) {


                    return item.level;


                }


            }


            return false;


        }





        // 判断是否可以进阶（修复版本）


        canOrderUpgrade(level, order) {


            // 查找当前阶数对应的进阶等级要求


            for (const item of this.LEVEL_ORDER_MAP) {


                if (item.order === order + 1) {


                    // 如果当前等级达到了下一阶的要求等级，就可以进阶


                    return level >= item.level;


                }


            }


            return false; // 已经是最高阶或没有找到对应配置


        }





        // 根据目标等级计算所需的阶数


        calculateRequiredOrder(targetLevel) {


            let requiredOrder = 0;


            for (const item of this.LEVEL_ORDER_MAP) {


                if (targetLevel >= item.level) {


                    requiredOrder = item.order;


                } else {


                    break;


                }


            }


            return requiredOrder;


        }





        // 英雄鱼灵配置处理


        async processHeroArtifacts(formation, ROLE, ArtifactService) {


            try {


                if (!formation.heroes || !ROLE.heroes) {


                    console.log('[英雄队伍增强] 跳过鱼灵配置：无英雄数据');


                    return;


                }





                console.log('[英雄队伍增强] 开始检查英雄鱼灵配置...');


                


                // 第一步：分析当前鱼灵分布和目标需求


                const currentArtifactMap = new Map(); // artifactId_pearlId -> heroId


                const targetArtifactMap = new Map();  // artifactId_pearlId -> heroId


                const heroArtifactChanges = [];       // 需要处理的变更列表


                


                // 构建当前鱼灵分布图


                if (typeof ROLE.heroes.forEach === 'function') {


                    ROLE.heroes.forEach((hero, heroId) => {


                        if (hero && hero.artifactId > 0 && hero.pearlId > 0) {


                            const key = `${hero.artifactId}_${hero.pearlId}`;


                            currentArtifactMap.set(key, heroId);


                        }


                    });


                } else if (typeof ROLE.heroes.entries === 'function') {


                    for (const [heroId, hero] of ROLE.heroes.entries()) {


                        if (hero && hero.artifactId > 0 && hero.pearlId > 0) {


                            const key = `${hero.artifactId}_${hero.pearlId}`;


                            currentArtifactMap.set(key, heroId);


                        }


                    }


                } else {


                    for (const [heroId, hero] of Object.entries(ROLE.heroes)) {


                        if (hero && hero.artifactId > 0 && hero.pearlId > 0) {


                            const key = `${hero.artifactId}_${hero.pearlId}`;


                            currentArtifactMap.set(key, parseInt(heroId));


                        }


                    }


                }


                


                // 构建目标鱼灵需求图和变更列表


                for (const [savedHeroId, heroConfig] of Object.entries(formation.heroes)) {


                    const heroId = parseInt(savedHeroId);





                    // 跳过 exchange 失败的 saved：该英雄当前是白板/非目标英雄，处理鱼灵只会卸掉别人的鱼灵


                    if (this._exchangeFailedSaved && this._exchangeFailedSaved.has(heroId)) {


                        console.warn(`[英雄队伍增强] 英雄 ${this.getHeroName(savedHeroId)}(${heroId}) 无损换将失败，跳过鱼灵处理`);


                        continue;


                    }





                    const currentHero = this.getHeroFromMap(ROLE.heroes, heroId);





                    if (!currentHero) {


                        const heroName = this.getHeroName(savedHeroId);                        continue;


                    }


                    


                    const currentArtifactId = currentHero.artifactId || 0;


                    const currentPearlId = currentHero.pearlId || 0;


                    const targetArtifactId = heroConfig.artifactId || 0;


                    const targetPearlId = heroConfig.pearlId || 0;


                    


                    // 记录目标需求（允许 pearlId=0/null：某些英雄只装鱼灵不装鱼珠）


                    if (targetArtifactId > 0) {


                        const key = `${targetArtifactId}_${targetPearlId}`;


                        targetArtifactMap.set(key, heroId);


                    }


                    


                    // 检查是否需要变更


                    if (currentArtifactId !== targetArtifactId || currentPearlId !== targetPearlId) {


                        heroArtifactChanges.push({


                            heroId,


                            currentArtifactId,


                            currentPearlId,


                            targetArtifactId,


                            targetPearlId


                        });


                    }


                }                


                if (heroArtifactChanges.length === 0) {


                    console.log('[英雄队伍增强] 所有英雄鱼灵配置已正确，无需处理');


                    return;


                }


                


                // 第二步：智能处理鱼灵分配


                let processedCount = 0;


                


                for (const change of heroArtifactChanges) {


                    processedCount++;


                    const heroName = this.getHeroName(change.heroId);


                    this.showTip(`正在配置英雄 ${heroName} 的鱼灵 (${processedCount}/${heroArtifactChanges.length})`, 'info');


                    


                    const { heroId, currentArtifactId, currentPearlId, targetArtifactId, targetPearlId } = change;                    


                    // 先卸下当前鱼灵（如果有的话）


                    if (currentArtifactId > 0) {                        await this.unloadArtifact(ArtifactService, heroId);


                        


                        // 更新当前分布图


                        const currentKey = `${currentArtifactId}_${currentPearlId}`;


                        currentArtifactMap.delete(currentKey);


                    }


                    


                    // 装上目标鱼灵（允许 pearlId=0/null：某些英雄只装鱼灵不带鱼珠，例如张角）


                    if (targetArtifactId > 0) {


                        const pearlForLoad = targetPearlId || 0;


                        const targetKey = `${targetArtifactId}_${pearlForLoad}`;


                        const occupiedHeroId = currentArtifactMap.get(targetKey);





                        // 如果目标鱼灵被其他英雄佩戴，需要先卸下


                        if (occupiedHeroId && occupiedHeroId !== heroId) {


                            const occupiedHeroName = this.getHeroName(occupiedHeroId);                            await this.unloadArtifact(ArtifactService, occupiedHeroId);


                            currentArtifactMap.delete(targetKey);


                        }


                        await this.loadArtifact(ArtifactService, heroId, targetArtifactId, pearlForLoad);





                        // 更新当前分布图


                        currentArtifactMap.set(targetKey, heroId);


                    }


                }                


            } catch (error) {


                console.error('[英雄队伍增强] 处理英雄鱼灵配置失败:', error);


                this.showTip(`鱼灵配置失败: ${error.message}`, 'error');


                throw error;


            }


        }





        // 查找佩戴指定鱼灵的英雄


        findHeroWithArtifact(heroes, artifactId, pearlId) {


            try {


                if (typeof heroes.forEach === 'function') {


                    // MobX Map方式遍历


                    let foundHeroId = null;


                    heroes.forEach((hero, heroId) => {


                        if (hero && hero.artifactId === artifactId && hero.pearlId === pearlId) {


                            foundHeroId = heroId;


                        }


                    });


                    return foundHeroId;


                } else if (typeof heroes.entries === 'function') {


                    // 使用entries方式遍历


                    for (const [heroId, hero] of heroes.entries()) {


                        if (hero && hero.artifactId === artifactId && hero.pearlId === pearlId) {


                            return heroId;


                        }


                    }


                } else {


                    // 普通对象方式遍历


                    for (const [heroId, hero] of Object.entries(heroes)) {


                        if (hero && hero.artifactId === artifactId && hero.pearlId === pearlId) {


                            return parseInt(heroId);


                        }


                    }


                }


            } catch (error) {


                console.error('[英雄队伍增强] 查找佩戴鱼灵的英雄失败:', error);


            }


            return null;


        }





        // 卸下英雄鱼灵


        async unloadArtifact(ArtifactService, heroId) {


            const heroName = this.getHeroName(heroId);


            try {


                // 先检查英雄是否装备了鱼灵


                const ServerData = unsafeWindow.__require('ServerData');


                const ROLE = ServerData.ROLE;


                const hero = this.getHeroFromMap(ROLE.heroes, heroId);


                


                if (!hero || !hero.artifactId || hero.artifactId <= 0) {


                    return;


                }


                


                await ArtifactService.unload({ heroId });


            } catch (error) {


                console.error(`[英雄队伍增强] 卸载英雄 ${heroName}(${heroId}) 鱼灵异常:`, error);


                throw error;


            }


        }





        // 为英雄装上鱼灵


        async loadArtifact(ArtifactService, heroId, itemId, pearlId) {


            const heroName = this.getHeroName(heroId);


            try {


                const result = await ArtifactService.load({


                    heroId: heroId,


                    itemId: itemId,


                    targetHeroId: -1, // 固定值


                    pearlId: pearlId


                });


                


            } catch (error) {


                console.error(`[英雄队伍增强] 装载英雄 ${heroName}(${heroId}) 鱼灵异常:`, error);


                throw error;


            }


        }





        // 英雄鱼珠技能配置处理


        /**


         * 处理英雄鱼珠技能配置


         * 优化逻辑：优先使用未使用的技能，避免循环拆装


         */


        async processHeroPearlSkills(formation, ROLE, PearlService) {


            try {


                if (!formation.heroes || !ROLE.heroes || !ROLE.pearlMap || !ROLE.pearlSkillStorage) {


                    return;


                }





                console.log('[英雄队伍增强] 开始检查英雄鱼珠技能配置...');





                // 收集当前阵容中所有需要的技能


                const requiredSkills = new Map(); // skillId -> [heroId1, heroId2, ...]


                const currentFormationHeroes = new Set(); // 当前阵容中的英雄ID





                // 第一步：分析需求


                for (const [savedHeroId, heroConfig] of Object.entries(formation.heroes)) {


                    if (!heroConfig.appendSkill || !Array.isArray(heroConfig.appendSkill)) {


                        continue;


                    }





                    currentFormationHeroes.add(parseInt(savedHeroId));





                    const currentHero = this.getHeroFromMap(ROLE.heroes, parseInt(savedHeroId));


                    if (!currentHero || !currentHero.appendSkill) {


                        continue;


                    }





                    // 检查1033开头的技能


                    for (const savedSkillId of heroConfig.appendSkill) {


                        // appendSkill现在是简单的skillId数组


                        if (!savedSkillId || !String(savedSkillId).startsWith('1033')) {


                            continue;


                        }


                        


                        // 检查当前英雄是否已有该技能


                        const currentSkill = currentHero.appendSkill.find(skill => 


                            skill.skillId === savedSkillId && skill.active


                        );





                        if (!currentSkill) {


                            // 记录需要的技能


                            if (!requiredSkills.has(savedSkillId)) {


                                requiredSkills.set(savedSkillId, []);


                            }


                            requiredSkills.get(savedSkillId).push(parseInt(savedHeroId));


                        }


                    }


                }





                // 第二步：处理每个需要的技能


                for (const [skillId, needHeroes] of requiredSkills.entries()) {


                    await this.processSkillDistribution(skillId, needHeroes, currentFormationHeroes, ROLE, PearlService);


                }





                console.log('[英雄队伍增强] 英雄鱼珠技能配置检查完成');


            } catch (error) {


                console.error('[英雄队伍增强] 处理英雄鱼珠技能配置失败:', error);


                throw error;


            }


        }





        /**


         * 处理单个技能的分配


         */


        async processSkillDistribution(skillId, needHeroes, currentFormationHeroes, ROLE, PearlService) {


            const heroName = needHeroes.length > 0 ? this.getHeroName(needHeroes[0]) : '';


            // 检查未使用的技能数量


            const availableCount = ROLE.pearlSkillStorage.get(skillId) || 0;


            let processedCount = 0;





            // 优先使用未使用的技能


            for (const heroId of needHeroes) {


                if (processedCount >= availableCount) {


                    break; // 未使用的技能用完了


                }





                const currentHero = this.getHeroFromMap(ROLE.heroes, heroId);


                if (!currentHero || !currentHero.pearlId || currentHero.pearlId <= 0) {


                    const heroName = this.getHeroName(heroId);                    continue;


                }





                const heroName = this.getHeroName(heroId);


                


                await this.replacePearlSkill(PearlService, currentHero.pearlId, skillId);


                processedCount++;


            }





            // 如果还有英雄需要该技能，从其他鱼珠上拆取


            const remainingHeroes = needHeroes.slice(processedCount);


            if (remainingHeroes.length > 0) {


                await this.processSkillTransfer(skillId, remainingHeroes, currentFormationHeroes, ROLE, PearlService);


            }


        }





        /**


         * 处理技能转移（从其他鱼珠上拆取）


         */


        async processSkillTransfer(skillId, needHeroes, currentFormationHeroes, ROLE, PearlService) {


            // 过滤掉已经有该技能的英雄（鱼珠上已有该技能）


            const actualNeedHeroes = [];


            for (const heroId of needHeroes) {


                const currentHero = this.getHeroFromMap(ROLE.heroes, heroId);


                if (!currentHero || !currentHero.pearlId || currentHero.pearlId <= 0) {


                    continue;


                }


                


                // 检查该英雄的鱼珠是否已经有这个技能


                const pearlData = ROLE.pearlMap.get(currentHero.pearlId);


                if (pearlData && pearlData.skillId === skillId) {


                    const heroName = this.getHeroName(heroId);                    continue;


                }


                


                actualNeedHeroes.push(heroId);


            }


            


            if (actualNeedHeroes.length === 0) {                return;


            }





            // 查找所有拥有该技能的鱼珠


            const pearlsWithSkill = [];


            for (const [pearlId, pearlData] of ROLE.pearlMap.entries()) {


                if (pearlData && pearlData.skillId === skillId) {


                    // 检查该鱼珠是否被当前阵容中的英雄佩戴


                    const ownerHero = this.findHeroByPearlId(ROLE.heroes, pearlId);


                    const isInCurrentFormation = ownerHero && currentFormationHeroes.has(ownerHero.heroId);


                    


                    pearlsWithSkill.push({


                        pearlId,


                        ownerHero,


                        isInCurrentFormation,


                        priority: isInCurrentFormation ? 1 : 0 // 非阵容英雄优先


                    });


                }


            }





            // 按优先级排序：非阵容英雄的鱼珠优先


            pearlsWithSkill.sort((a, b) => a.priority - b.priority);





            let transferIndex = 0;


            for (const heroId of actualNeedHeroes) {


                const currentHero = this.getHeroFromMap(ROLE.heroes, heroId);


                if (!currentHero || !currentHero.pearlId || currentHero.pearlId <= 0) {


                    const heroName = this.getHeroName(heroId);                    continue;


                }





                // 查找可用的源鱼珠（排除当前英雄自己的鱼珠）


                let sourcePearl = null;


                while (transferIndex < pearlsWithSkill.length) {


                    const candidate = pearlsWithSkill[transferIndex];


                    transferIndex++;


                    


                    // 跳过当前英雄自己的鱼珠


                    if (candidate.pearlId === currentHero.pearlId) {                        continue;


                    }


                    


                    sourcePearl = candidate;


                    break;


                }





                if (!sourcePearl) {


                    const heroName = this.getHeroName(heroId);                    break;


                }





                const heroName = this.getHeroName(heroId);


                


                if (sourcePearl.ownerHero) {


                    const sourceHeroName = this.getHeroName(sourcePearl.ownerHero.heroId);                } else {                }





                await this.exchangePearlSkill(PearlService, sourcePearl.pearlId, currentHero.pearlId);


            }


        }





        /**


         * 根据鱼珠ID查找佩戴该鱼珠的英雄


         */


        findHeroByPearlId(heroes, pearlId) {


            for (const [heroId, heroData] of heroes.entries()) {


                if (heroData && heroData.pearlId === pearlId) {


                    return { heroId: parseInt(heroId), heroData };


                }


            }


            return null;


        }





        // 查找佩戴指定技能的鱼珠ID


        findPearlWithSkill(pearlMap, skillId) {


            for (const [pearlId, pearlData] of pearlMap.entries()) {


                if (pearlData && pearlData.skillId === skillId) {


                    return pearlId;


                }


            }


            return null;


        }





        // 交换两个鱼珠的技能


        async exchangePearlSkill(PearlService, pearlId1, pearlId2) {


            try {


                const result = await PearlService.exchangeSkill({


                    pearlId1: pearlId1,


                    pearlId2: pearlId2


                });


                


            } catch (error) {


                console.error(`[英雄队伍增强] 交换鱼珠技能异常:`, error);


                throw error;


            }


        }





        // 替换鱼珠技能


        async replacePearlSkill(PearlService, pearlId, skillId) {


            try {


                const result = await PearlService.replaceSkill({


                    skillId: skillId,


                    pearlId: pearlId


                });


                


            } catch (error) {


                console.error(`[英雄队伍增强] 替换鱼珠技能异常:`, error);


                throw error;


            }


        }





        // 处理英雄水晶和装备配置（内存直读直写方案，不依赖赐福 API）


        // 思路：saved.equipment 已包含装备完整内存快照（level/forge/quenchTimes/quenches/curQuenchId/enchantUId 等），


        //       切换阵容时把这些字段直接写回 ROLE.heroes[heroId].equipment[part] 内存对象。


        //       水晶和装备正反面（curTrump/curQuenchId）仍走原生 API 切换以保证服务器端同步。


        async processHeroTrumpAndEquipment(formation, ROLE, TrumpService, EquipmentService) {


            console.log('[英雄队伍增强] 开始检查英雄水晶和装备配置...');





            if (!formation.heroes) {


                console.log('[英雄队伍增强] 没有英雄配置信息');


                return;


            }





            // MobX Map / 普通对象 兼容读取装备槽位


            const getEquipSlot = (equipment, part) => {


                if (!equipment) return null;


                if (typeof equipment.get === 'function') {


                    return equipment.get(Number(part)) || equipment.get(String(part)) || null;


                }


                return equipment[Number(part)] || equipment[String(part)] || null;


            };





            // 写入 saved 字段到 currentEquip 内存对象（MobX observable 字段直接赋值即可触发响应）


            // 跳过 curQuenchId（由 changeQuench API 切换），其余字段（level/forge/quenches 等）直接覆盖


            const APPLY_FIELDS = [


                'level', 'star', 'attack', 'defense', 'hp',


                'forge', 'forgeExp',


                'enchantUId', 'enchantUId2',


                'quenchTimes', 'quenchTimes2',


                'quenches', 'quenches2',


                'quenchAttackExt', 'quenchDefenseExt', 'quenchHpExt',


                'seed',


                'equipId', 'equipConfId',


            ];


            const applyEquipMemory = (currentEquip, savedEquip, heroId, part) => {


                if (!currentEquip || !savedEquip) return 0;


                let changed = 0;


                for (const f of APPLY_FIELDS) {


                    if (savedEquip[f] === undefined) continue;


                    try {


                        const cur = currentEquip[f];


                        const next = savedEquip[f];


                        // 对于对象类型（quenches/quenches2）做浅 JSON 比较避免无谓写入


                        if (f === 'quenches' || f === 'quenches2') {


                            const curJson = JSON.stringify(cur || {});


                            const nextJson = JSON.stringify(next || {});


                            if (curJson !== nextJson) {


                                currentEquip[f] = JSON.parse(nextJson);


                                changed++;


                            }


                        } else if (cur !== next) {


                            currentEquip[f] = next;


                            changed++;


                        }


                    } catch (e) {


                        console.warn(`[英雄队伍增强][装备内存] 英雄 ${heroId} 部位 ${part} 字段 ${f} 写入失败:`, e);


                    }


                }


                return changed;


            };





            for (const [heroIdStr, heroConfig] of Object.entries(formation.heroes)) {


                const heroId = parseInt(heroIdStr);


                const currentHero = this.getHeroFromMap(ROLE.heroes, heroId);





                if (!currentHero) {


                    console.log(`[英雄队伍增强] 英雄 ${heroId} 不存在，跳过`);


                    continue;


                }





                console.log(`[英雄队伍增强] 英雄 ${heroId}: 检查水晶和装备配置`);





                // 1) 水晶切换（curTrump 归一化：0 / null / undefined 都视为无水晶）


                if ('curTrump' in heroConfig) {


                    const targetTrump = heroConfig.curTrump != null ? Number(heroConfig.curTrump) : 0;


                    const currentTrump = currentHero.curTrump != null ? Number(currentHero.curTrump) : 0;


                    if (currentTrump !== targetTrump) {


                        console.log(`[英雄队伍增强] 英雄 ${heroId}: 当前水晶 ${currentTrump}, 目标水晶 ${targetTrump}，正在切换...`);


                        try {


                            await this.changeTrump(TrumpService, heroId);


                        } catch (error) {


                            console.error(`[英雄队伍增强] 英雄 ${heroId} 切换水晶失败:`, error);


                        }


                    }


                }





                if (!heroConfig.equipment || Object.keys(heroConfig.equipment).length === 0) continue;





                // 2) 逐部位处理装备


                for (const [part, equipConfig] of Object.entries(heroConfig.equipment)) {


                    const currentEquip = getEquipSlot(currentHero.equipment, part);


                    if (!currentEquip) {


                        console.log(`[英雄队伍增强] 英雄 ${heroId} 部位 ${part}: 当前无装备，跳过`);


                        continue;


                    }





                    // 2a) 装备淬炼正反面（curQuenchId）走原生 API 切换 → 服务器同步


                    if (equipConfig.curQuenchId !== undefined


                        && Number(currentEquip.curQuenchId) !== Number(equipConfig.curQuenchId)) {


                        console.log(`[英雄队伍增强] 英雄 ${heroId} 装备部位 ${part}: 当前正反面 ${currentEquip.curQuenchId}, 目标 ${equipConfig.curQuenchId}, 正在切换...`);


                        try {


                            await this.changeEquipmentQuench(EquipmentService, heroId, parseInt(part));


                            currentEquip.curQuenchId = equipConfig.curQuenchId;


                            await new Promise(r => setTimeout(r, 300));


                        } catch (error) {


                            console.error(`[英雄队伍增强] 英雄 ${heroId} 装备部位 ${part} 切换正反面失败:`, error);


                        }


                    }





                    // 2b) 内存直写已禁用：写入 quenches 普通对象会破坏 MobX ObservableMap，


                    //     导致 UI 查看装备时 refreshAllCells reaction 抛 "e.forEach is not a function"。


                    //     装备跟着武将走的语义已由路径 1 fp 反查 + HeroService.exchange 实现，无需内存直写。


                }


            }





            console.log('[英雄队伍增强] 英雄水晶和装备配置检查完成');


        }





        // 切换英雄水晶


        async changeTrump(TrumpService, heroId) {


            try {                


                const result = await TrumpService.change({


                    heroId: heroId


                });                


                if (result && result.code === 0) {                } else {


                    const errorMsg = result?.error || '未知错误';


                    console.error(`[英雄队伍增强] 英雄 ${heroId} 水晶切换失败: ${errorMsg}`);


                    throw new Error(errorMsg);


                }


                


            } catch (error) {


                console.error(`[英雄队伍增强] 切换英雄 ${heroId} 水晶异常:`, error);


                throw error;


            }


        }





        // 切换装备正反面


        async changeEquipmentQuench(EquipmentService, heroId, part) {


            try {                


                const result = await EquipmentService.changeQuench({


                    heroId: heroId,


                    part: part


                });                


                if (result && result.code === 0) {


                    console.log(`[英雄队伍增强] 英雄 ${heroId} 装备部位 ${part} 正反面切换成功`);


                } else {


                    const errorMsg = result?.error || '未知错误';


                    console.error(`[英雄队伍增强] 英雄 ${heroId} 装备部位 ${part} 正反面切换失败: ${errorMsg}`);


                    throw new Error(errorMsg);


                }


                


            } catch (error) {


                console.error(`[英雄队伍增强] 切换英雄 ${heroId} 装备部位 ${part} 正反面异常:`, error);


                throw error;


            }


        }





        // 赐福装备：把 oriHero 部位 oriPart 的 oriQuenchId 淬炼词条赐福给 tarHero


        // 返回 boolean，不 throw，防止单个赐福失败触发游戏全局错误弹窗中断流程


        async enchantEquipment(EquipmentService, oriHeroId, oriPart, tarHeroId, oriQuenchId) {


            try {


                if (!EquipmentService || typeof EquipmentService.enchant !== 'function') {


                    console.error(`[英雄队伍增强] EquipmentService.enchant 方法不存在，跳过赐福`);


                    return false;


                }


                if (!oriQuenchId || Number(oriQuenchId) <= 0) {


                    console.error(`[英雄队伍增强] 英雄 ${oriHeroId} 部位 ${oriPart} oriQuenchId 无效(${oriQuenchId})，跳过赐福`);


                    return false;


                }


                const result = await EquipmentService.enchant({


                    oriHeroId: oriHeroId,


                    oriPart: oriPart,


                    tarHeroId: tarHeroId,


                    oriQuenchId: Number(oriQuenchId),


                });


                if (result && result.code === 0) {


                    console.log(`[英雄队伍增强] 英雄 ${oriHeroId} 装备部位 ${oriPart} 赐福成功`);


                    return true;


                }


                console.error(`[英雄队伍增强] 英雄 ${oriHeroId} 装备部位 ${oriPart} 赐福失败: ${result?.error || '未知错误'} (code=${result?.code})`);


                return false;


            } catch (error) {


                console.error(`[英雄队伍增强] 英雄 ${oriHeroId} 装备部位 ${oriPart} 赐福异常:`, error);


                return false;


            }


        }





        // 取消赐福：释放装备某卡位的赐福


        async cancelEnchantEquipment(EquipmentService, heroId, part, enchantUId) {


            try {


                if (!EquipmentService || typeof EquipmentService.cancelEnchant !== 'function') {


                    console.error(`[英雄队伍增强] EquipmentService.cancelEnchant 方法不存在，跳过取消赐福`);


                    return false;


                }


                if (!enchantUId || Number(enchantUId) <= 0) {


                    console.error(`[英雄队伍增强] 英雄 ${heroId} 部位 ${part} enchantUId 无效(${enchantUId})，跳过取消赐福`);


                    return false;


                }


                const result = await EquipmentService.cancelEnchant({


                    heroId: heroId,


                    part: part,


                    enchantUId: Number(enchantUId),


                });


                if (result && result.code === 0) {


                    console.log(`[英雄队伍增强] 英雄 ${heroId} 装备部位 ${part} 取消赐福成功`);


                    return true;


                }


                console.error(`[英雄队伍增强] 英雄 ${heroId} 装备部位 ${part} 取消赐福失败: ${result?.error || '未知错误'} (code=${result?.code})`);


                return false;


            } catch (error) {


                console.error(`[英雄队伍增强] 英雄 ${heroId} 装备部位 ${part} 取消赐福异常:`, error);


                return false;


            }


        }





        // 处理俱乐部科技配置（精准匹配优化版：只重置需要降级的职业，其余增量升级）


        async processLegionResearch(formation, ROLE, LegionService) {


            console.log('[英雄队伍增强] 开始检查俱乐部科技配置...');


            


            if (!formation.legionResearch || Object.keys(formation.legionResearch).length === 0) {


                console.log('[英雄队伍增强] 没有俱乐部科技配置信息');


                return;


            }





            if (!ROLE.legionResearch) {


                console.log('[英雄队伍增强] 当前角色没有俱乐部科技数据');


                return;


            }





            // 获取配置和工具


            const Configs = unsafeWindow.__require('Configs');


            const ResearchConf = Configs.ResearchConf;


            const Work = Configs.Work;


            const ModuleManager = unsafeWindow.__require('ModuleManager');


            const LegionModule = ModuleManager.GET_MODULE(Configs.ModuleType.LEGION);





            // 职业名称映射


            const workNames = {


                [Work.ZHANSHI]: '战士',


                [Work.ROUDUN]: '肉盾',


                [Work.FUZHU]: '辅助',


                [Work.FASHI]: '法师',


                [Work.CIKE]: '刺客',


                [Work.SHESHOU]: '射手'


            };





            // ==================== 步骤1：精准分析每个职业的差异 ====================


            console.log('[英雄队伍增强] 步骤1：精准分析各职业科技差异...');


            this.showTip('正在分析科技差异...', 'info');





            const workTypes = [];


            if (LegionModule.WORK_BAR) {


                for (const [workType, index] of LegionModule.WORK_BAR) {


                    if (workType && workType !== 0) {


                        workTypes.push({ workType, index });


                    }


                }


            }





            // 按职业分组目标科技


            const targetByWork = new Map(); // workType → [{id, target, config}]


            for (const [researchIdStr, targetLevel] of Object.entries(formation.legionResearch)) {


                const researchId = parseInt(researchIdStr);


                const researchConfig = ResearchConf.getByID(researchId);


                if (!researchConfig) continue;


                const work = researchConfig.work;


                if (!targetByWork.has(work)) targetByWork.set(work, []);


                targetByWork.get(work).push({


                    id: researchId,


                    target: targetLevel,


                    config: researchConfig


                });


            }





            // 分析每个职业：普通科技和高级科技分开判断


            // ★ 游戏限制：resetResearch(advanced:false) 重置普通科技时，服务器会连带清零高级科技


            //   所以如果普通需要重置，高级也必须重新升级回来


            //   但 resetResearch(advanced:true) 只重置高级，不影响普通


            const needResetNormal = [];   // 普通科技需要降级的职业（会连带清零高级）


            const needResetAdvanced = []; // 高级科技需要降级的职业（不影响普通）


            const needUpgrade = [];       // 只需增量升级的职业


            const alreadyOk = [];         // 完全匹配的职业





            for (const { workType, index } of workTypes) {


                const workName = workNames[workType] || `职业 ${workType}`;


                const targets = targetByWork.get(workType) || [];





                if (targets.length === 0) {


                    alreadyOk.push({ workType, workName });


                    continue;


                }





                let normalDecrease = false;


                let normalIncrease = false;


                let advancedDecrease = false;


                let advancedIncrease = false;





                for (const t of targets) {


                    const currentLevel = ROLE.legionResearch.get(t.id) || 0;


                    const isAdvanced = t.config && t.config.advanced;


                    if (currentLevel > t.target) {


                        if (isAdvanced) advancedDecrease = true;


                        else normalDecrease = true;


                    } else if (currentLevel < t.target) {


                        if (isAdvanced) advancedIncrease = true;


                        else normalIncrease = true;


                    }


                }





                const hasAnyChange = normalDecrease || normalIncrease || advancedDecrease || advancedIncrease;





                if (!hasAnyChange) {


                    alreadyOk.push({ workType, workName });


                } else {


                    if (normalDecrease) {


                        needResetNormal.push({ workType, index, workName });


                    }


                    // 高级科技单独降级（只在普通不需要重置时才单独重置高级）


                    if (advancedDecrease && !normalDecrease) {


                        needResetAdvanced.push({ workType, index, workName });


                    }


                    if (hasAnyChange && !normalDecrease && !advancedDecrease) {


                        needUpgrade.push({ workType, index, workName });


                    }


                }


            }





            const totalResets = needResetNormal.length + needResetAdvanced.length;


            console.log(`[英雄队伍增强] 分析结果: 普通科技需重置 ${needResetNormal.length} 个职业（会连带清零高级）, 高级科技单独重置 ${needResetAdvanced.length} 个职业, 增量升级 ${needUpgrade.length} 个职业, 已匹配 ${alreadyOk.length} 个职业`);





            // ★ 快速跳过


            if (totalResets === 0 && needUpgrade.length === 0) {


                console.log('[英雄队伍增强] 所有职业科技完全匹配，跳过科技配置');


                this.showTip('科技配置已匹配，跳过', 'success');


                return;


            }





            for (const item of alreadyOk) {


                console.log(`[英雄队伍增强] 职业【${item.workName}】科技已匹配，跳过`);


            }





            // ==================== 步骤2：执行重置 ====================


            // 2a: 重置普通科技（注意：服务器会连带清零该职业的高级科技）


            if (needResetNormal.length > 0) {


                console.log(`[英雄队伍增强] 步骤2a：重置 ${needResetNormal.length} 个职业的普通科技（高级科技会被连带清零）...`);


                for (const { workType, workName } of needResetNormal) {


                    this.showTip(`正在重置【${workName}】普通科技...`, 'info');


                    console.log(`[英雄队伍增强] 重置职业【${workName}】的普通科技`);


                    await LegionService.resetResearch({


                        type: workType,


                        advanced: false


                    });


                }


            }


            // 2b: 单独重置高级科技（仅在普通科技不需要重置时）


            if (needResetAdvanced.length > 0) {


                console.log(`[英雄队伍增强] 步骤2b：重置 ${needResetAdvanced.length} 个职业的高级科技...`);


                for (const { workType, workName } of needResetAdvanced) {


                    this.showTip(`正在重置【${workName}】高级科技...`, 'info');


                    console.log(`[英雄队伍增强] 重置职业【${workName}】的高级科技`);


                    await LegionService.resetResearch({


                        type: workType,


                        advanced: true


                    });


                }


            }


            if (totalResets === 0) {


                console.log('[英雄队伍增强] 步骤2：无需重置任何职业');


            }





            // ==================== 步骤3：升级科技 ====================


            console.log('[英雄队伍增强] 步骤3：升级科技...');





            const upgradeList = [];


            const resetNormalWorkTypes = new Set(needResetNormal.map(r => r.workType));


            const resetAdvancedWorkTypes = new Set(needResetAdvanced.map(r => r.workType));





            for (const [researchIdStr, targetLevel] of Object.entries(formation.legionResearch)) {


                const researchId = parseInt(researchIdStr);


                if (targetLevel === 0) continue;





                const currentLevel = ROLE.legionResearch.get(researchId) || 0;


                const researchConfig = ResearchConf.getByID(researchId);


                if (!researchConfig) continue;





                const work = researchConfig.work;


                const isAdvanced = researchConfig.advanced || false;





                // ★ 判断该科技是否被重置过（需要从0升级）


                let wasReset = false;


                if (isAdvanced) {


                    // 高级科技被重置的情况：


                    // 1. 该职业高级科技被单独重置了


                    // 2. 该职业普通科技被重置了（连带清零高级）


                    wasReset = resetAdvancedWorkTypes.has(work) || resetNormalWorkTypes.has(work);


                } else {


                    // 普通科技只在自己被重置时才需要从0升


                    wasReset = resetNormalWorkTypes.has(work);


                }





                if (wasReset || currentLevel < targetLevel) {


                    upgradeList.push({


                        id: researchId,


                        target: targetLevel,


                        work: work,


                        advanced: isAdvanced,


                        maxLevel: researchConfig.researchMaxLevel || 0


                    });


                }


            }





            if (upgradeList.length === 0) {


                console.log('[英雄队伍增强] 没有需要升级的科技');


                this.showTip('科技配置已完成', 'success');


                return;


            }





            // 排序：先按职业分组，每个职业内按科技ID顺序


            upgradeList.sort((a, b) => {


                if (a.work !== b.work) return a.work - b.work;


                return a.id - b.id;


            });





            this.showTip(`准备升级 ${upgradeList.length} 个科技项目...`, 'info');


            


            let lastWorkType = null;


            for (let i = 0; i < upgradeList.length; i++) {


                const item = upgradeList[i];


                try {


                    // 再次检查当前等级（可能在升级过程中已变化）


                    const currentLevel = ROLE.legionResearch.get(item.id) || 0;


                    if (currentLevel >= item.target) {


                        continue;


                    }


                    


                    const researchConfig = ResearchConf.getByID(item.id);


                    


                    // 只在切换职业时显示提示


                    if (item.work !== lastWorkType) {


                        const workName = researchConfig ? (workNames[researchConfig.work] || `职业 ${researchConfig.work}`) : '';


                        this.showTip(`正在升级【${workName}】科技...`, 'info');


                        lastWorkType = item.work;


                    }


                    


                    const isMaxLevel = (researchConfig && researchConfig.researchMaxLevel === item.target);


                    await this.upgradeLegionResearch(LegionService, item.id, item.target, isMaxLevel);


                    


                } catch (error) {


                    console.error(`[英雄队伍增强] 升级科技 ${item.id} 失败:`, error);


                    this.showTip(`科技升级失败，已停止`, 'error');


                    break;


                }


            }


            


            console.log('[英雄队伍增强] 俱乐部科技配置完成');


        }





        // 重置所有俱乐部科技（只重置有科技的职业）


        async resetAllLegionResearch(LegionService, ROLE, LegionModule) {


            try {


                if (!LegionModule || !LegionModule.WORK_BAR) {


                    throw new Error('无法获取LegionModule');


                }





                if (!ROLE || !ROLE.legionResearch) {


                    throw new Error('无法获取角色科技数据');


                }





                // 获取所有工作类型


                const workTypes = [];


                if (LegionModule.WORK_BAR) {


                    for (const [workType, index] of LegionModule.WORK_BAR) {


                        if (workType && workType !== 0) {


                            workTypes.push({ workType, index });


                        }


                    }


                }





                // 重置每个工作类型的科技（只重置有科技的职业）


                for (const { workType, index } of workTypes) {


                    // 检查该职业是否有科技


                    const normalResearchList = LegionModule.researchMap.get(workType);


                    const highResearchList = LegionModule.researchHighMap.get(workType);





                    let hasResearch = false;





                    // 检查普通科技


                    if (normalResearchList && normalResearchList.length > 0) {


                        for (const research of normalResearchList) {


                            const level = ROLE.legionResearch.get ? 


                                ROLE.legionResearch.get(research.ID) || 0 : 


                                ROLE.legionResearch[research.ID] || 0;


                            if (level > 0) {


                                hasResearch = true;


                                break;


                            }


                        }


                    }





                    // 检查高级科技


                    if (!hasResearch && highResearchList && highResearchList.length > 0) {


                        for (const research of highResearchList) {


                            const level = ROLE.legionResearch.get ? 


                                ROLE.legionResearch.get(research.ID) || 0 : 


                                ROLE.legionResearch[research.ID] || 0;


                            if (level > 0) {


                                hasResearch = true;


                                break;


                            }


                        }


                    }





                    // 只重置有科技的职业


                    if (hasResearch) {                        


                        await LegionService.resetResearch({


                            type: workType,


                            advanced: false


                        });


                    } else {                    }


                }





            } catch (error) {


                console.error('[英雄队伍增强] 重置俱乐部科技异常:', error);


                throw error;


            }


        }








        // 升级俱乐部科技（简化版，不检查前置条件）


        async upgradeLegionResearch(LegionService, researchId, targetLevel, isMaxLevel) {


            try {


                const ServerData = unsafeWindow.__require('ServerData');


                const ROLE = ServerData.ROLE;


                


                if (!ROLE || !ROLE.legionResearch) {


                    throw new Error('无法获取角色科技数据');


                }





                // 如果是满级，直接一次升满


                if (isMaxLevel) {


                    await LegionService.research({


                        researchId: researchId,


                        isMax: true


                    });


                    return true;


                } else {


                    // 不是满级，直接循环调用升级 API，不等待返回


                    const currentLevel = ROLE.legionResearch.get(researchId) || 0;


                    const upgradeCount = targetLevel - currentLevel;


                    


                    if (upgradeCount > 0) {


                        for (let i = 0; i < upgradeCount; i++) {


                            LegionService.research({


                                researchId: researchId,


                                isMax: false


                            });


                        }


                    }


                    return true;


                }





            } catch (error) {


                console.error(`[英雄队伍增强] 升级科技 ${researchId} 异常:`, error);


                throw error;


            }


        }





        // 处理英雄皮肤切换


        async processHeroSkins(formation, ROLE, HeroService) {


            try {


                if (!formation.heroes || !ROLE.heroes) {


                    console.log('[英雄队伍增强] 跳过皮肤检查：无英雄数据');


                    return;


                }





                console.log('[英雄队伍增强] 开始检查英雄皮肤...');


                let skinUpdateCount = 0;


                const totalHeroes = Object.keys(formation.heroes).length;





                for (const [heroId, heroConfig] of Object.entries(formation.heroes)) {


                    // 获取保存的皮肤ID (useSkin)


                    const targetSkinId = heroConfig.useSkin;


                    if (targetSkinId === undefined || targetSkinId === null) {


                        continue;


                    }





                    // 获取当前角色数据中的英雄


                    const currentHero = this.getHeroFromMap(ROLE.heroes, parseInt(heroId));


                    if (!currentHero) {


                        continue;


                    }





                    // 检查当前使用的皮肤是否一致


                    const currentSkinId = currentHero.useSkin;


                    if (parseInt(currentSkinId) !== parseInt(targetSkinId)) {


                        const heroName = this.getHeroName(heroId);


                        skinUpdateCount++;


                        this.showTip(`正在切换英雄 ${heroName} 的皮肤 (${skinUpdateCount}/${totalHeroes})`, 'info');


                        


                        // 调用 HeroService.useSkin


                        if (typeof HeroService.useSkin === 'function') {


                            await HeroService.useSkin({


                                heroId: parseInt(heroId),


                                skinId: parseInt(targetSkinId)


                            });


                        } else {


                            console.warn('[英雄队伍增强] HeroService.useSkin 方法不可用');


                        }


                    }


                }





                if (skinUpdateCount > 0) {


                    console.log(`[英雄队伍增强] 皮肤切换完成，共切换了 ${skinUpdateCount} 个英雄皮肤`);


                } else {


                    console.log('[英雄队伍增强] 所有英雄皮肤已匹配，无需切换');


                }


            } catch (error) {


                console.error('[英雄队伍增强] 处理皮肤切换失败:', error);


                this.showTip(`皮肤切换失败: ${error.message}`, 'error');


            }


        }





        // 处理主公武器配置


        async processLordWeapon(formation, ROLE, LordWeaponService) {


            console.log('[英雄队伍增强] 开始检查主公武器配置...');


            


            // 检查是否有保存的主公武器配置


            if (formation.lordWeaponId === null || formation.lordWeaponId === undefined) {


                console.log('[英雄队伍增强] 没有保存的主公武器配置');


                return;


            }





            const currentLordWeaponId = ROLE.lordWeaponId;


            const targetLordWeaponId = formation.lordWeaponId;





            console.log(`[英雄队伍增强] 主公武器检查: 当前武器 ${currentLordWeaponId}, 目标武器 ${targetLordWeaponId}`);





            if (currentLordWeaponId !== targetLordWeaponId) {


                console.log(`[英雄队伍增强] 主公武器不一致，需要切换`);


                


                try {


                    await this.changeLordWeapon(LordWeaponService, targetLordWeaponId);                } catch (error) {


                    console.error(`[英雄队伍增强] 主公武器切换失败:`, error);


                    throw error;


                }


            } else {


                console.log(`[英雄队伍增强] 主公武器配置已正确`);


            }


            


            console.log('[英雄队伍增强] 主公武器配置检查完成');


        }





        // 切换主公武器


        async changeLordWeapon(LordWeaponService, weaponId) {


            try {                


                const result = await LordWeaponService.changeDefaultWeapon({


                    weaponId: weaponId


                });                


                if (result && result.code === 0) {                } else {


                    const errorMsg = result?.error || '未知错误';


                    console.error(`[英雄队伍增强] 主公武器切换失败: ${errorMsg}`);


                    throw new Error(errorMsg);


                }


                


            } catch (error) {


                console.error(`[英雄队伍增强] 切换主公武器异常:`, error);


                throw error;


            }


        }





        // 英雄战斗位置调整处理


        async processHeroBattlePosition(formation, ROLE, HeroService) {


            try {


                if (!formation.battleTeam || !ROLE.battleTeam) {


                    console.log('[英雄队伍增强] 跳过战斗位置调整：没有战斗队伍数据');


                    return;


                }





                console.log('[英雄队伍增强] 开始检查英雄战斗位置...');





                // 获取当前战斗队伍的英雄ID分布


                const currentBattleTeam = {};


                if (typeof ROLE.battleTeam.forEach === 'function') {


                    // MobX Map方式遍历


                    ROLE.battleTeam.forEach((heroData, slot) => {


                        if (heroData && heroData.heroId) {


                            currentBattleTeam[slot] = heroData.heroId;


                        }


                    });


                } else if (typeof ROLE.battleTeam.entries === 'function') {


                    // 普通Map方式遍历


                    for (const [slot, heroData] of ROLE.battleTeam.entries()) {


                        if (heroData && heroData.heroId) {


                            currentBattleTeam[slot] = heroData.heroId;


                        }


                    }


                } else if (typeof ROLE.battleTeam === 'object') {


                    // 普通对象方式


                    for (const [slot, heroData] of Object.entries(ROLE.battleTeam)) {


                        if (heroData && heroData.heroId) {


                            currentBattleTeam[slot] = heroData.heroId;


                        }


                    }


                }





                console.log('[英雄队伍增强] 当前战斗队伍:', currentBattleTeam);


                console.log('[英雄队伍增强] 目标战斗队伍:', formation.battleTeam);





                let positionChangeCount = 0;


                const totalPositions = Object.keys(formation.battleTeam).length;





                // 检查每个位置的英雄是否正确


                for (const [slot, targetHeroId] of Object.entries(formation.battleTeam)) {


                    const slotNum = parseInt(slot);


                    const currentHeroId = currentBattleTeam[slotNum];


                    


                    if (currentHeroId !== targetHeroId) {


                        positionChangeCount++;


                        this.showTip(`正在调整位置 ${slotNum}: ${this.getHeroName(targetHeroId)} (${positionChangeCount}/${totalPositions})`, 'info');                        


                        // 调用goIntoBattle将英雄放到指定位置


                        await this.moveHeroToBattlePosition(HeroService, slotNum, targetHeroId);


                    } else {                    }


                }





                if (positionChangeCount > 0) {


                    console.log(`[英雄队伍增强] 战斗位置调整完成，共调整了${positionChangeCount}个位置`);


                } else {


                    console.log('[英雄队伍增强] 所有英雄战斗位置已正确，无需调整');


                }


            } catch (error) {


                console.error('[英雄队伍增强] 处理英雄战斗位置失败:', error);


                this.showTip(`战斗位置调整失败: ${error.message}`, 'error');


                throw error;


            }


        }





        // 移动英雄到指定战斗位置


        async moveHeroToBattlePosition(HeroService, slot, heroId) {


            try {                


                if (typeof HeroService.goIntoBattle === 'function') {


                    const result = await HeroService.goIntoBattle({ slot: slot, heroId: heroId });


                    


                    console.log(`[英雄队伍增强] 位置调整API响应:`, result);


                    


                    if (result && result.code === 0) {                        // 等待服务器数据同步


                        await new Promise(resolve => setTimeout(resolve, 300));


                    } else {


                        const errorMsg = (result && result.error) || `位置调整失败，错误代码: ${result ? result.code : 'unknown'}`;


                        console.error(`[英雄队伍增强] 英雄 ${heroId} 位置调整失败: ${errorMsg}`);


                        this.showTip(`英雄位置调整失败: ${errorMsg}`, 'error');


                        throw new Error(errorMsg);


                    }


                } else {


                    const errorMsg = 'HeroService.goIntoBattle 方法不可用';


                    console.error(`[英雄队伍增强] ${errorMsg}`);


                    this.showTip(errorMsg, 'error');


                    throw new Error(errorMsg);


                }


            } catch (error) {


                console.error(`[英雄队伍增强] 移动英雄 ${heroId} 到位置 ${slot} 异常:`, error);


                this.showTip(`移动英雄异常: ${error.message}`, 'error');


                throw error;


            }


        }





        // 刷新主页推图阵容


        async refreshMainPageFormation(FightService) {


            try {                


                // 方法1：调用FightService.startLevel()


                const result = await FightService.startLevel();                


                // 方法2：发射相关的刷新信号


                try {


                    const GlobalSignal = unsafeWindow.__require('GlobalSignal').GlobalSignal;


                    if (GlobalSignal) {


                        // 刷新战斗队伍


                        if (GlobalSignal.SyncBattleTeam && typeof GlobalSignal.SyncBattleTeam.emit === 'function') {


                            GlobalSignal.SyncBattleTeam.emit();


                        }


                        // 重置关卡战斗（让游戏用新阵容重新计算）


                        if (GlobalSignal.LevelBattleReset && typeof GlobalSignal.LevelBattleReset.emit === 'function') {


                            GlobalSignal.LevelBattleReset.emit();


                        }


                        // 刷新英雄队伍面板


                        if (GlobalSignal.EventRefreshHeroTeamPanel && typeof GlobalSignal.EventRefreshHeroTeamPanel.emit === 'function') {


                            GlobalSignal.EventRefreshHeroTeamPanel.emit();


                        }


                    }


                } catch (signalError) {


                    console.warn('[英雄队伍增强] 发射刷新信号失败:', signalError);


                }


                


                if (result && result.code === 0) {                } else {


                    const errorMsg = result?.error || '未知错误';


                    console.warn(`[英雄队伍增强] FightService.startLevel() 返回错误: ${errorMsg}`);


                    // 这里不抛出异常，因为这不是关键功能


                }


                


            } catch (error) {


                console.error('[英雄队伍增强] 刷新主页推图阵容异常:', error);


                // 这里不抛出异常，因为这不是关键功能


            }


        }





        // 切换成功后自动刷新 saved 的 fp（防止洗炼漂移累积导致下次切换失配）


        //   用当前 ROLE 中各 saved 英雄的真实 fp 覆盖 saved.equipmentFp/equipmentFpStable


        //   持久化到 localStorage，让下次切换基于最新状态


        async refreshTeamFingerprints(team, ROLE) {


            try {


                if (!team || !team.formation || !team.formation.heroes || !ROLE.heroes) return;


                let changed = 0;


                for (const [savedHeroId, heroConfig] of Object.entries(team.formation.heroes)) {


                    const hid = parseInt(savedHeroId);


                    const h = this.getHeroFromMap(ROLE.heroes, hid);


                    if (!h) continue;


                    let newFp = null, newFpStable = null;


                    try { newFp = this.getEquipmentFingerprint(h.equipment); } catch (e) {}


                    try { newFpStable = this.getEquipmentFingerprint(h.equipment, 'stable'); } catch (e) {}


                    if (!newFp || newFp === '__none__') continue;


                    if (newFp !== heroConfig.equipmentFp || newFpStable !== heroConfig.equipmentFpStable) {


                        heroConfig.equipmentFp = newFp;


                        heroConfig.equipmentFpStable = newFpStable;


                        changed++;


                    }


                }


                if (changed > 0) {


                    const teams = this.loadTeams();


                    const idx = teams.findIndex(t => t.id === team.id);


                    if (idx !== -1) {


                        teams[idx].formation = team.formation;


                        this.saveTeams(teams);


                        console.log(`[英雄队伍增强] 已自动刷新 saved fp（${changed} 个英雄变更），下次切换基于最新状态`);


                    }


                }


            } catch (e) {


                console.warn('[英雄队伍增强] refreshTeamFingerprints 异常:', e);


            }


        }





        // ── 指纹容差匹配 ── 用于 post-verify 吸收洗炼微漂移，避免误报


        // fp 格式：段用 '|' 分隔，字段用 ':' 分隔。同段同 index 字段比较：


        //   - 非纯数字字段（如 'fb'/'-'）必须严格相同


        //   - 数字字段允许相对误差 ≤ rel（默认5%）或绝对误差 ≤ abs（默认50）


        // 段数不同直接视为不匹配（装备件数不同肯定是真错配）


        _fuzzyFpMatch(fpA, fpB, rel, abs) {


            if (!fpA || !fpB) return false;


            if (fpA === fpB) return true;


            rel = (typeof rel === 'number') ? rel : 0.05;


            abs = (typeof abs === 'number') ? abs : 50;


            const segsA = String(fpA).split('|');


            const segsB = String(fpB).split('|');


            if (segsA.length !== segsB.length) return false;


            const NUM_RE = /^-?\d+(\.\d+)?$/;


            for (let i = 0; i < segsA.length; i++) {


                const fieldsA = segsA[i].split(':');


                const fieldsB = segsB[i].split(':');


                if (fieldsA.length !== fieldsB.length) return false;


                for (let j = 0; j < fieldsA.length; j++) {


                    const a = fieldsA[j], b = fieldsB[j];


                    if (a === b) continue;


                    if (NUM_RE.test(a) && NUM_RE.test(b)) {


                        const na = parseFloat(a), nb = parseFloat(b);


                        const diff = Math.abs(na - nb);


                        const base = Math.max(Math.abs(na), Math.abs(nb), 1);


                        if (diff <= abs) continue;


                        if (diff / base <= rel) continue;


                        return false;


                    }


                    return false;


                }


            }


            return true;


        }





        // ── 装备指纹方案 ── 用于无损换将的载体身份反查


        // 设计：装备只能戴在一个英雄身上 + hero_exchange 时装备跟着英雄一起走


        // 所以"当前账号上戴着 saved 装备的英雄"= 要把培养数据转给 saved 的载体 B


        // 调用 HeroService.exchange(saved, B) → B 的等级/装备/技能转给 saved，无需重新升级


        getEquipmentFingerprint(equipment, mode) {


            if (!equipment) return '__none__';


            const isStable = (mode === 'stable');


            const _toNum = (v, d) => {


                const n = Number(v);


                return isFinite(n) ? n : d;


            };


            const isBlankPiece = (piece) => {


                if (!piece || typeof piece !== 'object') return true;


                const equipId = _toNum(piece.equipId, 0);


                const equipConfId = _toNum(piece.equipConfId, 0);


                const level = _toNum(piece.level, 1);


                const forge = _toNum(piece.forge, 0);


                const star = _toNum(piece.star, 0);


                const curQ = _toNum(piece.curQuenchId !== undefined ? piece.curQuenchId : (piece.equipCurQuench !== undefined ? piece.equipCurQuench : piece.quenchId), 0);


                const qt = _toNum(piece.quenchTimes, 0);


                const qt2 = _toNum(piece.quenchTimes2, 0);


                const qLogId = String(piece.quenchLogId || '');


                const qLogId2 = String(piece.quenchLogId2 || '');


                const hasQ = !!piece.quenches || !!piece.quenches2;


                return equipId <= 0 && equipConfId <= 0 && level <= 1 && forge <= 0 && star <= 0


                    && curQ <= 0 && qt <= 0 && qt2 <= 0 && !qLogId && !qLogId2 && !hasQ;


            };


            const serializeQuenches = (lines) => {


                if (!lines || typeof lines !== 'object') return '';


                try {


                    return Object.entries(lines)


                        .sort((a, b) => _toNum(a[0], 0) - _toNum(b[0], 0))


                        .map(([idx, line]) => {


                            const colorId = _toNum(line && line.colorId, 0);


                            const attrId = _toNum(line && line.attrId, 0);


                            const attrNum = _toNum(line && line.attrNum, 0);


                            const isLocked = (line && line.isLocked) ? 1 : 0;


                            return `${idx}:${colorId}:${attrId}:${attrNum}:${isLocked}`;


                        })


                        .join(',');


                } catch (e) { return ''; }


            };





            // 把 MobX Map / 普通对象统一成 plain getter


            const getSlot = (slot) => {


                try {


                    if (typeof equipment.get === 'function') {


                        return equipment.get(slot) || equipment.get(String(slot));


                    }


                    return equipment[slot] || equipment[String(slot)];


                } catch (e) { return null; }


            };





            const parts = [];


            let hasReal = false;


            for (const slot of [1, 2, 3, 4]) {


                const piece = getSlot(slot);


                if (isBlankPiece(piece)) {


                    parts.push(`${slot}:blank`);


                    continue;


                }


                hasReal = true;


                // 核心指纹：装备实例 ID（equipId）— 这是装备的内存唯一身份，


                // 不会因淬炼/强化/换装等任何操作而改变，hero_exchange 时会跟着英雄一起走，


                // 所以最稳定的载体反查就是「哪个英雄当前持有 saved 时记录的 equipId 集合」


                const equipId = _toNum(piece.equipId, 0);


                if (equipId > 0) {


                    parts.push(`${slot}:eid:${equipId}`);


                    continue;


                }


                // equipId 缺失时退化到 quenchLogId（仅作兜底，少数账号字段命名可能不同）


                const qLogId = String(piece.quenchLogId || '');


                const qLogId2 = String(piece.quenchLogId2 || '');


                if (qLogId || qLogId2) {


                    parts.push(`${slot}:log:${qLogId || '-'}:${qLogId2 || '-'}`);


                    continue;


                }


                // 兜底（实测当前游戏版本所有 ID 字段恒为 0，必须靠属性快照标识装备）：


                // 内存里真实存在的字段：level / attack / defense / hp / forge / forgeExp / star / seed


                //                       quenchTimes / quenchTimes2 / quenchAttackExt / quenchDefenseExt / quenchHpExt


                //                       quenches / quenches2（淬炼词条详情）


                // 这些是装备的完整属性快照，组合起来唯一性极强；同一装备未被改动时跨多次切换稳定不变


                const level = _toNum(piece.level, 0);


                const atk = _toNum(piece.attack, 0);


                const def = _toNum(piece.defense, 0);


                const hp = _toNum(piece.hp, 0);


                const forge = _toNum(piece.forge, 0);


                const forgeExp = _toNum(piece.forgeExp, 0);


                const star = _toNum(piece.star, 0);


                const seed = _toNum(piece.seed, 0);


                const qt = _toNum(piece.quenchTimes, 0);


                const qt2 = _toNum(piece.quenchTimes2, 0);


                const curQ = _toNum(piece.curQuenchId !== undefined ? piece.curQuenchId : (piece.equipCurQuench !== undefined ? piece.equipCurQuench : piece.quenchId), 0);


                const qAtk = _toNum(piece.quenchAttackExt, 0);


                const qDef = _toNum(piece.quenchDefenseExt, 0);


                const qHp = _toNum(piece.quenchHpExt, 0);


                if (isStable) {


                    // 弹性指纹：剔除任何可能受洗炼影响的字段


                    //   为什么排除 atk/def/hp：实测部分版本 piece.attack 等于 base + quench 加成（UI 显示的总值），


                    //   洗炼后该值漂移 → stable fp 仍会失配（用户报告 ">5 件洗炼出错"的根因）


                    //   保留的字段：强化/进阶/升星/种子等洗炼绝不影响的属性


                    //   + equipConfId（装备模板 ID）：同英雄的 4 个 slot 装备模板通常不同，大幅降低撞车率


                    var ecid = _toNum(piece.equipConfId, 0) || _toNum(piece.equipId, 0);


                    parts.push([slot, 'sb', level, forge, forgeExp, star, seed, ecid].join(':'));


                    continue;


                }


                const qLines = serializeQuenches(piece.quenches);


                const qLines2 = serializeQuenches(piece.quenches2);


                parts.push([slot, 'fb', level, atk, def, hp, forge, forgeExp, star, seed, qt, qt2, curQ, qAtk, qDef, qHp, qLines || '-', qLines2 || '-'].join(':'));


            }


            if (!hasReal) return '__none__';


            return parts.join('|');


        }





        // 根据装备指纹反查英雄ID（无损换将的核心）


        findHeroByEquipmentFingerprint(fp, heroes, mode) {


            if (!fp || fp === '__none__') return null;


            try {


                let result = null;


                if (typeof heroes.forEach === 'function') {


                    heroes.forEach((hero, hid) => {


                        if (!result && hero) {


                            const heroFp = this.getEquipmentFingerprint(hero.equipment, mode);


                            if (heroFp === fp) result = hid;


                        }


                    });


                } else if (typeof heroes.entries === 'function') {


                    for (const [hid, hero] of heroes.entries()) {


                        if (hero && this.getEquipmentFingerprint(hero.equipment, mode) === fp) {


                            return hid;


                        }


                    }


                } else {


                    for (const [hid, hero] of Object.entries(heroes)) {


                        if (hero && this.getEquipmentFingerprint(hero.equipment, mode) === fp) {


                            return parseInt(hid);


                        }


                    }


                }


                return result;


            } catch (error) {


                console.error('[英雄队伍增强] 装备指纹反查失败:', error);


                return null;


            }


        }





        // 根据attachmentUid查找英雄ID


        findHeroByAttachmentUid(attachmentUid, heroes) {


            try {


                if (typeof heroes.forEach === 'function') {


                    // MobX Map方式遍历


                    let foundHeroId = null;


                    heroes.forEach((hero, heroId) => {


                        if (hero && hero.attachmentUid === attachmentUid) {


                            foundHeroId = heroId;


                        }


                    });


                    return foundHeroId;


                } else if (typeof heroes.entries === 'function') {


                    // 使用entries方式遍历


                    for (const [heroId, hero] of heroes.entries()) {


                        if (hero && hero.attachmentUid === attachmentUid) {


                            return heroId;


                        }


                    }


                } else {


                    // 普通对象方式遍历


                    for (const [heroId, hero] of Object.entries(heroes)) {


                        if (hero && hero.attachmentUid === attachmentUid) {


                            return parseInt(heroId);


                        }


                    }


                }


                return null;


            } catch (error) {


                console.error('[英雄队伍增强] 查找英雄失败:', error);


                return null;


            }


        }





        // 执行英雄交换


        async exchangeHeroes(HeroService, heroId, targetHeroId) {


                    try {


                        const exchangeParams = {


                            heroId: heroId,


                            targetHeroId: targetHeroId


                        };





                        // 调用HeroService.exchange方法


                        if (typeof HeroService.exchange === 'function') {


                            const result = await HeroService.exchange(exchangeParams);





                            // 检查响应的code字段


                            if (result.code === 0) {


                                // 等待服务器数据同步


                                await new Promise(resolve => setTimeout(resolve, 300));





                                // 执行交换后的必要更新


                                await this.postExchangeUpdate(heroId, targetHeroId);


                            } else {


                                // 打印错误信息


                                const errorMsg = result.error || `未知错误，错误代码: ${result.code}`;


                                console.error(`[英雄队伍增强] 英雄交换失败: ${errorMsg}`);


                                this.showTip(`英雄交换失败: ${errorMsg}`, 'error');


                                throw new Error(errorMsg);


                            }


                        } else {


                            const errorMsg = 'HeroService.exchange 方法不可用';


                            console.error(`[英雄队伍增强] ${errorMsg}`);


                            this.showTip(errorMsg, 'error');


                            throw new Error(errorMsg);


                        }


                    } catch (error) {


                        console.error(`[英雄队伍增强] 英雄交换异常 ${heroId} <-> ${targetHeroId}:`, error);


                        this.showTip(`英雄交换异常: ${error.message}`, 'error');


                        throw error;


                    }


                }








        // 英雄交换后的更新处理


        async postExchangeUpdate(heroId, targetHeroId) {


            try {                


                // 获取GlobalSignal，这是游戏的核心信号系统


                const GlobalSignal = unsafeWindow.__require('GlobalSignal').GlobalSignal;


                


                if (GlobalSignal) {


                    // 发射英雄交换完成信号，这是游戏原生的刷新机制


                    if (GlobalSignal.EventHBExchanged && typeof GlobalSignal.EventHBExchanged.emit === 'function') {


                        GlobalSignal.EventHBExchanged.emit(heroId, targetHeroId);                    }


                    


                    // 刷新英雄装备和鱼灵显示（解决装备颜色不更新问题）


                    if (GlobalSignal.SyncHeroArtifact && typeof GlobalSignal.SyncHeroArtifact.emit === 'function') {


                        GlobalSignal.SyncHeroArtifact.emit();                    }


                    


                    // 刷新英雄队伍面板


                    if (GlobalSignal.EventRefreshHeroTeamPanel && typeof GlobalSignal.EventRefreshHeroTeamPanel.emit === 'function') {


                        GlobalSignal.EventRefreshHeroTeamPanel.emit();                    }


                    


                    // 刷新英雄列表


                    if (GlobalSignal.SyncHeroList && typeof GlobalSignal.SyncHeroList.emit === 'function') {


                        GlobalSignal.SyncHeroList.emit();                    }


                    


                } else {


                    console.warn('[英雄队伍增强] 无法获取 GlobalSignal');


                }                


            } catch (error) {


                console.error('[英雄队伍增强] 交换后更新处理失败:', error);


                // 不抛出错误，因为这不应该阻止整个切换流程


            }


        }








        // 验证英雄是否存在


        validateHeroes(formation, playerHeroes) {


            const missingHeroes = [];


            


            if (formation.battleTeam) {


                Object.values(formation.battleTeam).forEach(heroId => {


                    if (heroId) {


                        const hero = playerHeroes.get ? playerHeroes.get(heroId) : playerHeroes[heroId];


                        if (!hero) {


                            missingHeroes.push(heroId);


                        }


                    }


                });


            }


            


            return missingHeroes;


        }





        // 应用阵容配置


        applyFormation(formation, ROLE) {


            try {


                // 1. 切换主公武器


                if (formation.lordWeaponId && formation.lordWeaponId !== ROLE.lordWeaponId) {


                    this.switchLordWeapon(formation.lordWeaponId, ROLE);


                }





                // 2. 切换战斗队伍


                if (formation.battleTeam) {


                    this.switchBattleTeam(formation.battleTeam, ROLE);


                }





                // 3. 应用英雄配置（装备、神器、珍珠等）


                if (formation.heroes) {


                    this.applyHeroConfigs(formation.heroes, ROLE);


                }





                // 4. 应用俱乐部科技（如果需要）


                if (formation.legionResearch) {


                    this.applyLegionResearch(formation.legionResearch, ROLE);


                }





            } catch (error) {


                console.error('[英雄队伍增强] 应用阵容配置失败:', error);


                throw error;


            }


        }





        // 切换主公武器


        switchLordWeapon(weaponId, ROLE) {


            try {


                if (ROLE.lordWeaponId !== weaponId) {


                    ROLE.lordWeaponId = weaponId;


                    console.log('[英雄队伍增强] 主公武器已切换:', weaponId);


                }


            } catch (error) {


                console.error('[英雄队伍增强] 切换主公武器失败:', error);


            }


        }





        // 切换战斗队伍


        switchBattleTeam(battleTeam, ROLE) {


            try {


                // 清空当前队伍


                if (ROLE.battleTeam && typeof ROLE.battleTeam.clear === 'function') {


                    ROLE.battleTeam.clear();


                }





                // 设置新的队伍配置


                Object.entries(battleTeam).forEach(([position, heroId]) => {


                    if (heroId && ROLE.battleTeam) {


                        const heroData = { heroId: heroId };


                        if (typeof ROLE.battleTeam.set === 'function') {


                            ROLE.battleTeam.set(parseInt(position), heroData);


                        } else {


                            ROLE.battleTeam[position] = heroData;


                        }


                    }


                });





                console.log('[英雄队伍增强] 战斗队伍已切换:', battleTeam);


            } catch (error) {


                console.error('[英雄队伍增强] 切换战斗队伍失败:', error);


                throw error;


            }


        }





        // 应用英雄配置


        applyHeroConfigs(heroConfigs, ROLE) {


            try {


                Object.entries(heroConfigs).forEach(([heroId, config]) => {


                    const hero = ROLE.heroes.get ? ROLE.heroes.get(parseInt(heroId)) : ROLE.heroes[heroId];


                    if (hero && config) {


                        // 应用神器


                        if (config.artifactId !== undefined) {


                            hero.artifactId = config.artifactId;


                        }





                        // 应用珍珠


                        if (config.pearlId !== undefined) {


                            hero.pearlId = config.pearlId;


                        }





                        // 应用附件


                        if (config.attachmentUid !== undefined) {


                            hero.attachmentUid = config.attachmentUid;


                        }





                        // 应用皮肤


                        if (config.useSkin !== undefined) {


                            hero.useSkin = config.useSkin;


                        }





                        // 应用水晶正反面


                        if (config.curTrump !== undefined) {


                            hero.curTrump = config.curTrump;


                        }





                        // 应用装备淬炼


                        if (config.equipment && hero.equipment) {


                            Object.entries(config.equipment).forEach(([slot, equipConfig]) => {


                                const equipment = hero.equipment.get ? hero.equipment.get(parseInt(slot)) : hero.equipment[slot];


                                if (equipment && equipConfig.curQuenchId !== undefined) {


                                    equipment.curQuenchId = equipConfig.curQuenchId;


                                }


                            });


                        }





                        // 应用鱼珠技能


                        if (config.appendSkill && Array.isArray(config.appendSkill)) {


                            // 清除现有的1033开头的技能


                            if (Array.isArray(hero.appendSkill)) {


                                hero.appendSkill = hero.appendSkill.filter(skill => 


                                    !skill || !skill.skillId || !String(skill.skillId).startsWith('1033')


                                );


                                


                                // 添加新的鱼珠技能


                                config.appendSkill.forEach(skillId => {


                                    hero.appendSkill.push({ skillId: skillId });


                                });


                            }


                        }


                    }


                });





                console.log('[英雄队伍增强] 英雄配置已应用');


            } catch (error) {


                console.error('[英雄队伍增强] 应用英雄配置失败:', error);


            }


        }





        // 应用俱乐部科技（仅记录，不实际修改）


        applyLegionResearch(legionResearch, ROLE) {


            try {


                // 俱乐部科技通常不能随意修改，这里仅作记录


                console.log('[英雄队伍增强] 俱乐部科技信息:', legionResearch);


                // 如果需要提醒用户科技差异，可以在这里添加逻辑


            } catch (error) {


                console.error('[英雄队伍增强] 处理俱乐部科技失败:', error);


            }


        }


        // 处理保存


        async handleSave() {


            const name = await this.showInputDialog('添加队伍', '', '请输入队伍名称');


            if (!name) return;





            try {


                // 获取当前阵容信息


                const formation = this.getCurrentFormation();


                if (!formation) {


                    this.showTip('获取阵容信息失败，请确保在英雄队伍界面', 'error');


                    return;


                }


                


                this.addTeam(name, formation);


                this.renderTeamList();


                this.showTip(`队伍"${name}"已保存`, 'success');


                console.log('[英雄队伍增强] 队伍已保存:', name, formation);


            } catch (error) {


                console.error('[英雄队伍增强] 保存队伍失败:', error);


                this.showTip('保存失败：' + error.message, 'error');


            }


        }





        // 获取当前阵容信息


        getCurrentFormation() {


            try {


                // 获取 ServerData 和 ROLE 对象


                const ServerData = unsafeWindow.__require('ServerData');


                if (!ServerData || !ServerData.ROLE) {


                    throw new Error('无法获取 ServerData 或 ROLE 对象');


                }





                const ROLE = ServerData.ROLE;





                // 构建阵容信息


                const formation = {


                    roleId: ROLE.roleId,


                    presetTeamId: ROLE.presetTeamId, // 添加当前阵容槽位ID


                    power: ROLE.power || 0, // 保存战力


                    lordWeaponId: ROLE.lordWeaponId || null,


                    battleTeam: this.extractBattleTeam(ROLE.battleTeam),


                    heroes: this.extractHeroesInfo(ROLE.battleTeam, ROLE.heroes),


                    legionResearch: this.extractLegionResearch(ROLE.legionResearch),


                    timestamp: Date.now()


                };





                console.log('[英雄队伍增强] 提取的阵容信息:', formation);


                return formation;


            } catch (error) {


                console.error('[英雄队伍增强] 获取阵容信息失败:', error);


                throw error;


            }


        }





        // 提取战斗队伍信息（位置和英雄ID）


        extractBattleTeam(battleTeam) {


            if (!battleTeam) return {};


            


            const teamData = {};


            try {


                // battleTeam 是 MobX Map，需要遍历


                if (typeof battleTeam.forEach === 'function') {


                    battleTeam.forEach((heroData, position) => {


                        if (heroData && heroData.heroId) {


                            teamData[position] = heroData.heroId;


                        }


                    });


                } else if (typeof battleTeam.entries === 'function') {


                    for (const [position, heroData] of battleTeam.entries()) {


                        if (heroData && heroData.heroId) {


                            teamData[position] = heroData.heroId;


                        }


                    }


                }


            } catch (error) {


                console.error('[英雄队伍增强] 提取战斗队伍失败:', error);


            }


            


            return teamData;


        }





        // 提取英雄详细信息


        extractHeroesInfo(battleTeam, heroes) {


            if (!battleTeam || !heroes) return {};


            


            const heroesInfo = {};


            try {


                // 获取战斗队伍中的英雄ID


                const heroIds = [];


                if (typeof battleTeam.forEach === 'function') {


                    battleTeam.forEach((heroData) => {


                        if (heroData && heroData.heroId) {


                            heroIds.push(heroData.heroId);


                        }


                    });


                } else if (typeof battleTeam.entries === 'function') {


                    for (const [, heroData] of battleTeam.entries()) {


                        if (heroData && heroData.heroId) {


                            heroIds.push(heroData.heroId);


                        }


                    }


                }





                // 提取每个英雄的详细信息


                heroIds.forEach(heroId => {


                    try {


                        const hero = heroes.get ? heroes.get(heroId) : heroes[heroId];


                        


                        if (hero) {


                            const extractedSkills = this.extractAppendSkills(hero.appendSkill);





                            // 一次性诊断：打印第一个英雄首件装备的所有 own keys，验证 equipId 字段


                            if (!HeroTeamEnhancer._equipFieldsDiaged) {


                                try {


                                    const eq = hero.equipment;


                                    let firstPiece = null;


                                    if (eq) {


                                        if (typeof eq.get === 'function') {


                                            firstPiece = eq.get(1) || eq.get('1') || eq.get(2) || eq.get('2');


                                        } else {


                                            firstPiece = eq[1] || eq['1'] || eq[2] || eq['2'];


                                        }


                                    }


                                    if (firstPiece) {


                                        // 列出装备对象所有可枚举字段（包括原型链），找出真正的装备实例 ID 字段名


                                        const allKeys = new Set();


                                        try {


                                            for (const k in firstPiece) allKeys.add(k);


                                            Object.getOwnPropertyNames(firstPiece).forEach(k => allKeys.add(k));


                                            const proto = Object.getPrototypeOf(firstPiece);


                                            if (proto) Object.getOwnPropertyNames(proto).forEach(k => { if (k !== 'constructor') allKeys.add(k); });


                                        } catch (e) {}


                                        const flat = {};


                                        allKeys.forEach(k => {


                                            try {


                                                const v = firstPiece[k];


                                                if (v !== undefined && typeof v !== 'function') {


                                                    flat[k] = (typeof v === 'object' && v !== null) ? '<obj>' : v;


                                                }


                                            } catch (e) {}


                                        });


                                        console.log(`[英雄队伍增强][equip-diag] hero=${heroId} slot1 allFields=`, JSON.stringify(flat));


                                    }


                                    HeroTeamEnhancer._equipFieldsDiaged = true;


                                } catch (e) {}


                            }





                            // 独立提取"显示用"鱼珠技能 ID：不受 1033 前缀限制，按能否解析中文名判定


                            const displayPearlSkillId = this.detectPearlSkillIdForDisplay(hero.appendSkill);





                            heroesInfo[heroId] = {


                                level: hero.level || 1,


                                order: hero.order || 0, // 添加阶数信息


                                artifactId: hero.artifactId || null,


                                pearlId: hero.pearlId || null,


                                attachmentUid: hero.attachmentUid || null,


                                // 装备指纹：用于无损换将时反查载体身份


                                equipmentFp: this.getEquipmentFingerprint(hero.equipment),


                                // 弹性指纹：忽略洗炼字段（quenches/quenchTimes/qAtk 等），只用 forge/level/star 等稳定字段


                                // 用于装备洗炼变更后仍能精确反查到对应武将


                                equipmentFpStable: this.getEquipmentFingerprint(hero.equipment, 'stable'),


                                useSkin: hero.useSkin || null,


                                curTrump: hero.curTrump || null,


                                equipment: this.extractEquipment(hero.equipment),


                                appendSkill: extractedSkills,


                                // 显示专用：供卡片渲染鱼珠技能名；不用于换装逻辑，不影响 appendSkill 语义


                                pearlSkillId: displayPearlSkillId || 0


                            };


                        }


                    } catch (error) {


                        console.error(`[英雄队伍增强] 提取英雄 ${heroId} 信息失败:`, error);


                    }


                });





            } catch (error) {


                console.error('[英雄队伍增强] 提取英雄信息失败:', error);


            }


            


            return heroesInfo;


        }





        // 提取装备信息：内存完整快照（不依赖赐福开关，直接读取所有可见装备字段）


        // 用于切换阵容时把保存时的装备状态完整写回当前英雄的装备对象（MobX observable 字段）


        extractEquipment(equipment) {


            if (!equipment) return {};





            // 装备字段白名单：游戏内存里 hero.equipment[slot] 的所有可见字段


            // 排除 MobX 内部字段（__mobx*, $mobx, __reactivedata__ 等）


            const SNAPSHOT_FIELDS = [


                'level', 'star', 'attack', 'defense', 'hp',


                'forge', 'forgeExp',


                'curQuenchId',


                'enchantUId', 'enchantUId2',


                'quenchTimes', 'quenchTimes2',


                'quenches', 'quenches2',


                'quenchAttackExt', 'quenchDefenseExt', 'quenchHpExt',


                'seed',


                'equipId', 'equipConfId',


            ];





            // 深拷贝 quenches 子对象（每条淬炼词条 {colorId, attrId, attrNum, isLocked}）


            const cloneQuenches = (q) => {


                if (!q || typeof q !== 'object') return undefined;


                const out = {};


                try {


                    const entries = (typeof q.forEach === 'function')


                        ? (() => { const arr = []; q.forEach((v, k) => arr.push([k, v])); return arr; })()


                        : Object.entries(q);


                    for (const [k, line] of entries) {


                        if (!line) continue;


                        out[k] = {


                            colorId: line.colorId != null ? Number(line.colorId) : 0,


                            attrId: line.attrId != null ? Number(line.attrId) : 0,


                            attrNum: line.attrNum != null ? Number(line.attrNum) : 0,


                            isLocked: !!line.isLocked,


                        };


                    }


                } catch (e) {}


                return Object.keys(out).length > 0 ? out : undefined;


            };





            const equipmentInfo = {};


            try {


                // 与 getEquipmentFingerprint 保持一致的 slot 访问方式：


                // MobX observable Map 的 forEach 回调返回的 item 在某些版本下字段 getter 不会触发，


                // 导致只有被显式 observe 的字段（如 curQuenchId）能读到，level/forge/star 等返回 undefined。


                // 解决方案：用 .get() 按槽位拿完整 observable 值。


                const getSlot = (slot) => {


                    try {


                        if (typeof equipment.get === 'function') {


                            return equipment.get(slot) || equipment.get(String(slot));


                        }


                        return equipment[slot] || equipment[String(slot)];


                    } catch (e) { return null; }


                };


                const processItem = (item, slot) => {


                    if (!item) return;


                    const info = {};


                    for (const f of SNAPSHOT_FIELDS) {


                        let v;


                        try { v = item[f]; } catch (e) { v = undefined; }


                        if (v === undefined) continue;


                        if (f === 'quenches' || f === 'quenches2') {


                            const cloned = cloneQuenches(v);


                            if (cloned) info[f] = cloned;


                        } else {


                            info[f] = v;


                        }


                    }


                    if (Object.keys(info).length > 0) {


                        equipmentInfo[slot] = info;


                    }


                };


                // 优先按槽位精确访问（确保所有字段能被 observable getter 正确触发）


                for (const slot of [1, 2, 3, 4]) {


                    const item = getSlot(slot);


                    if (item) processItem(item, slot);


                }


            } catch (error) {


                console.error('[英雄队伍增强] 提取装备信息失败:', error);


            }





            return equipmentInfo;


        }





        // 提取赐福映射（ROLE.enchantMap：uid -> oriQuenchId）


        // 用于切换阵容时与 saved 时的赐福状态对齐


        extractEnchantMap(enchantMap) {


            if (!enchantMap) return {};


            const result = {};


            try {


                if (typeof enchantMap.forEach === 'function') {


                    enchantMap.forEach((value, key) => {


                        result[key] = value;


                    });


                } else if (typeof enchantMap === 'object') {


                    Object.keys(enchantMap).forEach(key => {


                        result[key] = enchantMap[key];


                    });


                }


            } catch (error) {


                console.error('[英雄队伍增强] 提取赐福映射失败:', error);


            }


            return result;


        }





        // 从 hero.appendSkill 中识别鱼珠技能 ID（严格：只认 1033 前缀；仅用于显示缓存）


        detectPearlSkillIdForDisplay(appendSkill) {


            try {


                if (!Array.isArray(appendSkill)) return 0;


                // 先选 active:true + 1033 前缀


                for (const s of appendSkill) {


                    if (!s || !s.skillId) continue;


                    const active = (s.active === undefined) ? true : !!s.active;


                    if (!active) continue;


                    if (!String(s.skillId).startsWith('1033')) continue;


                    return parseInt(s.skillId) || 0;


                }


                // 再放宽到任意 1033 前缀


                for (const s of appendSkill) {


                    if (!s || !s.skillId) continue;


                    if (!String(s.skillId).startsWith('1033')) continue;


                    return parseInt(s.skillId) || 0;


                }


                return 0;


            } catch (_) { return 0; }


        }





        // 提取鱼珠技能（1033开头的skillId）- 只保存skillId


        extractAppendSkills(appendSkill) {


            if (!Array.isArray(appendSkill)) {


                return [];


            }


            


            try {


                return appendSkill


                    .filter(skill => skill && skill.skillId && String(skill.skillId).startsWith('1033'))


                    .map(skill => skill.skillId); // 只保存skillId


            } catch (error) {


                console.error('[英雄队伍增强] 提取鱼珠技能失败:', error);


                return [];


            }


        }





        // 提取俱乐部科技信息（保存所有科技，包括0级）


        extractLegionResearch(legionResearch) {


            if (!legionResearch) return {};


            


            const researchInfo = {};


            try {


                // 获取所有科技配置


                const ModuleManager = unsafeWindow.__require('ModuleManager');


                const Configs = unsafeWindow.__require('Configs');


                


                if (!ModuleManager || !Configs) {


                    console.warn('[英雄队伍增强] 无法获取ModuleManager或Configs，使用简化保存');


                    // 降级方案：只保存当前有等级的科技


                    if (typeof legionResearch.forEach === 'function') {


                        legionResearch.forEach((value, key) => {


                            researchInfo[key] = value;


                        });


                    } else if (typeof legionResearch.entries === 'function') {


                        for (const [key, value] of legionResearch.entries()) {


                            researchInfo[key] = value;


                        }


                    }


                    return researchInfo;


                }





                const LegionModule = ModuleManager.GET_MODULE(Configs.ModuleType.LEGION);


                if (!LegionModule || !LegionModule.WORK_BAR) {


                    console.warn('[英雄队伍增强] 无法获取LegionModule，使用简化保存');


                    // 降级方案


                    if (typeof legionResearch.forEach === 'function') {


                        legionResearch.forEach((value, key) => {


                            researchInfo[key] = value;


                        });


                    } else if (typeof legionResearch.entries === 'function') {


                        for (const [key, value] of legionResearch.entries()) {


                            researchInfo[key] = value;


                        }


                    }


                    return researchInfo;


                }





                // 遍历所有工作类型，保存所有科技（包括0级）


                for (const [workType, index] of LegionModule.WORK_BAR) {


                    // 普通科技


                    const normalResearchList = LegionModule.researchMap.get(workType);


                    if (normalResearchList && normalResearchList.length > 0) {


                        for (const research of normalResearchList) {


                            const level = legionResearch.get ? 


                                legionResearch.get(research.ID) || 0 : 


                                legionResearch[research.ID] || 0;


                            researchInfo[research.ID] = level;


                        }


                    }





                    // 高级科技


                    const highResearchList = LegionModule.researchHighMap.get(workType);


                    if (highResearchList && highResearchList.length > 0) {


                        for (const research of highResearchList) {


                            const level = legionResearch.get ? 


                                legionResearch.get(research.ID) || 0 : 


                                legionResearch[research.ID] || 0;


                            researchInfo[research.ID] = level;


                        }


                    }


                }





                console.log(`[英雄队伍增强] 保存了 ${Object.keys(researchInfo).length} 个科技配置`);


            } catch (error) {


                console.error('[英雄队伍增强] 提取俱乐部科技失败:', error);


            }


            


            return researchInfo;


        }





        // 格式化战力显示（转换为亿为单位，保留两位小数）


        formatPower(power) {


            if (!power || power === 0) return '';


            const powerInYi = power / 100000000; // 转换为亿


            return `·${powerInYi.toFixed(2)}亿`;


        }





        renderTeamList(searchText = '') {


            const listContainer = document.getElementById('hero-team-list');


            if (!listContainer) return;





            let teams = this.loadTeams();


            


            // 获取当前角色ID进行过滤


            const ServerData = unsafeWindow.__require('ServerData');


            const currentRoleId = ServerData?.ROLE?.roleId;


            


            // 角色隔离：只显示当前角色的队伍


            if (currentRoleId) {


                teams = teams.filter(team => team.formation?.roleId === currentRoleId);


            }


            


            // 搜索过滤


            if (searchText) {


                teams = teams.filter(t => t.name.includes(searchText));


            }





            if (teams.length === 0) {


                listContainer.innerHTML = '<div class="hero-team-empty">暂无保存的队伍</div>';


                return;


            }





            listContainer.innerHTML = teams.map(team => {


                // 获取英雄展示数据（立绘 + 等级 + 鱼灵 + 鱼珠）


                const displayList = this.getHeroDisplayListFromFormation(team.formation);


                const heroImgs = displayList.length > 0


                    ? `<div class="hero-team-heroes-list">${displayList.map(d => {


                        const lv = d.level > 0


                            ? `<div class="hero-lv-text" title="等级 ${d.level}">Lv${d.level}</div>`


                            : `<div class="hero-lv-text" style="color:rgba(0,0,0,0.25);">-</div>`;


                        const art = d.artifactId > 0


                            ? `<img class="hero-artifact-icon" data-artifact-id="${d.artifactId}" src="" alt="" title="鱼灵 #${d.artifactId}">`


                            : '';


                        // 鱼珠名：仅显示真实技能名（pearlSkillName 来自 appendSkill 1033xxx 解析）


                        // 没有解析到 → 显示空占位，避免把 pearlId（可能是品质 1-6）误显示成 "#6"


                        let pearlColor = d.pearlSkillId > 0 ? this.resolvePearlColor(d.pearlSkillId) : (d.pearlId > 0 ? this.resolvePearlColor(d.pearlId) : '');


                        if (pearlColor === '#ffffff') pearlColor = '#6b7280';


                        const pearlSpan = d.pearlSkillName


                            ? `<span class="hero-pearl-name" style="color:${pearlColor || '#666'};" title="鱼珠技能 ${d.pearlSkillName} (skill #${d.pearlSkillId})">${d.pearlSkillName}</span>`


                            : `<span class="hero-pearl-name" style="color:rgba(0,0,0,0.2);" title="无鱼珠技能">-</span>`;


                        return `<div class="hero-fullbody-col" title="${this.getHeroName(d.heroId)}(${d.heroId})">


                            <div class="hero-fullbody-wrap">


                                <img class="hero-fullbody-img" data-hero-id="${d.skinId}" src="" alt="">


                            </div>


                            ${lv}


                            <div class="hero-art-pearl-row">${art}${pearlSpan}</div>


                        </div>`;


                    }).join('')}</div>`


                    : '<span style="color:rgba(60,60,67,0.6);font-size:10px;flex:1;">暂无阵容信息</span>';





                // 主公武器图标（右侧固定区块）


                const weaponId = team.formation?.lordWeaponId;


                const weaponBox = weaponId


                    ? `<div class="hero-team-weapon-box" title="主公武器 #${weaponId}"><img class="hero-team-weapon-img" data-weapon-id="${weaponId}" src="" alt=""></div>`


                    : `<div class="hero-team-weapon-box" title="未配置主公武器"><div class="hero-team-weapon-empty">无<br/>武器</div></div>`;


                


                // 格式化战力显示


                const powerText = this.formatPower(team.formation?.power);


                            


                return `


                <div class="hero-team-item" data-id="${team.id}" data-slot="${team.formation?.presetTeamId || ''}">


                    <div class="hero-team-item-wrapper">


                        <div class="hero-team-item-content">


                            <div class="hero-team-item-header">


                                <div class="hero-team-item-name">${team.name}${powerText}</div>


                                <div class="hero-team-item-meta">


                                    <span class="hero-team-item-slot">槽${team.formation?.presetTeamId || '?'}</span>


                                    <span class="hero-team-item-date">${new Date(team.createDate).toLocaleDateString()}</span>


                                    <button class="hero-team-use-btn" data-action="use">


                                        <svg viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg"><path d="M695.168 55.168a42.666667 42.666667 0 0 0 0 60.330667L835.669333 256l-140.501333 140.501333a42.666667 42.666667 0 0 0 0 60.330667 42.666667 42.666667 0 0 0 60.330667 0l170.666666-170.666667a42.666667 42.666667 0 0 0 0-60.330666l-170.666666-170.666667a42.666667 42.666667 0 0 0-60.330667 0z"></path><path d="M298.666667 213.333333c-117.333333 0-213.333333 96-213.333334 213.333334v42.666666a42.666667 42.666667 0 0 0 42.666667 42.666667 42.666667 42.666667 0 0 0 42.666667-42.666667v-42.666666c0-71.210667 56.789333-128 128-128h597.333333a42.666667 42.666667 0 0 0 42.666667-42.666667 42.666667 42.666667 0 0 0-42.666667-42.666667zM298.666667 554.666667a42.666667 42.666667 0 0 0-30.165334 12.501333l-170.666666 170.666667a42.666667 42.666667 0 0 0 0 60.330666l170.666666 170.666667a42.666667 42.666667 0 0 0 60.330667 0 42.666667 42.666667 0 0 0 0-60.330667L188.330667 768l140.501333-140.501333a42.666667 42.666667 0 0 0 0-60.330667A42.666667 42.666667 0 0 0 298.666667 554.666667z"></path><path d="M896 512a42.666667 42.666667 0 0 0-42.666667 42.666667v42.666666c0 71.210667-56.789333 128-128 128H128a42.666667 42.666667 0 0 0-42.666667 42.666667 42.666667 42.666667 0 0 0 42.666667 42.666667h597.333333c117.333333 0 213.333333-96 213.333334-213.333334v-42.666666a42.666667 42.666667 0 0 0-42.666667-42.666667z"></path></svg>


                                        <span>切换</span>


                                    </button>


                                </div>


                            </div>


                            <div class="hero-team-item-heroes">${heroImgs}${weaponBox}</div>


                        </div>


                        <div class="hero-team-item-actions-bg">


                            <button class="hero-team-swipe-btn hero-team-swipe-btn-edit" data-action="edit">


                                <svg viewBox="0 0 1024 1024" fill="white">


                                    <path d="M853.333333 501.333333c-17.066667 0-32 14.933333-32 32v320c0 6.4-4.266667 10.666667-10.666666 10.666667H170.666667c-6.4 0-10.666667-4.266667-10.666667-10.666667V213.333333c0-6.4 4.266667-10.666667 10.666667-10.666666h320c17.066667 0 32-14.933333 32-32s-14.933333-32-32-32H170.666667c-40.533333 0-74.666667 34.133333-74.666667 74.666666v640c0 40.533333 34.133333 74.666667 74.666667 74.666667h640c40.533333 0 74.666667-34.133333 74.666666-74.666667V533.333333c0-17.066667-14.933333-32-32-32z"/><path d="M405.333333 484.266667l-32 125.866666c-2.133333 10.666667 0 23.466667 8.533334 29.866667 6.4 6.4 14.933333 8.533333 23.466666 8.533333h8.533334l125.866666-32c6.4-2.133333 10.666667-4.266667 14.933334-8.533333l300.8-300.8c38.4-38.4 38.4-102.4 0-140.8-38.4-38.4-102.4-38.4-140.8 0L413.866667 469.333333c-4.266667 4.266667-6.4 8.533333-8.533334 14.933334z m59.733334 23.466666L761.6 213.333333c12.8-12.8 36.266667-12.8 49.066667 0 12.8 12.8 12.8 36.266667 0 49.066667L516.266667 558.933333l-66.133334 17.066667 14.933334-68.266667z"></path>


                                </svg>


                                <span>编辑</span>


                            </button>


                            <button class="hero-team-swipe-btn hero-team-swipe-btn-delete" data-action="delete">


                                <svg viewBox="0 0 1024 1024" fill="white">


                                    <path d="M874.666667 241.066667h-202.666667V170.666667c0-40.533333-34.133333-74.666667-74.666667-74.666667h-170.666666c-40.533333 0-74.666667 34.133333-74.666667 74.666667v70.4H149.333333c-17.066667 0-32 14.933333-32 32s14.933333 32 32 32h53.333334V853.333333c0 40.533333 34.133333 74.666667 74.666666 74.666667h469.333334c40.533333 0 74.666667-34.133333 74.666666-74.666667V305.066667H874.666667c17.066667 0 32-14.933333 32-32s-14.933333-32-32-32zM416 170.666667c0-6.4 4.266667-10.666667 10.666667-10.666667h170.666666c6.4 0 10.666667 4.266667 10.666667 10.666667v70.4h-192V170.666667z m341.333333 682.666666c0 6.4-4.266667 10.666667-10.666666 10.666667H277.333333c-6.4 0-10.666667-4.266667-10.666666-10.666667V309.333333h490.666666V853.333333z"/><path d="M426.666667 736c17.066667 0 32-14.933333 32-32V490.666667c0-17.066667-14.933333-32-32-32s-32 14.933333-32 32v213.333333c0 17.066667 14.933333 32 32 32zM597.333333 736c17.066667 0 32-14.933333 32-32V490.666667c0-17.066667-14.933333-32-32-32s-32 14.933333-32 32v213.333333c0 17.066667 14.933333 32 32 32z"></path>


                                </svg>


                                <span>删除</span>


                            </button>


                        </div>


                    </div>


                </div>


            `}).join('');





            // 绑定列表项按钮事件和右滑手势


            listContainer.querySelectorAll('.hero-team-item').forEach(item => {


                const id = parseInt(item.dataset.id);


                


                // 绑定使用按钮事件


                const useBtn = item.querySelector('.hero-team-use-btn');


                useBtn.addEventListener('click', (e) => {


                    e.stopPropagation();


                    this.handleTeamAction('use', id);


                });


                


                // 绑定右滑按钮事件


                const editBtn = item.querySelector('.hero-team-swipe-btn-edit');


                const deleteBtn = item.querySelector('.hero-team-swipe-btn-delete');


                


                editBtn.addEventListener('click', (e) => {


                    e.stopPropagation();


                    // 滑动回原位


                    const wrapper = item.querySelector('.hero-team-item-wrapper');


                    wrapper.style.transform = 'translateX(0px)';


                    item.classList.remove('swiped');


                    this.handleTeamAction('edit', id);


                });


                


                deleteBtn.addEventListener('click', (e) => {


                    e.stopPropagation();


                    // 滑动回原位


                    const wrapper = item.querySelector('.hero-team-item-wrapper');


                    wrapper.style.transform = 'translateX(0px)';


                    item.classList.remove('swiped');


                    this.handleTeamAction('delete', id);


                });





                // 添加右滑手势支持


                this.bindSwipeGesture(item);


            });


            


            // 全局点击事件：点击其他地方关闭所有滑动状态


            setTimeout(() => {


                const globalClickHandler = (e) => {


                    const heroTeamItems = document.querySelectorAll('.hero-team-item');


                    heroTeamItems.forEach(item => {


                        if (!item.contains(e.target)) {


                            // 滑动回原位


                            const wrapper = item.querySelector('.hero-team-item-wrapper');


                            if (wrapper) {


                                wrapper.style.transform = 'translateX(0px)';


                            }


                            item.classList.remove('swiped');


                        }


                    });


                };


                


                // 移除旧的监听器（如果存在）


                if (this.globalClickHandler) {


                    document.removeEventListener('click', this.globalClickHandler);


                }


                


                // 添加新的监听器


                this.globalClickHandler = globalClickHandler;


                document.addEventListener('click', globalClickHandler);


            }, 100);


            


            // 异步加载英雄全身立绘


            listContainer.querySelectorAll('.hero-fullbody-img').forEach(async (img) => {


                const heroId = img.dataset.heroId;


                if (!heroId) return;


                let url = this.loadHeroFullBodyUrl(parseInt(heroId));


                if (!url) {


                    // 兜底：全身图未命中 → 退回小头像


                    try { url = await this.loadHeroIconUrl(parseInt(heroId)); } catch (_) {}


                }


                if (url) img.src = url;


            });


            // 加载主公武器图标


            listContainer.querySelectorAll('.hero-team-weapon-img').forEach(img => {


                const wid = img.dataset.weaponId;


                if (!wid) return;


                const url = this.loadLordWeaponIconUrl(parseInt(wid));


                if (url) img.src = url;


            });


            // 加载鱼灵图标


            listContainer.querySelectorAll('.hero-artifact-icon').forEach(img => {


                const aid = img.dataset.artifactId;


                if (!aid) return;


                const url = this.loadArtifactIconUrl(parseInt(aid));


                if (url) img.src = url;


                else img.style.display = 'none'; // 找不到图标就隐藏，避免空框


            });


            // 兼容旧卡片（若还有 .hero-icon-img）


            listContainer.querySelectorAll('.hero-icon-img').forEach(async (img) => {


                const heroId = img.dataset.heroId;


                if (heroId) {


                    const url = await this.loadHeroIconUrl(parseInt(heroId));


                    if (url) img.src = url;


                }


            });


        }


        // 绑定右滑手势


                bindSwipeGesture(item) {


            let startX = 0;


            let startY = 0;


            let startTime = 0;


            let isSwipeStarted = false;


            let currentTranslateX = 0;





            const wrapper = item.querySelector('.hero-team-item-wrapper');





            const handleSwipeStart = (clientX, clientY) => {


                startX = clientX;


                startY = clientY;


                startTime = Date.now();


                isSwipeStarted = true;


                


                // 获取当前的translateX值


                const currentTransform = wrapper.style.transform;


                const match = currentTransform.match(/translateX\((-?\d+)px\)/);


                currentTranslateX = match ? parseInt(match[1]) : 0;


                


                // 移除过渡效果，让滑动更跟手


                wrapper.style.transition = 'none';


            };





            const handleSwipeMove = (clientX, clientY) => {


                if (!isSwipeStarted) return;





                const diffX = startX - clientX;


                const diffY = Math.abs(startY - clientY);





                // 如果垂直滑动距离太大，取消水平滑动


                if (diffY > 50) {


                    isSwipeStarted = false;


                    wrapper.style.transition = '';


                    return;


                }





                // 计算新的translateX值


                let newTranslateX = currentTranslateX - diffX;


                


                // 限制滑动范围：0 到 -140px


                newTranslateX = Math.max(-140, Math.min(0, newTranslateX));


                


                // 实时更新滑动效果


                wrapper.style.transform = `translateX(${newTranslateX}px)`;


            };





            const handleSwipeEnd = (clientX, clientY) => {


                if (!isSwipeStarted) return;





                const diffX = startX - clientX;


                const diffY = Math.abs(startY - clientY);


                const diffTime = Date.now() - startTime;


                const velocity = Math.abs(diffX) / diffTime;





                isSwipeStarted = false;


                


                // 恢复过渡效果


                wrapper.style.transition = 'transform 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)';





                // 判断是否触发滑动：距离超过阈值或快速滑动


                const threshold = 70;


                const minDiff = 30;





                if (diffY > 50) {


                    // 垂直滑动，恢复原位


                    wrapper.style.transform = 'translateX(0px)';


                    item.classList.remove('swiped');


                    return;


                }





                // 根据滑动距离和速度决定最终状态


                if (diffX > threshold || (diffX > minDiff && velocity > 0.8)) {


                    // 滑动到显示按钮状态


                    wrapper.style.transform = 'translateX(-140px)';


                    item.classList.add('swiped');


                } else if (diffX < -30 || (diffX < -minDiff && velocity > 0.8)) {


                    // 滑动回原位


                    wrapper.style.transform = 'translateX(0px)';


                    item.classList.remove('swiped');


                } else {


                    // 根据当前位置决定最终状态


                    const currentTransform = wrapper.style.transform;


                    const match = currentTransform.match(/translateX\((-?\d+)px\)/);


                    const currentX = match ? parseInt(match[1]) : 0;


                    


                    if (currentX < -70) {


                        // 超过一半，滑动到显示按钮状态


                        wrapper.style.transform = 'translateX(-140px)';


                        item.classList.add('swiped');


                    } else {


                        // 不到一半，滑动回原位


                        wrapper.style.transform = 'translateX(0px)';


                        item.classList.remove('swiped');


                    }


                }


            };





            // 获取内容区域，避免在按钮上触发滑动


            const itemContent = item.querySelector('.hero-team-item-content');





            // 鼠标事件（桌面端）


            itemContent.addEventListener('mousedown', (e) => {


                // 如果点击的是按钮，不处理滑动


                if (e.target.closest('button')) return;





                e.preventDefault();


                handleSwipeStart(e.clientX, e.clientY);





                const moveHandler = (e) => {


                    e.preventDefault();


                    handleSwipeMove(e.clientX, e.clientY);


                };





                const upHandler = (e) => {


                    handleSwipeEnd(e.clientX, e.clientY);


                    document.removeEventListener('mousemove', moveHandler);


                    document.removeEventListener('mouseup', upHandler);


                };





                document.addEventListener('mousemove', moveHandler);


                document.addEventListener('mouseup', upHandler);


            });





            // 触摸事件（移动端）


            itemContent.addEventListener('touchstart', (e) => {


                // 如果点击的是按钮，不处理滑动


                if (e.target.closest('button')) return;





                const touch = e.touches[0];


                handleSwipeStart(touch.clientX, touch.clientY);


            }, {passive: true});





            itemContent.addEventListener('touchmove', (e) => {


                if (!isSwipeStarted) return;


                e.preventDefault();


                const touch = e.touches[0];


                handleSwipeMove(touch.clientX, touch.clientY);


            }, {passive: false});





            itemContent.addEventListener('touchend', (e) => {


                if (!isSwipeStarted) return;


                e.preventDefault();


                const touch = e.changedTouches[0];


                handleSwipeEnd(touch.clientX, touch.clientY);


            }, {passive: false});


        }








    /**


     * 获取英雄名称


     * @param {number} heroId - 英雄ID


     * @returns {string} 英雄名称，失败时返回英雄ID


     */


    getHeroName(heroId) {


        try {


            const Configs = unsafeWindow.__require('Configs');


            if (!Configs) {


                console.warn('[英雄队伍增强] Configs模块不存在');


                return `英雄${heroId}`;


            }


            


            if (!Configs.HeroConf || typeof Configs.HeroConf.getById !== 'function') {


                console.warn('[英雄队伍增强] HeroConf.getById方法不存在');


                return `英雄${heroId}`;


            }


            


            const heroConfig = Configs.HeroConf.getById(parseInt(heroId));


            if (!heroConfig || !heroConfig.nickName) {


                console.warn('[英雄队伍增强] 未找到英雄配置或昵称, heroId:', heroId);


                return `英雄${heroId}`;


            }


            


            // 新武将nickName直接是中文，直接返回


            if (/[\u4e00-\u9fa5]/.test(heroConfig.nickName)) {


                return heroConfig.nickName;


            }


            


            if (!Configs.LanguageConf || typeof Configs.LanguageConf.getByKey !== 'function') {


                console.warn('[英雄队伍增强] LanguageConf.getByKey方法不存在');


                return `英雄${heroId}`;


            }


            


            const textObj = Configs.LanguageConf.getByKey(heroConfig.nickName);


            if (!textObj) {


                console.warn('[英雄队伍增强] 未找到语言文本, key:', heroConfig.nickName);


                return `英雄${heroId}`;


            }


            


            // 返回中文名称


            if (textObj.chinese) {


                return textObj.chinese;


            }


            


            // 如果没有chinese属性，尝试直接返回


            if (typeof textObj === 'string') {


                return textObj;


            }


            


            console.warn('[英雄队伍增强] 语言对象中没有chinese属性, key:', heroConfig.nickName, 'textObj:', textObj);


            return `英雄${heroId}`;


        } catch (error) {


            console.error('[英雄队伍增强] 获取英雄名称失败, heroId:', heroId, 'error:', error);


            return `英雄${heroId}`;


        }


    }





        // 加载英雄头像URL


        async loadHeroIconUrl(heroId) {


            if (!heroId) return '';


            try {


                const Configs = unsafeWindow.__require('Configs');


                const avatarConf = Configs.AvatarConf.getById(heroId);


                const iconPath = avatarConf?.smallHeadIcon;


                if (!iconPath) return '';


                


                const iconsBundle = unsafeWindow.cc.assetManager.bundles.get('icons');


                if (!iconsBundle) return '';


                


                return new Promise((resolve) => {


                    iconsBundle.load(iconPath, unsafeWindow.cc.Texture2D, (err, texture) => {


                        if (err || !texture) { resolve(''); return; }


                        let url = texture.nativeUrl || texture.url || texture._nativeUrl || '';


                        if (url.startsWith('assets/')) {


                            url = 'https://xxz-xyzw-res.hortorgames.com/remote/' + url.substring(7);


                        }


                        resolve(url);


                    });


                });


            } catch (e) { return ''; }


        }





        // ── 通用资源路径 → URL 解析


        // 遍历 cc.assetManager.bundles 查 assetPath → 命中 bundle._config.paths._map → 含 nativeVer 的 entry


        // URL: https://xxz-xyzw-res.hortorgames.com/remote/<bundleName>/native/<uuid前2>/<uuid>.<nativeVer>.png


        _resolveAssetUrl(assetPath) {


            if (!assetPath || typeof assetPath !== 'string') return '';


            this._assetUrlCache = this._assetUrlCache || {};


            if (this._assetUrlCache[assetPath]) return this._assetUrlCache[assetPath];


            try {


                const cc = unsafeWindow.cc;


                const am = cc && (cc.assetManager || (cc.AssetManager && cc.AssetManager.instance));


                const bundles = am && am.bundles;


                if (!bundles) return '';


                let hitName = '', hitEntry = null;


                const pick = (name, bundle) => {


                    try {


                        const cfg = bundle && (bundle._config || bundle.config);


                        const map = cfg && cfg.paths && cfg.paths._map;


                        if (!map) return false;


                        const entries = (typeof map.get === 'function') ? map.get(assetPath) : map[assetPath];


                        if (!entries || !entries.length) return false;


                        for (const e of entries) {


                            if (e && e.nativeVer && e.uuid) { hitName = name; hitEntry = e; return true; }


                        }


                    } catch (_) {}


                    return false;


                };


                if (typeof bundles.forEach === 'function') {


                    let stop = false;


                    bundles.forEach((b, name) => { if (!stop && pick(name, b)) stop = true; });


                } else {


                    for (const name in bundles) { if (pick(name, bundles[name])) break; }


                }


                if (!hitEntry) return '';


                const uuid = hitEntry.uuid;


                const url = `https://xxz-xyzw-res.hortorgames.com/remote/${hitName}/native/${uuid.slice(0, 2)}/${uuid}.${hitEntry.nativeVer}.png`;


                this._assetUrlCache[assetPath] = url;


                return url;


            } catch (_) { return ''; }


        }





        // 加载武将全身立绘 URL（fullBodyIcon → bundle URL；回退 head/path）


        loadHeroFullBodyUrl(skinOrHeroId) {


            try {


                const sid = parseInt(skinOrHeroId);


                if (!sid) return '';


                const Configs = unsafeWindow.__require('Configs');


                const AC = Configs && Configs.AvatarConf;


                if (!AC) return '';


                const conf = (typeof AC.getById === 'function') ? AC.getById(sid) : AC[String(sid)];


                if (!conf) return '';


                // 优先 fullBodyIcon → 回退 headIcon → 回退 path 拼 bodies/heroes/<path>


                let url = conf.fullBodyIcon ? this._resolveAssetUrl(conf.fullBodyIcon) : '';


                if (!url && conf.headIcon) url = this._resolveAssetUrl(conf.headIcon);


                if (!url && conf.path) url = this._resolveAssetUrl('bodies/heroes/' + conf.path);


                return url || '';


            } catch (_) { return ''; }


        }





        // 加载鱼灵图标 URL（ArtifactConf → starItem → ItemConf.icon）


        loadArtifactIconUrl(artifactId) {


            try {


                const aid = parseInt(artifactId);


                if (!aid) return '';


                const Configs = unsafeWindow.__require('Configs');


                if (!Configs) return '';


                const AC = Configs.ArtifactConf;


                const IC = Configs.ItemConf;


                // 1) ArtifactConf 精确命中 → starItem → ItemConf.icon


                let conf = null;


                if (AC) {


                    if (typeof AC.getById === 'function') conf = AC.getById(aid);


                    else conf = AC[String(aid)];


                    // 兜底：按前 4 位再查


                    if (!conf && String(aid).length >= 4) {


                        const k4 = parseInt(String(aid).slice(0, 4));


                        conf = (typeof AC.getById === 'function') ? AC.getById(k4) : AC[String(k4)];


                    }


                }


                const starItem = conf && (conf.starItem || conf.itemId || conf.id);


                const tryIds = [];


                if (starItem) tryIds.push(starItem);


                tryIds.push(aid);


                if (IC) {


                    for (const id of tryIds) {


                        const ic = (typeof IC.getById === 'function') ? IC.getById(id) : IC[String(id)];


                        const p = ic && (ic.icon || ic.smallIcon || ic.iconSmall || ic.iconPath);


                        if (p) {


                            const url = this._resolveAssetUrl(p);


                            if (url) return url;


                        }


                    }


                }


                // 2) ArtifactConf 自身带 icon


                const selfIcon = conf && (conf.icon || conf.smallIcon);


                if (selfIcon) {


                    const url = this._resolveAssetUrl(selfIcon);


                    if (url) return url;


                }


                return '';


            } catch (_) { return ''; }


        }





        // 鱼珠技能名（通过 skillId → SkillSchemeConf.skillName，兜底 SkillConf）


        // 仅在成功解析到中文名时缓存；解析失败不缓存，避免 Configs 未就绪时首次失败被永久记忆


        loadPearlSkillName(skillId) {


            try {


                const sid = parseInt(skillId);


                if (!sid) return '';


                this._pearlSkillNameCache = this._pearlSkillNameCache || {};


                if (this._pearlSkillNameCache[sid]) return this._pearlSkillNameCache[sid];


                const Configs = (typeof unsafeWindow !== 'undefined' && unsafeWindow.__require)


                    ? unsafeWindow.__require('Configs')


                    : (typeof window !== 'undefined' && window.__require ? window.__require('Configs') : null);


                if (!Configs) return '';


                // 1) SkillSchemeConf[id].skillName（中文名）


                const SS = Configs.SkillSchemeConf;


                let entry = null;


                if (SS) entry = (typeof SS.getById === 'function') ? SS.getById(sid) : SS[String(sid)];


                let name = entry && entry.skillName;


                if (name && !/[\u4e00-\u9fff]/.test(name)) name = '';


                // 2) 兜底：SkillConf


                if (!name && Configs.SkillConf) {


                    const SC = Configs.SkillConf;


                    const sc = (typeof SC.getById === 'function') ? SC.getById(sid) : SC[String(sid)];


                    name = sc && (sc.skillName || sc.name || sc.title) || '';


                    if (name && typeof name === 'string' && name.includes('_')) {


                        const LC = Configs.LanguageConf;


                        if (LC) {


                            const t = (typeof LC.getById === 'function') ? LC.getById(name) : LC[name];


                            if (t && typeof t === 'string') name = t;


                            else if (t && t.text) name = t.text;


                        }


                    }


                    if (name && !/[\u4e00-\u9fff]/.test(name)) name = '';


                }


                // 只在成功拿到中文名时缓存；失败不写缓存，下次会重试


                if (name) this._pearlSkillNameCache[sid] = name;


                return name || '';


            } catch (_) { return ''; }


        }





        // 鱼珠品质名（1白 2绿 3蓝 4紫 5橙 6红）


        resolvePearlQualityName(pearlId) {


            try {


                const pid = parseInt(pearlId);


                if (!pid) return '';


                const names = { 1: '白', 2: '绿', 3: '蓝', 4: '紫', 5: '橙', 6: '红', 0: '红' };


                const k = pid % 10;


                if (names[k]) return names[k];


                const first = parseInt(String(pid).charAt(0));


                return names[first] || '未知';


            } catch (_) { return ''; }


        }





        // 鱼珠颜色（按 pearlId 末位或指定位；映射参考星驰 pearlColorMap）


        resolvePearlColor(pearlId) {


            try {


                const pid = parseInt(pearlId);


                if (!pid) return '';


                // 末位取色（1-6），0 映射到 6


                const k = pid % 10;


                const map = { 1: '#ffffff', 2: '#22c55e', 3: '#3b82f6', 4: '#a855f7', 5: '#f97316', 6: '#ef4444', 0: '#ef4444' };


                // 若末位 >6，则用首位兜底


                if (k >= 0 && k <= 6 && map[k]) return map[k];


                const first = parseInt(String(pid).charAt(0));


                return map[first] || '#9ca3af';


            } catch (_) { return '#9ca3af'; }


        }





        // 加载主公武器图标 URL（WeaponConf[id].icon / smallIcon / bigIcon）


        loadLordWeaponIconUrl(weaponId) {


            try {


                const wid = parseInt(weaponId);


                if (!wid) return '';


                const Configs = unsafeWindow.__require('Configs');


                const WC = Configs && (Configs.WeaponConf || Configs.LordWeaponConf);


                if (!WC) return '';


                const conf = (typeof WC.getById === 'function') ? WC.getById(wid) : WC[String(wid)];


                if (!conf) return '';


                const candidates = [conf.icon, conf.smallIcon, conf.bigIcon];


                for (const p of candidates) {


                    if (!p) continue;


                    const url = this._resolveAssetUrl(p);


                    if (url) return url;


                }


                return '';


            } catch (_) { return ''; }


        }





        // 从阵容提取英雄展示数据列表（heroId/skinId/level/artifactId/pearlId）


        // 用于卡片渲染：立绘 + 等级 + 鱼灵 + 鱼珠


        getHeroDisplayListFromFormation(formation) {


            if (!formation || !formation.battleTeam) return [];


            try {


                const heroIds = Object.values(formation.battleTeam).filter(id => id);


                return heroIds.map(heroId => {


                    const cfg = formation.heroes?.[heroId] || {};


                    let skinId = cfg.useSkin;


                    if (skinId === -1 || skinId === '-1' || !skinId) skinId = heroId;


                    // 鱼珠技能：优先新字段 pearlSkillId；旧数据回退 appendSkill 中 1033 前缀


                    let pearlSkillId = parseInt(cfg.pearlSkillId) || 0;


                    if (!pearlSkillId && Array.isArray(cfg.appendSkill)) {


                        for (const s of cfg.appendSkill) {


                            if (s && String(s).startsWith('1033')) { pearlSkillId = parseInt(s); break; }


                        }


                    }


                    return {


                        heroId: parseInt(heroId),


                        skinId: parseInt(skinId),


                        level: parseInt(cfg.level) || 0,


                        artifactId: parseInt(cfg.artifactId) || 0,


                        pearlId: parseInt(cfg.pearlId) || 0,


                        pearlSkillId,


                        pearlSkillName: pearlSkillId ? this.loadPearlSkillName(pearlSkillId) : '',


                    };


                });


            } catch (e) {


                console.error('[英雄队伍增强] 组装英雄展示列表失败:', e);


                return [];


            }


        }





        // 从阵容信息中提取英雄皮肤ID列表（优先使用皮肤ID）


        getHeroSkinIdsFromFormation(formation) {


            if (!formation || !formation.battleTeam) return [];


            


            try {


                const heroIds = Object.values(formation.battleTeam).filter(id => id);


                return heroIds.map(heroId => {


                    // 优先使用皮肤ID，如果是-1或不存在则使用英雄ID


                    let skinId = formation.heroes?.[heroId]?.useSkin;


                    if (skinId === -1 || skinId === '-1' || !skinId) {


                        skinId = heroId;


                    }


                    return skinId;


                });


            } catch (error) {


                console.error('[英雄队伍增强] 提取皮肤ID失败:', error);


                return [];


            }


        }





        // 处理编辑


        async handleEdit(team) {


            const newName = await this.showInputDialog('修改队伍名称', team.name, '请输入新的队伍名称');


            if (newName && newName !== team.name) {


                this.updateTeam(team.id, { name: newName });


                this.renderTeamList();


                this.showTip(`队伍名称已修改为"${newName}"`, 'success');


            }


        }





        // 处理导出


        /**


         * 导出队伍数据 - 适配桌面端、iOS和Android


         */


        async handleExport() {


            try {


                const teams = this.loadTeams();


                const dataStr = JSON.stringify(teams, null, 2);


                const fileName = `hero_teams_${new Date().toISOString().slice(0, 10)}.json`;


                


                // 检测设备类型


                const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);


                const isAndroid = /Android/i.test(navigator.userAgent);


                const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);


                


                console.log('[英雄队伍增强] 开始导出数据，设备类型:', { isIOS, isAndroid, isMobile });


                


                // 方案1：桌面端使用传统下载方式


                if (!isMobile) {


                    try {


                        const blob = new Blob([dataStr], { type: 'application/json;charset=utf-8' });


                        const url = URL.createObjectURL(blob);


                        const a = document.createElement('a');


                        a.href = url;


                        a.download = fileName;


                        a.style.display = 'none';


                        


                        document.body.appendChild(a);


                        a.click();


                        document.body.removeChild(a);


                        URL.revokeObjectURL(url);


                        


                        this.showTip('数据已下载', 'success');


                        console.log('[英雄队伍增强] 桌面端使用下载方式导出成功');


                        return;


                    } catch (downloadError) {


                        console.error('[英雄队伍增强] 桌面端下载失败:', downloadError);


                        this.showTip('导出失败: ' + downloadError.message, 'error');


                        return;


                    }


                }


                


                // 方案2：iOS使用原生分享API


                if (isIOS) {


                    try {


                        const file = new File([dataStr], fileName, { type: 'application/json' });


                        


                        await navigator.share({


                            title: '英雄队伍配置',


                            text: '导出的英雄队伍配置数据',


                            files: [file]


                        });


                        


                        this.showTip('数据已通过分享导出', 'success');


                        console.log('[英雄队伍增强] iOS使用原生分享API导出成功');


                        return;


                    } catch (shareError) {


                        console.error('[英雄队伍增强] iOS分享失败:', shareError);


                        this.showTip('导出失败: ' + shareError.message, 'error');


                        return;


                    }


                }


                


                // 方案3：Android - 优先分享，失败则下载


                if (isAndroid) {


                    // 3.1 尝试使用分享API


                    if (navigator.share) {


                        try {


                            const file = new File([dataStr], fileName, { type: 'application/json' });


                            


                            await navigator.share({


                                title: '英雄队伍配置',


                                text: '导出的英雄队伍配置数据',


                                files: [file]


                            });


                            


                            this.showTip('数据已通过分享导出', 'success');


                            console.log('[英雄队伍增强] Android使用分享API导出成功');


                            return;


                        } catch (shareError) {


                            // 用户取消分享不算错误，直接返回


                            if (shareError.name === 'AbortError') {


                                console.log('[英雄队伍增强] 用户取消了分享');


                                return;


                            }


                            // 分享失败，继续尝试下载


                            console.log('[英雄队伍增强] Android分享失败，尝试下载方式:', shareError.message);


                        }


                    }


                    


                    // 3.2 分享失败，尝试下载


                    try {


                        const blob = new Blob([dataStr], { type: 'application/json;charset=utf-8' });


                        const url = URL.createObjectURL(blob);


                        const a = document.createElement('a');


                        a.href = url;


                        a.download = fileName;


                        a.style.display = 'none';


                        


                        document.body.appendChild(a);


                        a.click();


                        document.body.removeChild(a);


                        URL.revokeObjectURL(url);


                        


                        this.showTip('数据已下载', 'success');


                        console.log('[英雄队伍增强] Android使用下载方式导出成功');


                        return;


                    } catch (downloadError) {


                        console.error('[英雄队伍增强] Android下载失败:', downloadError);


                        this.showTip('导出失败: ' + downloadError.message, 'error');


                        return;


                    }


                }


                


                // 其他移动设备（兜底）


                this.showTip('不支持的设备类型', 'error');


                console.error('[英雄队伍增强] 不支持的设备类型');


                


            } catch (error) {


                console.error('[英雄队伍增强] 导出失败:', error);


                this.showTip('导出失败: ' + error.message, 'error');


            }


        }








        // 处理导入


        handleImport(file) {


            if (!file) {


                this.showTip('未收到文件，请重试', 'error');


                return;


            }





            console.log('[英雄队伍增强] 开始导入:', {


                name: file.name, size: file.size, type: file.type


            });





            if (file.size === 0) {


                this.showTip('文件为空，请检查', 'error');


                return;


            }





            // 统一处理已读取的文本内容


            const processText = (rawText) => {


                try {


                    if (typeof rawText !== 'string' || !rawText) {


                        this.showTip('读取文件失败（内容为空）', 'error');


                        return;


                    }


                    // 去除 UTF-8 BOM（部分移动端导出时附带 \uFEFF 会导致 JSON.parse 失败）


                    const cleanText = rawText.replace(/^\uFEFF/, '').trim();


                    if (!cleanText) {


                        this.showTip('文件内容为空', 'error');


                        return;


                    }





                    const importedTeams = JSON.parse(cleanText);


                    if (!Array.isArray(importedTeams)) {


                        this.showTip('文件格式错误！', 'error');


                        return;


                    }





                    // 获取当前已保存的队伍


                    const existingTeams = this.loadTeams();





                    // 智能合并逻辑


                    const mergedTeams = this.mergeTeams(existingTeams, importedTeams);





                    // 保存合并后的队伍


                    this.saveTeams(mergedTeams);


                    this.renderTeamList();





                    const addedCount = mergedTeams.length - existingTeams.length;


                    const updatedCount = importedTeams.length - Math.max(0, addedCount);





                    let message = '导入成功！';


                    if (addedCount > 0) {


                        message += ` 新增${addedCount}个队伍`;


                    }


                    if (updatedCount > 0) {


                        message += ` 更新${updatedCount}个队伍`;


                    }





                    this.showTip(message, 'success');


                    console.log('[英雄队伍增强] 数据已导入:', { addedCount, updatedCount });


                } catch (error) {


                    console.error('[英雄队伍增强] 解析失败:', error);


                    this.showTip('导入失败：' + (error && error.message || '文件格式异常'), 'error');


                }


            };





            // 使用 FileReader 读取（带完整错误捕获）


            const readWithFileReader = () => {


                try {


                    const reader = new FileReader();


                    reader.onload = (e) => processText(e && e.target && e.target.result);


                    reader.onerror = () => {


                        const errMsg = (reader.error && reader.error.message) || '未知错误';


                        console.error('[英雄队伍增强] FileReader 错误:', reader.error);


                        this.showTip('读取文件失败：' + errMsg, 'error');


                    };


                    reader.onabort = () => {


                        console.warn('[英雄队伍增强] FileReader 读取被中止');


                        this.showTip('读取被中止', 'error');


                    };


                    reader.readAsText(file);


                } catch (err) {


                    console.error('[英雄队伍增强] FileReader 启动失败:', err);


                    this.showTip('无法读取文件：' + (err && err.message || '未知错误'), 'error');


                }


            };





            // 优先使用现代 Blob.text() API（Android WebView 对 content:// 的兼容性更好）


            if (typeof file.text === 'function') {


                file.text()


                    .then((txt) => processText(txt))


                    .catch((err) => {


                        console.warn('[英雄队伍增强] file.text() 失败，降级到 FileReader:', err);


                        readWithFileReader();


                    });


            } else {


                readWithFileReader();


            }


        }





        // 智能合并队伍数据


        mergeTeams(existingTeams, importedTeams) {


            // 创建一个Map用于快速查找：key为"roleId_name"，value为队伍对象


            const teamMap = new Map();


            


            // 先将现有队伍加入Map


            existingTeams.forEach(team => {


                const roleId = team.formation?.roleId || 'unknown';


                const key = `${roleId}_${team.name}`;


                teamMap.set(key, team);


            });


            


            // 用于生成唯一ID的计数器


            let idCounter = 0;


            


            // 处理导入的队伍


            importedTeams.forEach(importedTeam => {


                const roleId = importedTeam.formation?.roleId || 'unknown';


                const key = `${roleId}_${importedTeam.name}`;


                


                const existingTeam = teamMap.get(key);


                


                if (existingTeam) {


                    // 同角色ID、同名字：比较时间，保留最新的


                    const existingTime = new Date(existingTeam.createDate || 0).getTime();


                    const importedTime = new Date(importedTeam.createDate || 0).getTime();


                    


                    if (importedTime > existingTime) {


                        // 导入的更新，替换现有的（保留原ID以避免UI问题）


                        teamMap.set(key, {


                            ...importedTeam,


                            id: existingTeam.id // 保留原有的ID


                        });                    } else {                    }


                } else {


                    // 不同名字或不同角色：新增队伍，生成新的整数ID


                    const newId = Date.now() + idCounter;


                    idCounter++;


                    


                    teamMap.set(key, {


                        ...importedTeam,


                        id: newId // 生成新的唯一整数ID


                    });                }


            });


            


            // 将Map转换回数组


            return Array.from(teamMap.values());


        }


        startInjection() {


            let checkCount = 0;


            const maxChecks = 120;





            const injectionInterval = setInterval(() => {


                checkCount++;





                if (checkCount >= maxChecks) {


                    clearInterval(injectionInterval);


                    console.error('[英雄队伍增强] 注入超时');


                    return;


                }





                if (typeof unsafeWindow.__require !== 'function' ||


                    typeof unsafeWindow.fgui !== 'object') {


                    return;


                }





                if (this.tryInject()) {


                    clearInterval(injectionInterval);


                    console.log('[英雄队伍增强] 注入成功');


                }


            }, 500);


        }





        tryInject() {


            try {


                const HeroTeamPanel = unsafeWindow.__require('HeroTeamPanel');


                if (!HeroTeamPanel || !HeroTeamPanel.HeroTeamPanel) {


                    return false;


                }





                this.injectCustomButton(HeroTeamPanel.HeroTeamPanel);


                return true;


            } catch (error) {


                console.error('[英雄队伍增强] 注入失败:', error);


                return false;


            }


        }





        injectCustomButton(PanelClass) {


            const self = this;


            const originalOnShow = PanelClass.prototype.onShow;





            PanelClass.prototype.onShow = function() {


                originalOnShow.apply(this, arguments);





                if (!this._customEnhanceButton) {


                    try {


                        this._addCustomButton(self);


                    } catch (error) {


                        console.error('[英雄队伍增强] 创建按钮失败:', error);


                    }


                }


            };





            PanelClass.prototype._addCustomButton = function(enhancer) {


                const helpButton = this.ui.m_btnHelp;


                if (!helpButton) {


                    console.error('[英雄队伍增强] 找不到帮助按钮');


                    return;


                }





                const customButton = unsafeWindow.fgui.UIPackage.createObject('ui_common', 'BtnInfo2');


                if (!customButton) {


                    console.error('[英雄队伍增强] 创建按钮失败');


                    return;


                }





                const btn = customButton.asButton;


                


                btn.setSize(helpButton.width, helpButton.height);


                


                const buttonSpacing = 10;


                btn.setPosition(


                    helpButton.x - btn.width - buttonSpacing,


                    helpButton.y


                );





                btn.icon = '';


                btn.title = '';





                // 隐藏按钮内部的三条横线图标


                try {


                    if (btn.numChildren > 0) {


                        for (let i = 0; i < btn.numChildren; i++) {


                            const child = btn.getChildAt(i);


                            if (child && child.name === 'n0') {


                                child.visible = false;


                            }


                        }


                    }


                } catch (e) {


                    console.error('[英雄队伍增强] 隐藏子元素失败:', e);


                }





                // 添加文字标签


                try {


                    const textField = new unsafeWindow.fgui.GTextField();


                    textField.name = 'customLabel';


                    textField.text = '队';


                    textField.fontSize = 32;


                    textField.bold = true;


                    textField.color = 0xffffff;


                    textField.singleLine = true;


                    


                    textField.shadowOffset = new unsafeWindow.cc.Vec2(0, 2);


                    textField.shadowColor = new unsafeWindow.cc.Color(122, 69, 48, 200);


                    


                    const textX = (btn.width - 32) / 2;


                    const textY = (btn.height - 32) / 2 - 5;


                    textField.setPosition(textX, textY);


                    


                    textField.visible = true;


                    textField.touchable = false;


                    


                    btn.addChild(textField);


                    try { btn.setChildIndex(textField, btn.numChildren - 1); } catch (_) {}


                    


                    this._customEnhanceLabel = textField;


                } catch (error) {


                    console.error('[英雄队伍增强] 添加文字失败:', error);


                }





                // 设置按钮点击事件 - 打开管理面板


                btn.onClick(() => {


                    console.log('[英雄队伍增强] 打开管理面板');


                    enhancer.showPanel();


                });





                this.ui.addChild(btn);


                this._customEnhanceButton = btn;


            };





            const originalOnHide = PanelClass.prototype.onHide;





            PanelClass.prototype.onHide = function() {


                if (this._customEnhanceButton) {


                    this._customEnhanceButton.dispose();


                    this._customEnhanceButton = null;


                }


                originalOnHide.apply(this, arguments);


            };


        }


    }





    new HeroTeamEnhancer();


})();
//# sourceURL=无限阵容.js