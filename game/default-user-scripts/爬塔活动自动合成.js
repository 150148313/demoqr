// ==UserScript==
// @name         咸鱼助手 - 爬塔活动自动合成 (终极版+强力拦截)
// @namespace    http://tampermonkey.net/
// @version      2.6
// @description  EvoTowerMergePlayDialog 专用。功能：1.自动合成 2.自动生成 3.自动领奖 4.强力拦截奖励弹窗(修复版)。
// @author       Gemini & AI
// @match        *://*
// @grant        unsafeWindow
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    console.log('[咸鱼助手] 爬塔自动合成脚本 v2.6 已加载...');

    // --- 全局控制变量 ---
    let isRunning = false;
    let stopFlag = false;
    const LOG_PREFIX = "[EvoTowerBot]";

    // --- 模块获取工具 ---
    const ModuleStore = {
        _cache: {},
        get: function(moduleName) {
            if (this._cache[moduleName]) return this._cache[moduleName];
            try {
                const requireFunc = typeof unsafeWindow !== "undefined" ? unsafeWindow.__require : window.__require;
                if (!requireFunc) return null;
                const mod = requireFunc(moduleName);
                if (mod) this._cache[moduleName] = mod;
                return mod;
            } catch (e) {
                return null;
            }
        }
    };

    // --- 提示框工具 ---
    const Toast = {
        show: function(msg) {
            console.log(`${LOG_PREFIX} ${msg}`);
            try {
                const TipsManager = ModuleStore.get("TipsManager");
                if (TipsManager && TipsManager.SHOW_TIP) {
                    TipsManager.SHOW_TIP(msg);
                }
            } catch(e) {}
        }
    };

    // --- 强力弹窗拦截器 (重写版) ---
    const DialogBlocker = {
        patched: false,
        patch: function() {
            if (this.patched) return;
            try {
                const UIManager = ModuleStore.get("UIManager");
                // 尝试获取弹窗类，用于对比，获取不到也没关系，后面有特征识别
                const RewardsModule = ModuleStore.get("ItemRewardsDialog");
                const TargetClass = RewardsModule ? RewardsModule.ItemRewardsDialog : null;

                if (!UIManager) return;

                // 需要拦截的方法列表。根据 MPData 源码，SHOW_DIALOG_DEFERRED 是重点
                const methodsToHook = ['SHOW_DIALOG_DEFERRED', 'SHOW_DIALOG', 'PUSH_DIALOG_QUEUE', 'SHOW_PROXY'];

                methodsToHook.forEach(methodName => {
                    if (typeof UIManager[methodName] === 'function' && !UIManager[methodName]._isPatched) {
                        const originalMethod = UIManager[methodName];
                        
                        UIManager[methodName] = function(dialogClass, params) {
                            // 拦截判断逻辑：
                            // 1. 脚本必须在运行中
                            // 2. 目标必须是 ItemRewardsDialog 类 (如果能获取到)
                            // 3. 或者：参数 params 里面包含 rewards 数组 (特征识别)
                            // 4. 或者：类名包含 "ItemRewardsDialog" (防止混淆)
                            
                            let shouldBlock = false;
                            
                            if (isRunning) {
                                if (TargetClass && dialogClass === TargetClass) {
                                    shouldBlock = true;
                                } else if (dialogClass && dialogClass.name && dialogClass.name.indexOf("ItemRewardsDialog") !== -1) {
                                    shouldBlock = true;
                                } else if (params && params.rewards && Array.isArray(params.rewards) && params.rewards.length > 0) {
                                    // 特征识别：只要传参里有 rewards，就判定为奖励弹窗
                                    shouldBlock = true;
                                }
                            }

                            if (shouldBlock) {
                                console.log(`${LOG_PREFIX} 拦截到弹窗调用: ${methodName}`);
                                
                                // 计算奖励总数用于提示
                                let count = 0;
                                if (params && params.rewards) count = params.rewards.length;
                                Toast.show(`[苏御]自动领取 ${count} 项奖励 (弹窗已屏蔽)`);

                                // 关键：必须返回一个 resolved Promise，否则游戏逻辑会卡住等待弹窗关闭
                                return Promise.resolve();
                            }

                            // 不拦截，放行
                            return originalMethod.apply(this, arguments);
                        };
                        
                        UIManager[methodName]._isPatched = true;
                    }
                });

                this.patched = true;
                console.log(`${LOG_PREFIX} 强力弹窗拦截器注入完成 (覆盖 ${methodsToHook.join(',')})`);

            } catch (e) {
                console.error(`${LOG_PREFIX} 拦截器注入失败`, e);
            }
        }
    };

    // --- 奖励领取机器人 ---
    const RewardBot = {
        sleep: (ms) => new Promise(resolve => setTimeout(resolve, ms)),

        claimAll: async function(mpData) {
            console.log(`${LOG_PREFIX} --- 开始检查可领取的奖励 ---`);
            let claimedSomething = false;

            // 1. 领取消耗奖励
            if (mpData.canClaimConsumeReward()) {
                console.log(`${LOG_PREFIX} 领取累计消耗奖励...`);
                await mpData.sendClaimCostProgressReward();
                claimedSomething = true;
                await this.sleep(50);
            }

            // 2. 领取任务奖励
            if (mpData.canClaimProgressReward()) {
                console.log(`${LOG_PREFIX} 扫描合成任务奖励...`);
                const Configs = ModuleStore.get("Configs");
                if (Configs && Configs.ActMergeProgressConf) {
                    const list = Configs.ActMergeProgressConf.list;
                    for (let i = 0; i < list.length; i++) {
                        if (stopFlag) break;
                        const task = list[i];
                        const progress = mpData.taskMap.get(task.id) || 0;
                        const isClaimed = mpData.taskClaimMap.get(task.id) || 0;
                        
                        if (progress > 0 && isClaimed <= 0) {
                            console.log(`${LOG_PREFIX} 领取任务 ID: ${task.id}`);
                            await mpData.sendClaimMergeProgressReward(task.id);
                            claimedSomething = true;
                            await this.sleep(50); 
                        }
                    }
                }
            }

            // 3. 领取免费体力
            if (mpData.canClaimFreeRewards && mpData.canClaimFreeRewards()) {
                console.log(`${LOG_PREFIX} 领取免费/分享体力...`);
                try {
                    const Configs = ModuleStore.get("Configs");
                    const ModuleManager = ModuleStore.get("ModuleManager");
                    if (Configs && ModuleManager) {
                        const MergeBoardModule = ModuleManager.GET_MODULE(Configs.ModuleType.MERGE_BOARD);
                        if (MergeBoardModule) {
                            await MergeBoardModule.sendClaimFreeEnergy(mpData.actType);
                            claimedSomething = true;
                            await this.sleep(50);
                        }
                    }
                } catch (e) {}
            }

            return claimedSomething;
        }
    };

    // --- 核心逻辑引擎 ---
    const AutoBot = {
        sleep: (ms) => new Promise(resolve => setTimeout(resolve, ms)),

        getEmptyTileCount: function(mpData) {
            if (!mpData || !mpData.tiles) return 0;
            let count = 0;
            for (let i = 0; i < mpData.tiles.length; i++) {
                if (!mpData.tiles[i]) count++;
            }
            return count;
        },

        run: async function(mpData) {
            let noActionCounter = 0;
            const MPTileEmission = { CAN_LAUNCH: 1 };

            while (!stopFlag) {
                let hasAction = false;

                // 1. 合成
                let merged = true;
                while (merged && !stopFlag) {
                    merged = await this.doMerge(mpData);
                    if (merged) {
                        hasAction = true;
                        noActionCounter = 0;
                        await this.sleep(50);
                    }
                }

                // 2. 生成
                if (!stopFlag) {
                    const emptyCount = this.getEmptyTileCount(mpData);
                    if (emptyCount > 0) {
                        const launched = await this.doLaunch(mpData, MPTileEmission);
                        if (launched) {
                            hasAction = true;
                            noActionCounter = 0;
                            await this.sleep(50);
                        }
                    }
                }

                // 3. 状态判定
                if (!hasAction) {
                    noActionCounter++;
                    if (noActionCounter >= 3) {
                        const emptyCount = this.getEmptyTileCount(mpData);
                        const hasKeys = mpData.checkSatisfyKeys();

                        if (!hasKeys) {
                            // 体力耗尽，领奖补给
                            Toast.show("[苏御]钥匙耗尽，尝试领取奖励补给...");
                            await RewardBot.claimAll(mpData);
                            
                            if (mpData.checkSatisfyKeys()) {
                                Toast.show("[苏御]钥匙充足，继续合成！");
                                noActionCounter = 0;
                                continue;
                            } else {
                                Toast.show("[苏御]奖励已领完，钥匙仍不足，脚本停止");
                                stopFlag = true;
                                break;
                            }
                        } else if (emptyCount === 0) {
                            Toast.show("[苏御]棋盘已满且无法合成，脚本停止");
                            stopFlag = true;
                            break;
                        } else {
                            // 冷却中
                            if (noActionCounter % 5 === 0) {
                                console.log(`${LOG_PREFIX} 生成器冷却中 (Zzz)，等待...`);
                            }
                            await this.sleep(500);
                        }
                    } else {
                        await this.sleep(50);
                    }
                } else {
                    await this.sleep(50);
                }
            }
            isRunning = false;
        },

        doMerge: async function(mpData) {
            const tiles = mpData.tiles;
            if (!tiles) return false;
            for (let i = tiles.length - 1; i >= 0; i--) {
                if (stopFlag) return false;
                const tileA = tiles[i];
                if (!tileA) continue;
                const posA = mpData.arrayIndexToPosition(i);
                for (let j = i - 1; j >= 0; j--) {
                    const tileB = tiles[j];
                    if (!tileB) continue;
                    const posB = mpData.arrayIndexToPosition(j);
                    if (mpData.canMergeItems(posA, posB)) {
                        if (tileA.gridType === 2 && tileB.gridType === 2) { 
                             try {
                                await mpData.sendMergeItems(posA, posB);
                                return true;
                            } catch (e) {}
                        }
                    }
                }
            }
            return false;
        },

        doLaunch: async function(mpData, CONSTS) {
            if (!mpData.checkSatisfyKeys()) return false;
            const tiles = mpData.tiles;
            for (let i = 0; i < tiles.length; i++) {
                if (stopFlag) return false;
                const tile = tiles[i];
                if (!tile) continue;
                const pos = mpData.arrayIndexToPosition(i);
                if (mpData.getEmissionState(pos) === CONSTS.CAN_LAUNCH) {
                    try {
                        await mpData.sendLaunchItem(pos);
                        return true;
                    } catch (e) {}
                }
            }
            return false;
        }
    };

    // --- UI 注入模块 ---
    const Injector = {
        btn: null,
        createButton: function(dialogInstance) {
            if (this.btn) return;
            try {
                const fgui = window.fgui || (unsafeWindow && unsafeWindow.fgui);
                if (!fgui) return;
                const ui = dialogInstance.ui;
                if (!ui) return;
                
                const anchor = ui.m_btnHelp || ui.m_btnBack;
                if (!anchor) return;

                this.btn = fgui.UIPackage.createObject('ui_common', 'BtnInfo2').asButton;
                this.btn.title = "自动挂机";
                this.btn.icon = "ui://ui_common/icon_auto"; 
                
                const anchorWidth = anchor.width || 80;
                const spacing = 15;
                this.btn.setPosition(anchor.x + anchorWidth + spacing, anchor.y);
                anchor.parent.addChild(this.btn);

                this.btn.onClick(() => {
                    this.onBtnClick(dialogInstance);
                });
                console.log(`${LOG_PREFIX} 按钮注入成功`);
            } catch (e) {}
        },
        updateBtnState: function() {
            if (!this.btn) return;
            this.btn.title = isRunning ? "停止运行" : "自动挂机";
            this.btn.selected = isRunning;
        },
        onBtnClick: function(dialogInstance) {
            if (isRunning) {
                stopFlag = true;
                isRunning = false;
                Toast.show("[苏御]操作已停止");
            } else {
                const mpData = dialogInstance.dataSource;
                if (!mpData) {
                    Toast.show("[苏御]数据未加载");
                    return;
                }
                
                // 再次尝试注入拦截器 (双重保险)
                DialogBlocker.patch();

                isRunning = true;
                stopFlag = false;
                Toast.show("[苏御]开始自动合成...");
                AutoBot.run(mpData).catch(err => {
                    console.error(err);
                    isRunning = false;
                    this.updateBtnState();
                });
            }
            this.updateBtnState();
        },
        destroy: function() {
            if (this.btn) {
                this.btn.dispose();
                this.btn = null;
            }
            isRunning = false;
            stopFlag = true;
        }
    };

    // --- Hook 入口 ---
    const hookGame = () => {
        // 尽早注入拦截器
        DialogBlocker.patch();

        const Module = ModuleStore.get("EvoTowerMergePlayDialog");
        if (Module && Module.EvoTowerMergePlayDialog) {
            const ClassProto = Module.EvoTowerMergePlayDialog.prototype;
            if (ClassProto._isHookedByBot) return;

            const originalOnShown = ClassProto.onShown;
            ClassProto.onShown = function() {
                if (originalOnShown) originalOnShown.apply(this, arguments);
                setTimeout(() => { Injector.createButton(this); }, 500);
            };

            const originalOnHide = ClassProto.onHide;
            ClassProto.onHide = function() {
                Injector.destroy();
                if (originalOnHide) originalOnHide.apply(this, arguments);
            };

            ClassProto._isHookedByBot = true;
            console.log(`${LOG_PREFIX} Hook 成功`);
            return true;
        }
        return false;
    };

    const timer = setInterval(() => {
        // 持续注入拦截器，因为 UIManager 可能加载较晚
        DialogBlocker.patch();
        if (hookGame()) {
            // 这里不清除 timer，因为 DialogBlocker 可能还需要重试
        }
    }, 1000);

})();
//# sourceURL=怪异塔自动合成.jsॡ