// ==UserScript==
// @name         战斗基础增强
// @namespace    https://xyzw.local/userscripts/battle-base
// @version      0.1.0
// @description  安装战斗工厂和战斗飘字显示相关基础增强。
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
  function handler$1(mod) {
    const BattleManager = mod?.BattleManager;
    if (!BattleManager) return false;
    const proto = BattleManager.prototype;
    proto.startHeadlessBattleById = function(battleData, role, autoAttack = false, autoAttackInterval = 0.5) {
      const { BattleDataOption } = window.__require("battle-data");
      const { DecimalNumber } = window.__require("decimal-number");
      const DateUtil = window.__require("DateUtil");
      const autoSpeed = battleData.options.getExt(
        BattleDataOption.AutoSpeed,
        100
      );
      const scale = DecimalNumber.toFixed(autoSpeed / 100, 2);
      const battle = this.startMultiRolePushLevelBattleById(
        battleData,
        role,
        /*autoAttack*/
        autoAttack,
        /*autoAttackInterval*/
        autoAttackInterval,
        /*timeScale*/
        scale,
        /*noRender*/
        true
      );
      battle.syncTime = () => DateUtil.serverTime;
      battle.startBattle();
      return battle;
    };
    proto.runHeadlessBattleByIdForResult = function(battleData, role, autoAttack = false, autoAttackInterval = 0.5) {
      const battle = this.startHeadlessBattleById(
        battleData,
        role,
        autoAttack,
        autoAttackInterval
      );
      return new Promise((resolve) => {
        battle.BattleEndSignal.once((isWin) => {
          const result = battle.getBattleResult(isWin);
          this.quitBattleById(battleData.id);
          resolve(result);
        });
        battle.quickBattle();
      });
    };
    proto.tryBattle = async function(battleData, yieldTimes = 16) {
      const { ServerBattleLauncher } = window.__require("launcher-server");
      const PromiseUtil = window.__require("PromiseUtil").default;
      if (!ServerBattleLauncher) {
        console.error("[tryBattle] ServerBattleLauncher not found");
        return null;
      }
      const launcher = new ServerBattleLauncher();
      launcher.initialize();
      const config = {
        noRender: true
        // 不渲染画面
      };
      const battle = launcher.createBattleById({
        battleData,
        timeScale: 200,
        // 200倍速
        extend: config
      });
      let currentTime = Date.now();
      let result = null;
      battle.BattleResult.add((battleResult) => {
        result = battleResult;
        battle.endBattle();
      });
      battle.startBattle();
      let yieldCounter = 0;
      while (!battle.isQuitted) {
        battle.update(currentTime);
        currentTime += 20;
        if (++yieldCounter >= yieldTimes) {
          yieldCounter = 0;
          await PromiseUtil?.wait?.(0);
        }
      }
      return result;
    };
    BattleManager.buildBattleTeamFromRole = function() {
      const { BattleTeam, Fighter } = window.__require("data-index");
      const { ActorType } = window.__require("battle-data");
      const { DecimalNumber } = window.__require("decimal-number");
      const { WeaponActiveConf, AuraConf, ConstantConf } = window.__require("Configs");
      const roleData = window.ROLE;
      if (!BattleTeam || !Fighter || !ActorType || !roleData) return null;
      const battleTeam = new BattleTeam();
      battleTeam.roleId = roleData?.roleId;
      battleTeam.power = roleData?.power ?? 0;
      battleTeam.legionName = "";
      battleTeam.tapAttack = roleData?.lord?.tapAttack ?? 0;
      battleTeam.name = roleData?.name ?? "";
      battleTeam.headImg = roleData?.headImg ?? "";
      battleTeam.avatarFrame = roleData.avatarFrame;
      const weaponId = roleData?.lordWeaponId ?? 0;
      battleTeam.weaponId = weaponId;
      let activeLevelId = 0;
      const lordWeaponInfo = roleData?.lordWeapon?.get?.(weaponId);
      const weaponLevel = lordWeaponInfo?.level ?? 1;
      const hit = WeaponActiveConf?.list?.find(
        (row) => row?.weaponId === weaponId && row?.weaponLevel === weaponLevel
      );
      if (hit?.id) activeLevelId = hit.id;
      battleTeam.weaponActiveLevelId = activeLevelId;
      battleTeam.lordSkinId = roleData?.lordSkinId ?? 0;
      const pet = roleData?.pet;
      battleTeam.petId = pet?.petId ?? 0;
      battleTeam.petUId = pet?.petUId ?? "";
      battleTeam.petActiveSkillId = pet?.petActiveSkillId ?? 0;
      battleTeam.petPassiveSkillIds = pet?.petPassiveSkillIds ?? [];
      battleTeam.team = /* @__PURE__ */ new Map();
      if (Array.isArray(roleData?.lord?.levelWeaponSkillId)) {
        battleTeam.levelWeaponSkillId.push(
          ...roleData.lord.levelWeaponSkillId
        );
      }
      const heroesMap = roleData?.heroes;
      const battleTeamMap = roleData?.battleTeam;
      if (!heroesMap || !battleTeamMap?.forEach) return battleTeam;
      const auraMap = /* @__PURE__ */ new Map();
      const auraStar = ConstantConf?.config?.auraStar ?? 0;
      const auraColor = ConstantConf?.config?.auraColor ?? [];
      battleTeamMap.forEach((teamHero) => {
        const heroId = teamHero?.heroId;
        const heroData = heroesMap.get?.(heroId);
        if (!heroData) return;
        const star = heroData.star ?? 0;
        const color = heroData.color ?? 0;
        const club = heroData.config?.club ?? heroData.club ?? 0;
        if (star >= auraStar && auraColor.includes(color)) {
          const currentCount = auraMap.get(club) ?? 0;
          auraMap.set(club, currentCount + 1);
        }
      });
      let activeClub = 0;
      let activeCount = 0;
      auraMap.forEach((count, club) => {
        if (count >= 3 && count > activeCount) {
          activeClub = club;
          activeCount = count;
        }
      });
      let auraAttrs = [];
      if (activeClub > 0 && activeCount >= 3 && AuraConf?.list) {
        const auraNum = Math.min(activeCount, 5);
        const auraConfig = AuraConf.list.find(
          (c) => c.club === activeClub && c.auraNum === auraNum
        );
        if (auraConfig?.attrs) {
          auraAttrs = auraConfig.attrs;
        }
      }
      battleTeamMap.forEach((teamHero, index) => {
        const heroId = teamHero?.heroId;
        const heroData = heroesMap.get?.(heroId);
        if (!heroData) return;
        const fighter = new Fighter();
        fighter.id = heroId;
        fighter.type = ActorType?.Hero ?? 0;
        fighter.index = index;
        fighter.level = heroData.level ?? 1;
        fighter.attack = heroData.attack ?? 0;
        fighter.defense = heroData.defense ?? 0;
        fighter.curHp = heroData.hp ?? 0;
        fighter.hp = heroData.hp ?? 0;
        fighter.curEnergy = -1;
        fighter.speed = heroData.speed ?? 0;
        fighter.color = heroData.color ?? 0;
        fighter.star = heroData.star ?? 0;
        fighter.order = heroData.order ?? 0;
        fighter.attribute = /* @__PURE__ */ new Map();
        fighter.skin = (heroData.curUseSkin ?? 0) > 0 ? heroData.curUseSkin : 0;
        if (heroData.star >= heroData.config.awakeActiveCondition) {
          fighter.activeSkill = heroData.config.awakeActive;
        } else {
          fighter.activeSkill = heroData.config.active;
        }
        fighter.skill = [];
        heroData.attribute?.forEach?.((value, key) => {
          const v = typeof DecimalNumber?.toFixed === "function" ? DecimalNumber.toFixed(value, 4) : Math.round(Number(value) * 1e4) / 1e4;
          fighter.attribute.set(key, v);
        });
        for (const attr of auraAttrs) {
          const attrType = attr.type;
          const attrValue = attr.value;
          const currentValue = fighter.attribute.get(attrType) ?? 0;
          const newValue = typeof DecimalNumber?.toFixed === "function" ? DecimalNumber.toFixed(currentValue + attrValue, 4) : Math.round((currentValue + attrValue) * 1e4) / 1e4;
          fighter.attribute.set(attrType, newValue);
        }
        for (const s of heroData?.skill || []) {
          if (s?.active) fighter.skill.push(s.skillId);
        }
        for (const s of heroData?.appendSkill || []) {
          if (s?.active) fighter.skill.push(s.skillId);
        }
        battleTeam.team.set(
          index,
          fighter
        );
      });
      return battleTeam;
    };
    proto.buildBattleTeamFromRole = function() {
      return BattleManager.buildBattleTeamFromRole?.();
    };
    return true;
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
  const FLY_EDGE_COLOR = "#3F110D";
  const FLY_FONT_SIZE = 30;
  const FLY_STROKE = 3;
  const FLY_SHADOW_OFFSET_Y = 3;
  const ORIGINAL_FLY_UI_NAMES = [
    "FlyDamage",
    "FlyTreatment",
    "FlyCrit",
    "FlyBlock",
    "FlyBleed",
    "FlyPoison",
    "FlyBurn",
    "FlyTerrifying",
    "FlyTongxin",
    "FlyHelp",
    "FlyTieXue",
    "FlyQingNang",
    "FlyRende",
    "FlyXuanJi",
    "FlyJianDan"
  ];
  function handler(mod) {
    const SystemEffect = mod.SystemEffect;
    const proto = SystemEffect.prototype;
    const originalOnEntityAdded = proto.onEntityAdded;
    proto.onEntityAdded = function patchedOnEntityAdded(entity, group) {
      const Configs = window.__require("Configs");
      const BattleTypes = window.__require("types-battle");
      const CommonTypes = window.__require("types-common");
      const FguiObjectPool = window.__require("FguiObjectPool").FguiObjectPool;
      const CompTransform = window.__require("comp-transform").CompTransform;
      const CompDestroy = window.__require("comp-destroy").CompDestroy;
      const CompFlyEffect = window.__require("comp-fly-effect").CompFlyEffect;
      const damageType = Configs.DamageType;
      if (group !== this.groups[0]) {
        originalOnEntityAdded.call(this, entity, group);
        return;
      }
      const flyTypeLabelMap = {
        [damageType.DAMAGE]: "伤害",
        [damageType.TREATMENT]: "治疗",
        [damageType.CRIT]: "暴击",
        [damageType.BLOCK]: "格挡",
        [damageType.BLEED]: "流血",
        [damageType.POISON]: "中毒",
        [damageType.BURN]: "灼烧",
        [damageType.TERRIFYING]: "恐惧",
        [damageType.TONGXIN]: "同心",
        [damageType.HELP]: "协力",
        [damageType.TIEXUE]: "铁血",
        [damageType.QINGNANG]: "青囊",
        [damageType.RENDE]: "仁德",
        [damageType.XUANJI]: "璇玑",
        [damageType.JIANDAN]: "剑胆"
      };
      const defaultFlyColor = "#FEF7B8";
      const flyColorMap = {
        [damageType.DAMAGE]: defaultFlyColor,
        [damageType.TREATMENT]: "#BADE55",
        [damageType.CRIT]: "#F19A42",
        [damageType.BLOCK]: "#F0D753",
        [damageType.BLEED]: "#E34A32",
        [damageType.POISON]: "#A748F0",
        [damageType.BURN]: "#EE7C3D",
        [damageType.TERRIFYING]: "#F3B03D",
        [damageType.TONGXIN]: "#F3B03D",
        [damageType.HELP]: "#F3B03D",
        [damageType.TIEXUE]: "#F3B03D",
        [damageType.QINGNANG]: "#F3B03D",
        [damageType.RENDE]: "#F3B03D",
        [damageType.XUANJI]: "#F3B03D",
        [damageType.JIANDAN]: "#F3B03D"
      };
      const edgeColor = cc.color(FLY_EDGE_COLOR);
      const flyEffect = entity.getComponent(CompFlyEffect);
      const originalFlyText = `${flyEffect.floatString || ""}`;
      const originalFlyValue = !originalFlyText || originalFlyText === "i" ? 0 : Number(originalFlyText[0] === "+" || originalFlyText[0] === "s" ? originalFlyText.slice(1) : originalFlyText) || 0;
      const safeValue = Math.max(0, Math.ceil(Math.abs(originalFlyValue)));
      flyEffect.floatString = safeValue <= 0 ? "免疫" : `${flyTypeLabelMap[flyEffect.type] || "伤害"}${typeof Number.abridge === "function" ? Number.abridge(safeValue) : `${safeValue}`}`;
      const displayHandle = FguiObjectPool.create(
        CommonTypes.ConstantURI.UIBattle,
        ORIGINAL_FLY_UI_NAMES[flyEffect.type] || "FlyDamage",
        CommonTypes.BundleName.UI
      );
      const display = displayHandle.ui;
      flyEffect.display = displayHandle;
      this.world.addToLayer(display, BattleTypes.BattleLayer.FlyEffect);
      display.sortingOrder = flyEffect.type === damageType.BLEED || flyEffect.type === damageType.BURN || flyEffect.type === damageType.POISON || flyEffect.type === damageType.TERRIFYING ? 1e3 : 0;
      const numberField = display.m_number;
      numberField.visible = true;
      numberField.alpha = 1;
      numberField.touchable = false;
      numberField.font = null;
      numberField.text = flyEffect.floatString;
      numberField.color = cc.color(flyColorMap[flyEffect.type] || defaultFlyColor);
      numberField.fontSize = FLY_FONT_SIZE;
      numberField.bold = true;
      numberField.stroke = FLY_STROKE;
      numberField.strokeColor = edgeColor;
      numberField.shadowColor = edgeColor;
      numberField.shadowOffset = cc.v2(0, FLY_SHADOW_OFFSET_Y);
      const transform = entity.getComponent(CompTransform);
      flyEffect.setPosition(transform.position.x, transform.position.y);
      const entityId = entity.ID;
      display.m_start.play(() => {
        if (entity.isDestroyed || entity.ID !== entityId) {
          return false;
        }
        entity.addComponent(CompDestroy);
        return true;
      }, 1, flyEffect.delay);
    };
    Logger.log("[system-effect] 战斗飘字显示 Hook 已安装");
    return true;
  }
  installUserscriptFeature({
    key: "battle-base",
    name: "战斗基础增强",
    handlers: {
      "manager-factory": handler$1,
      "system-effect": handler
    }
  });
})();

//# sourceURL=飘字优化增强.jsࠡ