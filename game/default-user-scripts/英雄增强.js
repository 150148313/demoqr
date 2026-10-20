// ==UserScript==
// @name         英雄增强
// @namespace    https://xyzw.local/userscripts/hero
// @version      0.1.0
// @description  增强英雄、图鉴、招募、训练和属性提示相关能力。
// @author       game-agent
// @match        *://*/*
// @grant        none
// @run-at       document-start
// ==/UserScript==
(function() {
  "use strict";
  const getGlobal = () => window;
  function getRequireHub() {
    const global = getGlobal();
    if (global.__XYZW_USERSCRIPT_REQUIRE_HUB__) {
      return global.__XYZW_USERSCRIPT_REQUIRE_HUB__;
    }
    const hub = {
      installed: false,
      callbacks: []
    };
    global.__XYZW_USERSCRIPT_REQUIRE_HUB__ = hub;
    return hub;
  }
  function notifyRequireReady(hub, requireFunc) {
    hub.requireFunc = requireFunc;
    const callbacks = hub.callbacks.splice(0);
    callbacks.forEach((callback) => {
      try {
        callback(requireFunc);
      } catch (error) {
        console.error("[XYZW Userscript] require callback failed", error);
      }
    });
  }
  function installRequireHook() {
    const global = getGlobal();
    const hub = getRequireHub();
    if (hub.installed) {
      return hub;
    }
    const descriptor = Object.getOwnPropertyDescriptor(global, "__require");
    const originalGetter = descriptor?.get;
    const originalSetter = descriptor?.set;
    let internalRequire = typeof descriptor?.value === "function" ? descriptor.value : originalGetter?.call(global);
    Object.defineProperty(global, "__require", {
      configurable: true,
      set(requireFunc) {
        if (originalSetter) {
          originalSetter.call(global, requireFunc);
        }
        internalRequire = requireFunc;
        notifyRequireReady(hub, requireFunc);
      },
      get() {
        return internalRequire || originalGetter?.call(global);
      }
    });
    hub.installed = true;
    if (internalRequire) {
      notifyRequireReady(hub, internalRequire);
    }
    return hub;
  }
  function onRequireReady(callback, timeoutMs) {
    const global = getGlobal();
    const hub = installRequireHook();
    const existingRequire = hub.requireFunc || global.__require;
    if (typeof existingRequire === "function") {
      callback(existingRequire);
      return;
    }
    let settled = false;
    const timeoutId = global.setTimeout(() => {
      settled = true;
      const index = hub.callbacks.indexOf(wrapped);
      if (index >= 0) hub.callbacks.splice(index, 1);
    }, timeoutMs);
    const wrapped = (requireFunc) => {
      if (settled) return;
      settled = true;
      global.clearTimeout(timeoutId);
      callback(requireFunc);
    };
    hub.callbacks.push(wrapped);
  }
  function processModule(requireFunc, moduleName, handler2, featureName, quiet = false) {
    try {
      const mod = requireFunc(moduleName);
      if (!mod) {
        if (!quiet) console.warn(`[${featureName}] 模块 ${moduleName} 为空`);
        return false;
      }
      const marker = `__xyzwUserscriptHooked_${featureName}_${moduleName}`;
      if (mod[marker]) {
        return true;
      }
      const success = handler2(mod);
      Object.defineProperty(mod, marker, {
        value: true,
        configurable: false,
        enumerable: false,
        writable: false
      });
      if (!success) {
        if (!quiet) console.warn(`[${featureName}] 模块 ${moduleName} Hook失败`);
      }
      return success;
    } catch (error) {
      if (!quiet) {
        console.error(`[${featureName}] 处理模块 ${moduleName} 失败`, error);
      }
      return false;
    }
  }
  function retryMissingHandlers(requireFunc, handlers, featureName, timeoutMs) {
    const global = getGlobal();
    const missing = new Map(Object.entries(handlers));
    for (const [moduleName, handler2] of Array.from(missing.entries())) {
      if (processModule(requireFunc, moduleName, handler2, featureName)) {
        missing.delete(moduleName);
      }
    }
    if (missing.size === 0) {
      console.log(`[${featureName}] 油猴增强已安装`);
      return;
    }
    const startedAt = Date.now();
    const intervalId = global.setInterval(() => {
      for (const [moduleName, handler2] of Array.from(missing.entries())) {
        if (processModule(requireFunc, moduleName, handler2, featureName, true)) {
          missing.delete(moduleName);
        }
      }
      if (missing.size === 0) {
        global.clearInterval(intervalId);
        console.log(`[${featureName}] 油猴增强已安装`);
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        global.clearInterval(intervalId);
        console.warn(
          `[${featureName}] 以下模块未能安装: ${Array.from(missing.keys()).join(", ")}`
        );
      }
    }, 500);
  }
  function runInstallers(featureName, installers) {
    for (const installer of installers || []) {
      try {
        installer();
      } catch (error) {
        console.error(`[${featureName}] 安装增强桥失败`, error);
      }
    }
  }
  function installUserscriptFeature(options) {
    const global = getGlobal();
    const marker = `__XYZW_USERSCRIPT_${options.key}_INSTALLED__`;
    if (global[marker]) {
      return;
    }
    global[marker] = true;
    runInstallers(options.name, options.installers);
    if (!options.handlers || Object.keys(options.handlers).length === 0) {
      console.log(`[${options.name}] 油猴增强已安装`);
      return;
    }
    onRequireReady((requireFunc) => {
      retryMissingHandlers(
        requireFunc,
        options.handlers || {},
        options.name,
        options.timeoutMs ?? 3e4
      );
    }, options.timeoutMs ?? 3e4);
  }
  const __vite_import_meta_env__ = { "DEV": false };
  const { DEV } = __vite_import_meta_env__ || {};
  const CONFIG = {
    // debug on in dev mode
    debug: !!DEV
  };
  const Logger = {
    log: (...[msg, ...args]) => {
      if (CONFIG.debug) console.log(`[Hook] ${msg}`, ...args);
    },
    warn: (...[msg, ...args]) => {
      if (CONFIG.debug) console.warn(`[Hook] ${msg}`, ...args);
    },
    error: (...[msg, ...args]) => {
      if (CONFIG.debug) console.error(`[Hook] ${msg}`, ...args);
    },
    debug: (...[msg, ...args]) => {
      if (CONFIG.debug) console.debug(`[Hook] ${msg}`, ...args);
    }
  };
  function mergeRewards(list) {
    try {
      if (!Array.isArray(list) || list.length === 0) return [];
      const map = /* @__PURE__ */ new Map();
      for (const reward of list) {
        const key = `${reward?.type}_${reward?.itemId}`;
        const prev = map.get(key);
        if (prev) {
          prev.value = (prev.value || 0) + (reward?.value || 0);
        } else {
          map.set(key, { ...reward });
        }
      }
      return Array.from(map.values());
    } catch {
      return list || [];
    }
  }
  function handler$6(mod) {
    const HeroModule = mod?.HeroModule;
    if (!HeroModule?.prototype) return false;
    const proto = HeroModule.prototype;
    const originalSendHeroUpgradeStar = proto.sendHeroUpgradeStar;
    proto.sendHeroUpgradeStarToMax = function(heroId) {
      try {
        const dataIndex = window.__require("data-index");
        const HeroService = dataIndex?.HeroService;
        const Configs = window.__require("Configs");
        const uiIndex = window.__require("index-ui") || {};
        const SHOW_PROXY = uiIndex.SHOW_PROXY;
        const SHOW_DIALOG_DEFERRED = uiIndex.SHOW_DIALOG_DEFERRED;
        const LanguageExt = window.__require("LanguageExt") || {};
        const GET_CONTENT = LanguageExt.GET_CONTENT || ((k) => k);
        const Tips = window.__require("TipsManager") || {};
        const SHOW_TIP = Tips.SHOW_TIP || Logger.warn;
        const ItemRewardsDialog = window.__require("ItemRewardsDialog")?.ItemRewardsDialog;
        const HeroStarUpSuccessDialog = window.__require(
          "HeroStarUpSuccessDialog"
        )?.HeroStarUpSuccessDialog;
        if (!HeroService || !Configs) {
          Logger.warn(
            "[HeroModule] 依赖缺失，回退原始 sendHeroUpgradeStar"
          );
          return originalSendHeroUpgradeStar.call(this, heroId);
        }
        return new Promise(async (resolve) => {
          try {
            const hero = typeof ROLE?.getHeroById === "function" ? ROLE.getHeroById(heroId) : null;
            if (!hero) {
              resolve(false);
              return;
            }
            const startStar = hero.star;
            const color = hero.color;
            const fragItemId = hero.heroFragmentId;
            let available = typeof ROLE?.getItemQuantity === "function" ? ROLE.getItemQuantity(fragItemId) : 0;
            const starSpendConf = Configs?.HeroStarSpend?.getById?.(color);
            const spendList = starSpendConf?.starSpend || [];
            let curStar = hero.star;
            let canTimes = 0;
            while (curStar < spendList.length && available >= (spendList[curStar] || 0)) {
              available -= spendList[curStar] || 0;
              curStar += 1;
              canTimes += 1;
            }
            if (canTimes <= 0) {
              if (curStar >= spendList.length)
                SHOW_TIP(GET_CONTENT("10028", "已达到最高星级"));
              else
                SHOW_TIP(
                  GET_CONTENT("C2_HeroModule_CONST2", "碎片不足")
                );
              resolve(false);
              return;
            }
            const baseParams = {};
            try {
              baseParams["op_heroId"] = hero.heroId;
              baseParams["op_hp"] = hero.hp;
              baseParams["op_attack"] = hero.attack;
              baseParams["op_defense"] = hero.defense;
              baseParams["op_speed"] = hero.speed;
              const StarDlg = window.__require(
                "HeroStarUpSuccessDialog"
              )?.HeroStarUpSuccessDialog;
              if (StarDlg?.OP_HERO_ID) {
                baseParams[StarDlg.OP_HERO_ID] = hero.heroId;
                baseParams[StarDlg.OP_HERO_HP] = hero.hp;
                baseParams[StarDlg.OP_HERO_ATTACK] = hero.attack;
                baseParams[StarDlg.OP_HERO_DEFENSE] = hero.defense;
                baseParams[StarDlg.OP_HERO_SPEED] = hero.speed;
              }
              baseParams["__preHeroStar"] = startStar;
            } catch {
            }
            const allRewards = [];
            let successCount = 0;
            try {
              Tips.TipsManager && (Tips.TipsManager.instance.lockForceTip = true);
            } catch {
            }
            for (let i = 0; i < canTimes; i++) {
              const resp = await HeroService.heroUpgradeStar({
                heroId
              });
              if (resp && resp.code) break;
              try {
                const data = resp?.getData ? resp.getData() : resp?.data || resp?.rawData || resp;
                const rewards = data && data.reward || [];
                if (Array.isArray(rewards) && rewards.length)
                  allRewards.push(...rewards);
              } catch {
              }
              try {
                this.singleHeroAttrDirty++;
              } catch {
              }
              successCount++;
            }
            if (successCount > 0) {
              baseParams["__curHeroStar"] = startStar + successCount;
              try {
                if (HeroStarUpSuccessDialog && SHOW_DIALOG_DEFERRED) {
                  await SHOW_DIALOG_DEFERRED(
                    HeroStarUpSuccessDialog,
                    baseParams
                  );
                } else if (HeroStarUpSuccessDialog && SHOW_PROXY) {
                  SHOW_PROXY(HeroStarUpSuccessDialog, baseParams);
                }
              } catch {
              }
            }
            try {
              if (successCount > 0 && allRewards.length > 0 && ItemRewardsDialog) {
                const merged = mergeRewards(allRewards);
                if (SHOW_DIALOG_DEFERRED)
                  await SHOW_DIALOG_DEFERRED(ItemRewardsDialog, {
                    rewards: merged
                  });
                else if (SHOW_PROXY)
                  SHOW_PROXY(ItemRewardsDialog, {
                    rewards: merged
                  });
                try {
                  this.heroSkinNotifyUpdate++;
                  this.isBattleTeamChanged = true;
                } catch {
                }
              }
            } catch {
            }
            try {
              if (Tips.TipsManager?.instance)
                Tips.TipsManager.instance.lockForceTip = false;
              const inTeam = typeof hero?.isInBattleTeam === "function" ? hero.isInBattleTeam() : false;
              if (inTeam && Tips.TipsManager?.instance) {
                Tips.TipsManager.instance.showForceTip?.(
                  ROLE.power
                );
              }
            } catch {
            }
            resolve(true);
          } catch (e) {
            Logger.warn(
              "[HeroModule] sendHeroUpgradeStarToMax error:",
              e
            );
            try {
              const TM = window.__require("TipsManager");
              if (TM?.TipsManager?.instance) {
                TM.TipsManager.instance.lockForceTip = false;
              }
            } catch {
            }
            resolve(false);
          }
        });
      } catch (e) {
        Logger.warn("[HeroModule] hook setup error:", e);
        return originalSendHeroUpgradeStar.call(this, heroId);
      }
    };
    proto.getShareHeroAttr = function(shareAttrCode) {
      return new Promise(async (resolve) => {
        const codeStr = String(shareAttrCode || "").trim();
        if (codeStr && codeStr.includes("@")) {
          const match = /^(\d+\+)?(\d+)@(\d+)$/.exec(codeStr);
          if (!match) return null;
          const roleId = Number(match[2]);
          const battleTeamSlot = Number(match[3]);
          if (!Number.isFinite(roleId) || !Number.isFinite(battleTeamSlot) || roleId <= 0 || battleTeamSlot <= 0)
            return null;
          const { EMTeamType, GDShareHero } = window.__require("data-index");
          const ModuleManager = window.__require("ModuleManager") || {};
          const Configs = window.__require("Configs") || {};
          const ModuleType = Configs?.ModuleType;
          const RankModule = ModuleManager.GET_MODULE(ModuleType.RANK);
          const roleInfo = await RankModule.sendGetRoleInfo(roleId);
          const roleTeamResp = await RankModule.sendGetRoleTeam(
            roleId,
            17
          );
          if (roleTeamResp.code) resolve(false);
          const battleTeamSlotIndex = battleTeamSlot - 1;
          const fighter = roleTeamResp.teamInfo.team.get(battleTeamSlotIndex);
          const battleTeamMember = roleInfo.battleTeam.get(battleTeamSlotIndex);
          const heroId = battleTeamMember.heroId;
          const hero = roleInfo.heroes.get(heroId);
          if (fighter && hero) {
            hero.level = fighter.level;
            hero.star = fighter.star;
            hero.color = fighter.color;
            hero.attack = fighter.attack;
            hero.defense = fighter.defense;
            hero.hp = fighter.hp;
            hero.speed = fighter.speed;
            hero.attribute = fighter.attribute;
            hero.skill = fighter.skill;
            hero.activeSkill = fighter.activeSkill;
            hero.battleTeamSlot = battleTeamSlot;
            hero.skinId = fighter.skin;
            hero.useSkin = fighter.skin;
          }
          const pearl = roleInfo.pearlMap.get(hero.pearlId);
          const shareAttr = new GDShareHero();
          shareAttr.roleId = roleInfo.roleId;
          shareAttr.name = roleInfo.name;
          shareAttr.lordWeaponId = roleInfo.lordWeaponId;
          shareAttr.lordWeapon = roleInfo.lordWeapon;
          shareAttr.heroId = heroId;
          shareAttr.hero = hero;
          shareAttr.pearl = pearl;
          const target = this.getShareAttrResp;
          target.shareAttr = shareAttr;
          resolve(true);
        } else {
          const { HeroService } = window.__require("data-index");
          if (!HeroService?.getShareAttr) {
            resolve(false);
            return;
          }
          const resp = await HeroService.getShareAttr({
            shareAttrCode: codeStr
          });
          if (resp.code) {
            resolve(false);
            return;
          }
          const target = this.getShareAttrResp;
          target.reset();
          target.setValue(resp.rawData);
          resolve(true);
        }
      });
    };
    return true;
  }
  function handler$5(mod) {
    const HeroBookPanel = mod?.HeroBookPanel;
    if (!HeroBookPanel?.prototype) return false;
    const proto = HeroBookPanel.prototype;
    const originalRefreshBookSlot = proto._refreshBookSlot;
    proto._refreshBookSlot = function(cell, data, force = false) {
      try {
        if (typeof originalRefreshBookSlot === "function") originalRefreshBookSlot.call(this, cell, data, force);
      } catch {
      }
      try {
        const bindBatch = (btn) => {
          if (!btn) return;
          try {
            btn.clearClick && btn.clearClick();
          } catch {
          }
          btn.onClick?.(() => handleAll());
        };
        const handleAll = async () => {
          try {
            if (cell._starActiveEffectLock) return;
            const uiIndex = window.__require("index-ui") || {};
            const SHOW_PROXY = uiIndex.SHOW_PROXY;
            const SHOW_DIALOG_DEFERRED = uiIndex.SHOW_DIALOG_DEFERRED;
            const ItemRewardsDialog = window.__require("ItemRewardsDialog")?.ItemRewardsDialog;
            const ModuleManager = window.__require("ModuleManager");
            const Configs = window.__require("Configs");
            if (!ModuleManager || !Configs) return;
            const BookModule = ModuleManager.GET_MODULE(Configs.ModuleType.BOOK);
            if (!BookModule) return;
            this._animationLock = true;
            cell._starEffectLock = true;
            cell._starActiveEffectLock = true;
            let totalPoint = 0;
            const allRewards = [];
            let successCount = 0;
            const getAllHA = () => {
              const heroes = [];
              try {
                const map = BookModule.heroes;
                if (map && typeof map.forEach === "function") {
                  map.forEach((v) => v && heroes.push(v));
                } else if (map && map.values) {
                  for (const v of map.values()) heroes.push(v);
                }
              } catch {
              }
              const artifacts = Array.isArray(BookModule.books) ? BookModule.books : [];
              return heroes.concat(artifacts).filter(Boolean);
            };
            const getAllSkins = () => Array.isArray(BookModule.skinList) ? BookModule.skinList.filter(Boolean) : [];
            let pass = 0;
            const MAX_PASSES = 200;
            while (pass++ < MAX_PASSES) {
              const candidatesHA = getAllHA();
              const candidatesSkin = getAllSkins();
              const activatables = candidatesHA.concat(candidatesSkin).filter((it) => it && it.showType === "active");
              let changed = false;
              for (const it of activatables) {
                try {
                  const rp = Number(it?.rewardPoint || 0);
                  const resp = await BookModule.bookActive(it);
                  if (resp && resp.code) continue;
                  changed = true;
                  successCount++;
                  totalPoint += rp;
                  try {
                    const dataObj = resp?.getData ? resp.getData() : resp?.data || resp?.rawData || resp;
                    const rewards = dataObj?.reward || dataObj?.rewards || [];
                    if (Array.isArray(rewards)) allRewards.push(...rewards);
                  } catch {
                  }
                } catch (e) {
                  Logger.warn("[HeroBookPanel] 激活失败，已跳过:", e);
                }
              }
              const upgradable = candidatesHA.filter((it) => it && it.showType === "lvUp");
              for (const it of upgradable) {
                let inner = 0;
                const INNER_MAX = 60;
                while (it && it.showType === "lvUp" && inner++ < INNER_MAX) {
                  try {
                    const rp = Number(it?.rewardPoint || 0);
                    const resp = await BookModule.bookLevelUp(it);
                    if (resp && resp.code) break;
                    changed = true;
                    successCount++;
                    totalPoint += rp;
                    try {
                      const dataObj = resp?.getData ? resp.getData() : resp?.data || resp?.rawData || resp;
                      const rewards = dataObj?.reward || dataObj?.rewards || [];
                      if (Array.isArray(rewards)) allRewards.push(...rewards);
                    } catch {
                    }
                  } catch (e) {
                    Logger.warn("[HeroBookPanel] 升星失败，已跳过:", e);
                    break;
                  }
                }
              }
              if (!changed) break;
            }
            try {
              if (totalPoint > 0) this._playEffect(totalPoint);
            } catch {
            }
            try {
              this._refreshView?.(false);
            } catch {
            }
            try {
              this._playStarEffect?.(cell.m_stars, cell, data);
            } catch {
            }
            try {
              if (successCount > 0 && allRewards.length > 0 && ItemRewardsDialog) {
                const rewards = mergeRewards(allRewards);
                if (SHOW_DIALOG_DEFERRED) await SHOW_DIALOG_DEFERRED(ItemRewardsDialog, { rewards });
                else if (SHOW_PROXY) SHOW_PROXY(ItemRewardsDialog, { rewards });
              }
            } catch (e) {
              Logger.warn("[HeroBookPanel] 展示升星聚合奖励失败:", e);
            }
          } catch (e) {
            Logger.warn("[HeroBookPanel] 批量升星处理异常:", e);
          } finally {
            try {
              cell._starEffectLock = false;
            } catch {
            }
            try {
              cell._starActiveEffectLock = false;
            } catch {
            }
            try {
              this._animationLock = false;
            } catch {
            }
          }
        };
        bindBatch(cell?.m_btnLvUp);
        bindBatch(cell?.m_btnActive);
      } catch (e) {
        Logger.warn("[HeroBookPanel] _refreshBookSlot hook error:", e);
      }
    };
    return true;
  }
  function handler$4(mod) {
    const HeroRecruitDialog = mod?.HeroRecruitDialog;
    if (!HeroRecruitDialog?.prototype) return false;
    const proto = HeroRecruitDialog.prototype;
    const originalOnFixShow = proto.onFixShow;
    proto.onFixShow = function() {
      originalOnFixShow && originalOnFixShow.call(this);
      const uiIndex = window.__require("index-ui") || {};
      const SHOW_PROXY = uiIndex.SHOW_PROXY;
      const consts = window.__require("consts") || {};
      const ModuleNameItem = consts.ModuleNameItem;
      const ModuleNameCallback = consts.ModuleNameCallback;
      const ItemUseDialog = window.__require("ItemUseDialog")?.ItemUseDialog;
      const ModuleManager = window.__require("ModuleManager");
      const Configs = window.__require("Configs");
      const dataIndex = window.__require("data-index");
      const ModuleType = Configs?.ModuleType;
      const ConstantConf = Configs?.ConstantConf;
      const ResourceType = Configs?.ResourceType;
      const ItemRewardsDialog = window.__require("ItemRewardsDialog")?.ItemRewardsDialog;
      const HeroRecruitTenResultDialog = window.__require("HeroRecruitTenResultDialog")?.HeroRecruitTenResultDialog;
      const GetHeroDialog = window.__require("GetHeroDialog")?.GetHeroDialog;
      const ResourceGetWayDialog = window.__require("ResourceGetWayDialog");
      const SHOW_GET_WAY_DIALOG = ResourceGetWayDialog?.SHOW_GET_WAY_DIALOG;
      if (!SHOW_PROXY || !ItemUseDialog || !ModuleNameItem || !ModuleNameCallback || !ModuleManager || !ModuleType || !ConstantConf) {
        Logger.warn("[HeroRecruitDialog] 依赖缺失，跳过自定义次数Hook");
        return;
      }
      const view = this.ui || {};
      const btnTen = view?.m_btnTen;
      try {
        btnTen?.clearClick && btnTen.clearClick();
      } catch {
      }
      btnTen?.onClick?.((ev) => {
        ev?.stopPropagation?.();
        if (view?.m_cardIn1?.playing || view?.m_cardn10?.playing) return;
        const recruitModule = ModuleManager.GET_MODULE(ModuleType.RECRUIT);
        const ROLE2 = window.ROLE;
        const ticketId = ConstantConf.config.recruitTicketId;
        const ticketCount = typeof ROLE2?.getItemQuantity === "function" ? ROLE2.getItemQuantity(ticketId) : 0;
        if (ticketCount < 1 && SHOW_GET_WAY_DIALOG && ResourceType && ModuleType) {
          try {
            SHOW_GET_WAY_DIALOG(
              ResourceType.ITEM,
              ticketId,
              1 - ticketCount,
              ModuleType.RECRUIT
            );
          } catch (e) {
            Logger.warn(
              "[HeroRecruitDialog] SHOW_GET_WAY_DIALOG 失败:",
              e
            );
          }
          return;
        }
        SHOW_PROXY(ItemUseDialog, {
          [ModuleNameItem]: ticketId,
          [ModuleNameCallback]: async (_itemId, count) => {
            if (!recruitModule || !dataIndex) return;
            try {
              const rewards = await recruitModule.sendRecruitHero(
                count,
                dataIndex.EMRecruitReqType.ticket,
                false,
                true
              );
              if (!rewards || !Array.isArray(rewards) || rewards.length === 0) {
                return;
              }
              const onlyNonHero = !ResourceType || rewards.every(
                (r) => r.type !== ResourceType.HERO
              );
              if (onlyNonHero && ItemRewardsDialog && uiIndex.SHOW_DIALOG_DEFERRED) {
                await uiIndex.SHOW_DIALOG_DEFERRED(
                  ItemRewardsDialog,
                  { rewards }
                );
                return;
              }
              if (rewards.length === 1 && ResourceType && rewards[0].type === ResourceType.HERO && GetHeroDialog) {
                const params = {
                  [GetHeroDialog.OP_HERO_ID]: rewards[0].itemId,
                  skin: true
                };
                if (uiIndex.SHOW_SIMPLE_DIALOG) {
                  await uiIndex.SHOW_SIMPLE_DIALOG(
                    GetHeroDialog,
                    params
                  );
                } else {
                  SHOW_PROXY(GetHeroDialog, params);
                }
                return;
              }
              if (HeroRecruitTenResultDialog) {
                SHOW_PROXY(HeroRecruitTenResultDialog, {
                  result: rewards,
                  recruitNumber: count,
                  byClub: false
                });
              }
            } catch (e) {
              Logger.warn(
                "[HeroRecruitDialog] 展示聚合招募结果失败:",
                e
              );
            }
          }
        });
      }, this);
    };
    return true;
  }
  function handler$3(mod) {
    try {
      const HeroTrainDialog = mod?.HeroTrainDialog;
      if (!HeroTrainDialog?.prototype) return false;
      const proto = HeroTrainDialog.prototype;
      const originalOnUpgradeStar = proto._onUpgradeStar;
      proto._onUpgradeStar = function() {
        try {
          const LanguageExt = window.__require("LanguageExt") || {};
          const GET_CONTENT = LanguageExt.GET_CONTENT || ((k) => k);
          const Tips = window.__require("TipsManager") || {};
          const SHOW_TIP = Tips.SHOW_TIP || Logger.warn;
          const hero = this._currentHero || this.model?.get?.("hero") || this.hero;
          if (!hero) return originalOnUpgradeStar?.call(this);
          try {
            if (typeof hero.isHeroMaxStar === "function" && hero.isHeroMaxStar()) {
              SHOW_TIP(GET_CONTENT("10028", "已达到最高星级"));
              return;
            }
          } catch {
          }
          const ModuleManager = window.__require("ModuleManager");
          const Configs = window.__require("Configs");
          const modHero = ModuleManager?.GET_MODULE?.(Configs?.ModuleType?.HERO);
          if (!modHero) return originalOnUpgradeStar?.call(this);
          let need = 0;
          try {
            if (typeof modHero?.getHeroStarSpendQuantity === "function") {
              need = modHero.getHeroStarSpendQuantity(hero.color, hero.star);
            } else {
              const starSpendConf = Configs?.HeroStarSpend?.getById?.(hero.color);
              need = starSpendConf?.starSpend?.[hero.star] || 0;
            }
          } catch {
          }
          const pieceNum = typeof window.ROLE?.getItemQuantity === "function" ? window.ROLE.getItemQuantity(hero.heroFragmentId) : 0;
          try {
            if (need > pieceNum && typeof modHero.getHeroFragmentExchangePackId === "function" && modHero.getHeroFragmentExchangePackId(hero.heroId) !== -1) {
              return this._tryHeroExchange?.();
            }
          } catch {
          }
          const fn = modHero.sendHeroUpgradeStarToMax;
          if (typeof fn === "function") return fn.call(modHero, hero.heroId);
          return originalOnUpgradeStar?.call(this);
        } catch (e) {
          Logger.warn("[HeroTrainDialog] _onUpgradeStar hook error:", e);
          try {
            return originalOnUpgradeStar?.call(this);
          } catch {
          }
        }
      };
      return true;
    } catch (e) {
      Logger.warn("[HeroTrainDialog] hook setup error:", e);
      return false;
    }
  }
  function handler$2(mod) {
    try {
      const HeroStarUpSuccessDialog = mod?.HeroStarUpSuccessDialog;
      if (!HeroStarUpSuccessDialog?.prototype) return false;
      const proto = HeroStarUpSuccessDialog.prototype;
      const originalOnShow = proto.onShow;
      proto.onShow = async function(...args) {
        const ret = await originalOnShow?.apply(this, args);
        try {
          const UIHelper = window.__require("UIHelper")?.UIHelper;
          const model = this.model;
          const view = this.ui;
          if (!model || !view) return ret;
          const preStar = model.get?.("__preHeroStar");
          const curStar = model.get?.("__curHeroStar");
          if (typeof preStar === "number" && preStar >= 0 && view?.m_preStars) {
            try {
              if (UIHelper?.showHeroStar) {
                UIHelper.showHeroStar(view.m_preStars, preStar, true);
              } else if (view.m_preStars?.numItems !== void 0) {
                view.m_preStars.numItems = preStar;
              }
            } catch {
            }
          }
          if (typeof curStar === "number" && curStar >= 0 && view?.m_curStars) {
            try {
              if (UIHelper?.showHeroStar) {
                UIHelper.showHeroStar(view.m_curStars, curStar);
              } else if (view.m_curStars?.numItems !== void 0) {
                view.m_curStars.numItems = curStar;
              }
            } catch {
            }
          }
        } catch (e) {
          Logger.warn("[HeroStarUpSuccessDialog] onShow hook error:", e);
        }
        return ret;
      };
      return true;
    } catch (e) {
      Logger.warn("[HeroStarUpSuccessDialog] hook setup error:", e);
      return false;
    }
  }
  function handler$1(mod) {
    const HeroAttributeToolTip = mod.HeroAttributeToolTip;
    HeroAttributeToolTip.prototype._showAttr = function(item, attrKey, hero) {
      const LanguageExt = window.__require("LanguageExt").LanguageExt;
      const Configs = window.__require("Configs");
      const BattleAttributeKey = Configs.BattleAttributeKey;
      let attrName = LanguageExt.getAttributeName(attrKey);
      if (attrKey === BattleAttributeKey.RAGE_R) {
        attrName = "减怒免疫";
      }
      let valueText = "";
      switch (attrKey) {
        case BattleAttributeKey.ATTACK:
          valueText = String(hero.calculateAttack);
          break;
        case BattleAttributeKey.DEFENSE:
          valueText = String(hero.calculateDefense);
          break;
        case BattleAttributeKey.SPEED:
          valueText = String(hero.calculateSpeed);
          break;
        case BattleAttributeKey.HP:
          valueText = String(hero.calculateHp);
          break;
        default: {
          const rawValue = hero.attribute.get(attrKey) || 0;
          valueText = `${(Math.round(rawValue * 1e4) / 100).toFixed(
            1
          )}%`;
        }
      }
      item.m_attrName.text = attrName;
      item.m_value.text = String(valueText);
    };
    HeroAttributeToolTip.prototype.onShow = function() {
      const ui = this.ui;
      const model = this.model;
      let hero = void 0;
      let heroId = 0;
      const OP_HERO_ID = HeroAttributeToolTip.OP_HERO_ID || "OP_HERO_ID";
      heroId = model.get(OP_HERO_ID) || 0;
      if (heroId !== 0) {
        const role = this.role;
        hero = role.getHeroById(heroId) || null;
      } else {
        hero = model.get("hero");
      }
      ui.onceClick(this.close, this);
      const Configs = window.__require("Configs");
      const ConstantConf = Configs.ConstantConf;
      const basicAttrs = ConstantConf.config.basicBattleAttribute;
      const advanceAttrs = [
        55,
        56,
        61,
        62,
        51,
        52,
        57,
        58,
        59,
        60,
        64,
        63,
        54,
        53,
        101,
        102,
        78,
        68,
        79,
        69,
        80,
        70,
        65,
        66,
        67,
        71,
        301,
        303,
        226,
        227,
        228,
        229,
        230,
        231
      ];
      const attrList = ui.m_attr;
      const advanceList = ui.m_advanceAttr;
      attrList.numItems = basicAttrs.length;
      advanceList.numItems = advanceAttrs.length;
      for (let i = 0; i < basicAttrs.length; i++) {
        const key = basicAttrs[i];
        const row = attrList.getChildAt(i);
        row.m_state.selectedPage = "base";
        this._showAttr(row, key, hero);
      }
      for (let i = 0; i < advanceAttrs.length; i++) {
        const key = advanceAttrs[i];
        const row = advanceList.getChildAt(i);
        row.m_state.selectedPage = "advance";
        this._showAttr(row, key, hero);
      }
      attrList.scrollPane.touchEffect = false;
      attrList.scrollPane.bouncebackEffect = false;
      attrList.scrollPane.mouseWheelEnabled = false;
      attrList.scrollPane.scrollBarDisplay = 0;
      advanceList.scrollPane.touchEffect = false;
      advanceList.scrollPane.bouncebackEffect = false;
      advanceList.scrollPane.mouseWheelEnabled = false;
      advanceList.scrollPane.scrollBarDisplay = 0;
      advanceList.ensureBoundsCorrect();
      const advanceOldHeight = advanceList.height;
      advanceList.height = advanceList.scrollPane.contentHeight;
      const advanceDelta = advanceList.height - advanceOldHeight;
      const bg1 = ui.getChild("n9");
      bg1.height = bg1.height + advanceDelta;
      return;
    };
    return true;
  }
  function handler(mod) {
    const RecruitModule = mod?.RecruitModule;
    if (!RecruitModule?.prototype) return false;
    const proto = RecruitModule.prototype;
    const originalSendRecruitHero = proto.sendRecruitHero;
    proto.sendRecruitHero = async function(recruitNumber, recruitType, byClub = false, showResult = false) {
      const dataIndex = window.__require("data-index");
      if (!recruitNumber || !dataIndex || recruitType !== dataIndex.EMRecruitReqType.ticket) {
        return await originalSendRecruitHero.call(this, recruitNumber, recruitType, byClub, showResult);
      }
      Logger.log("[RecruitModule] sendRecruitHero split", { recruitNumber, recruitType, byClub, showResult });
      const HeroService = dataIndex.HeroService;
      const DateUtil = window.__require("DateUtil")?.default;
      const Configs = window.__require("Configs");
      const ResourceType = Configs?.ResourceType;
      if (!HeroService) {
        Logger.warn("[RecruitModule] HeroService 缺失，回退原始 sendRecruitHero");
        return await originalSendRecruitHero.call(this, recruitNumber, recruitType, byClub, showResult);
      }
      let remaining = recruitNumber;
      const allRewards = [];
      let lastCD = 0;
      while (remaining > 0) {
        const cur = remaining >= 10 ? 10 : 1;
        const resp = await HeroService.recruit({ recruitNumber: cur, recruitType, byClub });
        if (resp && resp.code) {
          Logger.warn("[RecruitModule] Recruit 请求失败，提前结束");
          return;
        }
        const data = resp.getData();
        const rewards = data && data.reward || [];
        lastCD = data?.cDTime || 0;
        if (Array.isArray(rewards)) allRewards.push(...rewards);
        remaining -= cur;
      }
      if (DateUtil && typeof lastCD === "number") {
        this.nextRecruitTime = DateUtil.serverTime + lastCD * 1e3;
      }
      if (!showResult) return;
      if (ResourceType) {
        const heroes = allRewards.filter((r) => r?.type === ResourceType.HERO);
        const others = allRewards.filter((r) => r?.type !== ResourceType.HERO);
        const mergedOthers = mergeRewards(others);
        return heroes.concat(mergedOthers);
      }
      return mergeRewards(allRewards);
    };
    return true;
  }
  installUserscriptFeature({
    key: "hero",
    name: "英雄增强",
    handlers: {
      HeroModule: handler$6,
      HeroBookPanel: handler$5,
      HeroRecruitDialog: handler$4,
      HeroTrainDialog: handler$3,
      HeroStarUpSuccessDialog: handler$2,
      HeroAttributeToolTip: handler$1,
      RecruitModule: handler
    }
  });
})();

//# sourceURL=武将增强.js