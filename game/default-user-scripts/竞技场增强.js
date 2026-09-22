// ==UserScript==
// @name         竞技场增强
// @namespace    https://xyzw.local/userscripts/arena
// @version      0.1.0
// @description  增强竞技场、战斗详情和防守阵容查看能力。
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
  function handler$4(mod) {
    const ArenaBattleDialog = mod?.ArenaBattleDialog;
    if (!ArenaBattleDialog?.prototype) return false;
    const proto = ArenaBattleDialog.prototype;
    const originalRefreshItem = proto._refreshSingleListItem;
    if (typeof proto._refreshList === "function") {
      proto._refreshList = function(refresh = false) {
        const dialog = this;
        const token = Number(dialog.__arenaTeamTypeRefreshToken || 0) + 1;
        dialog.__arenaTeamTypeRefreshToken = token;
        dialog.roleList = void 0;
        try {
          if (dialog?.ui?.m_roleList) dialog.ui.m_roleList.numItems = 0;
        } catch {
        }
        const Configs = window.__require("Configs");
        const ModuleManager = window.__require("ModuleManager");
        const LanguageExt = window.__require("LanguageExt");
        const { SHOW_TIP } = window.__require("TipsManager");
        const arenaMod = ModuleManager?.GET_MODULE?.(Configs?.ModuleType?.ARENA);
        Promise.resolve(arenaMod?.sendGetTarget?.(refresh)).then(async (resp) => {
          if (!resp) return;
          const roleList = resp.getData?.().roleList;
          if (!Array.isArray(roleList)) return;
          for (let i = 0; i < roleList.length; i++) {
            const score = roleList[i]?.score;
            if (typeof score === "number") {
              roleList[i].score = Math.floor(score);
            }
            roleList[i].teamTypeText = null;
          }
          if (arenaMod?.loadArenaOpponentTeamSummary) {
            await Promise.allSettled(
              roleList.map(async (role) => {
                await Promise.race([
                  Promise.resolve(arenaMod.loadArenaOpponentTeamSummary(role)),
                  new Promise((resolve) => setTimeout(resolve, 1200))
                ]);
                if (role.teamTypeText == null) role.teamTypeText = "未知";
              })
            );
          }
          if (dialog.__arenaTeamTypeRefreshToken !== token) return;
          dialog.roleList = roleList;
          dialog._refreshCost?.();
          if (refresh) {
            try {
              SHOW_TIP?.(
                LanguageExt?.GET_CONTENT?.("CODE_ArenaRefreshSuccess") || "刷新成功"
              );
            } catch {
            }
          }
        }).catch(() => {
          if (dialog.__arenaTeamTypeRefreshToken !== token) return;
          dialog.roleList = void 0;
        }).finally(() => {
          if (dialog.__arenaTeamTypeRefreshToken !== token) return;
          try {
            if (dialog?.ui?.m_roleList) {
              dialog.ui.m_roleList.numItems = dialog.roleList?.length || 0;
              dialog.ui.m_roleList.refreshVirtualList?.();
            }
          } catch {
          }
        });
      };
    }
    if (typeof originalRefreshItem === "function") {
      proto._refreshSingleListItem = function(index, item) {
        try {
          originalRefreshItem.call(this, index, item);
        } catch {
        }
        try {
          const roleData = this?.roleList && this.roleList[index];
          if (!roleData || !item || !item.m_scoreLbl) return;
          const g = window.fgui;
          const ccNS = window.cc;
          const COLORS = {
            known: 16765286,
            unknown: 10526880
          };
          const setColor = (lbl, hex) => {
            try {
              if (ccNS?.Color) {
                const r = hex >> 16 & 255;
                const gch = hex >> 8 & 255;
                const b = hex & 255;
                lbl.color = new ccNS.Color(r, gch, b, 255);
                return;
              }
            } catch {
            }
            try {
              lbl.color = hex;
            } catch {
            }
          };
          let infoLbl = item.m_teamTypeLbl || item.m_winRateLbl;
          if (!infoLbl) {
            infoLbl = new g.GTextField();
            infoLbl.touchable = false;
            infoLbl.text = "";
            const host = item;
            host.addChild(infoLbl);
            item.m_teamTypeLbl = infoLbl;
            item.m_winRateLbl = infoLbl;
            try {
              infoLbl.width = Math.max(Number(item.m_scoreLbl.width || 0), 110);
            } catch {
            }
            try {
              const baseSize = item.m_scoreLbl.fontSize || 18;
              infoLbl.fontSize = Math.max(14, Math.floor(baseSize * 1.1));
            } catch {
            }
            try {
              infoLbl.align = "center";
            } catch {
            }
            setColor(infoLbl, COLORS.unknown);
            try {
              if (typeof infoLbl.stroke === "number") infoLbl.stroke = 2;
              if (typeof infoLbl.strokeColor !== "undefined" && ccNS?.Color) {
                infoLbl.strokeColor = new ccNS.Color(0, 0, 0, 160);
              }
            } catch {
            }
            try {
              infoLbl.ubbEnabled = false;
            } catch {
            }
          }
          const placeLabel = () => {
            try {
              const sx = item.m_scoreLbl.x + item.m_scoreLbl.width / 2 - (infoLbl.width || 0) / 2;
              const sy = item.m_scoreLbl.y - infoLbl.height - 2;
              if (typeof infoLbl.setXY === "function") infoLbl.setXY(sx, sy);
              else {
                infoLbl.x = sx;
                infoLbl.y = sy;
              }
            } catch {
            }
          };
          const setLabel = () => {
            const teamTypeText = roleData?.teamTypeText;
            if (teamTypeText != null && teamTypeText !== "") {
              infoLbl.text = String(teamTypeText);
              infoLbl.visible = true;
              setColor(
                infoLbl,
                teamTypeText === "未知" ? COLORS.unknown : COLORS.known
              );
              placeLabel();
            } else {
              infoLbl.text = "";
              infoLbl.visible = false;
            }
          };
          setLabel();
        } catch {
        }
      };
    }
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
  function convertFighterToHero(fighter) {
    if (!fighter) return null;
    const skinMap = /* @__PURE__ */ new Map();
    if (fighter.skin && fighter.skin !== 0) {
      skinMap.set(fighter.skin, {
        skinId: fighter.skin,
        name: "",
        setNameTime: 0,
        setNameCnt: 0,
        expiration: -1
      });
    }
    return {
      heroId: fighter.id || 0,
      level: fighter.level || 0,
      order: fighter.order || 0,
      star: fighter.star || 0,
      color: fighter.color || 0,
      skinId: fighter.skin || 0,
      power: 0,
      attack: fighter.attack || 0,
      defense: fighter.defense || 0,
      hp: fighter.hp || 0,
      speed: fighter.speed || 0,
      curHp: fighter.curHp || 0,
      curEnergy: fighter.curEnergy || 0,
      attribute: fighter.attribute || /* @__PURE__ */ new Map(),
      equipment: /* @__PURE__ */ new Map(),
      battleTeamSlot: fighter.index || 0,
      isActive: false,
      skill: fighter.skill || [],
      activeSkill: fighter.activeSkill || 0,
      awakeSkill: /* @__PURE__ */ new Map(),
      appendSkill: [],
      useSkin: fighter.skin || 0,
      skin: skinMap,
      recordFlag: fighter.recordFlag || false,
      // 其他字段使用默认值
      artifactId: 0,
      pearlId: 0,
      attachmentUid: 0,
      trumpId: 0,
      transTrumpId: 0,
      attackExt: 0,
      defenseExt: 0,
      hpExt: 0,
      bookStar: 0,
      bookLevel: 0,
      bookValue: 0,
      bookAttack: 0,
      bookHp: 0,
      forbidSNTime: 0
    };
  }
  function convertTeamInfo(fighterMap) {
    const heroMap = /* @__PURE__ */ new Map();
    if (fighterMap && fighterMap.forEach) {
      fighterMap.forEach((fighter, key) => {
        const hero = convertFighterToHero(fighter);
        if (hero) {
          heroMap.set(key, hero);
        }
      });
    }
    return heroMap;
  }
  const TeamTag = {
    // 特殊标签
    UNKNOWN: "未知",
    // 五武将组合
    SHI_DIAN: "十殿",
    // 黄月英+曹仁+张角+诸葛亮+太史慈
    // 双武将组合
    LVZHAO: "吕赵",
    // 吕布+赵云
    LVHUATUO: "吕佗",
    // 吕布+华佗
    ZHUGE_COUPLE: "诸葛夫妇",
    // 诸葛亮+黄月英
    DUBAO: "毒爆",
    // 张角+华佗
    // 三武将组合
    SAN_SHU: "三蜀",
    // 诸葛亮+黄月英+赵云
    LU_SU_WU: "鲁肃吴",
    // 周瑜+孙策+太史慈+鲁肃
    CAO_REN_WU: "曹仁吴",
    // 周瑜+孙策+太史慈+曹仁
    WU_GUO: "吴国",
    // 周瑜+孙策+太史慈
    // 单武将标签
    DIANWEI: "典韦",
    JIANGWEI: "姜维",
    SIMA: "司马懿",
    GUANYU: "关羽",
    ZHOUYU: "周瑜",
    LVBU: "吕布",
    ZHAOYUN: "赵云",
    HUATUO: "华佗",
    ZHANGJIAO: "张角",
    ZHUGELIANG: "诸葛亮",
    SUNCE: "孙策",
    HUANGYUEYING: "黄月英",
    TAISHICI: "太史慈"
  };
  const defaultRules = [
    // 五武将组合（权重最高）
    { tag: TeamTag.SHI_DIAN, weight: 120, conditions: [
      { type: "hasHero", heroName: "黄月英" },
      { type: "hasHero", heroName: "曹仁" },
      { type: "hasHero", heroName: "张角" },
      { type: "hasHero", heroName: "诸葛亮" },
      { type: "hasHero", heroName: "太史慈" }
    ] },
    // 吴国细分组合（高权重）
    { tag: TeamTag.LU_SU_WU, weight: 110, conditions: [
      { type: "hasHero", heroName: "周瑜" },
      { type: "hasHero", heroName: "孙策" },
      { type: "hasHero", heroName: "太史慈" },
      { type: "hasHero", heroName: "鲁肃" }
    ] },
    { tag: TeamTag.CAO_REN_WU, weight: 110, conditions: [
      { type: "hasHero", heroName: "周瑜" },
      { type: "hasHero", heroName: "孙策" },
      { type: "hasHero", heroName: "太史慈" },
      { type: "hasHero", heroName: "曹仁" }
    ] },
    // 三武将组合（高权重）
    { tag: TeamTag.SAN_SHU, weight: 100, conditions: [
      { type: "hasHero", heroName: "诸葛亮" },
      { type: "hasHero", heroName: "黄月英" },
      { type: "hasHero", heroName: "赵云" }
    ] },
    { tag: TeamTag.WU_GUO, weight: 100, conditions: [
      { type: "hasHero", heroName: "周瑜" },
      { type: "hasHero", heroName: "孙策" },
      { type: "hasHero", heroName: "太史慈" }
    ] },
    // 双武将组合（中等权重）
    { tag: TeamTag.DUBAO, weight: 80, conditions: [
      { type: "hasHero", heroName: "张角" },
      { type: "hasHero", heroName: "华佗" }
    ] },
    { tag: TeamTag.LVHUATUO, weight: 80, conditions: [
      { type: "hasHero", heroName: "吕布" },
      { type: "hasHero", heroName: "华佗" }
    ] },
    { tag: TeamTag.LVZHAO, weight: 80, conditions: [
      { type: "hasHero", heroName: "吕布" },
      { type: "hasHero", heroName: "赵云" }
    ] },
    { tag: TeamTag.ZHUGE_COUPLE, weight: 80, conditions: [
      { type: "hasHero", heroName: "诸葛亮" },
      { type: "hasHero", heroName: "黄月英" }
    ] },
    // 单武将标签（较低权重）
    { tag: TeamTag.DIANWEI, weight: 50, conditions: [
      { type: "hasHero", heroName: "典韦" }
    ] },
    { tag: TeamTag.JIANGWEI, weight: 50, conditions: [
      { type: "hasHero", heroName: "姜维" }
    ] },
    { tag: TeamTag.SIMA, weight: 50, conditions: [
      { type: "hasHero", heroName: "司马懿" }
    ] },
    { tag: TeamTag.GUANYU, weight: 50, conditions: [
      { type: "hasHero", heroName: "关羽" }
    ] },
    { tag: TeamTag.ZHOUYU, weight: 50, conditions: [
      { type: "hasHero", heroName: "周瑜" }
    ] },
    { tag: TeamTag.LVBU, weight: 50, conditions: [
      { type: "hasHero", heroName: "吕布" }
    ] },
    { tag: TeamTag.ZHAOYUN, weight: 50, conditions: [
      { type: "hasHero", heroName: "赵云" }
    ] },
    { tag: TeamTag.ZHUGELIANG, weight: 50, conditions: [
      { type: "hasHero", heroName: "诸葛亮" }
    ] },
    { tag: TeamTag.HUANGYUEYING, weight: 50, conditions: [
      { type: "hasHero", heroName: "黄月英" }
    ] },
    { tag: TeamTag.HUATUO, weight: 50, conditions: [
      { type: "hasHero", heroName: "华佗" }
    ] },
    { tag: TeamTag.ZHANGJIAO, weight: 50, conditions: [
      { type: "hasHero", heroName: "张角" }
    ] },
    { tag: TeamTag.SUNCE, weight: 50, conditions: [
      { type: "hasHero", heroName: "孙策" }
    ] },
    { tag: TeamTag.TAISHICI, weight: 50, conditions: [
      { type: "hasHero", heroName: "太史慈" }
    ] }
  ];
  let activeRules = [...defaultRules];
  defaultRules.map((r) => r.tag);
  Array.from(
    new Set(defaultRules.map((rule) => rule.tag))
  ).filter((tag) => tag !== TeamTag.UNKNOWN);
  const heroNameToIdCache = /* @__PURE__ */ new Map();
  const getConfigs = () => window.__require("Configs");
  const getGET_CONTENT = () => window.__require("LanguageExt")?.GET_CONTENT;
  const getHeroIdsByName = (name) => {
    if (heroNameToIdCache.has(name)) return heroNameToIdCache.get(name);
    const Configs = getConfigs();
    const GET_CONTENT = getGET_CONTENT();
    if (!Configs?.HeroConf?.list || !GET_CONTENT) return [];
    const ids = [];
    for (const hero of Configs.HeroConf.list) {
      const heroName = GET_CONTENT(hero.nickName);
      if (heroName && heroName.includes(name)) {
        ids.push(hero.id);
      }
    }
    heroNameToIdCache.set(name, ids);
    if (ids.length > 0) Logger.log(`[TeamDetector] 英雄名称 "${name}" -> ID: [${ids.join(",")}]`);
    return ids;
  };
  const buildContext = (teamInfo) => {
    const Configs = getConfigs();
    const heroIds = [];
    const clubCount = /* @__PURE__ */ new Map();
    teamInfo.forEach((hero) => {
      if (!hero?.heroId) return;
      heroIds.push(hero.heroId);
      const heroConf = Configs?.HeroConf?.getById?.(hero.heroId);
      if (heroConf?.club) {
        clubCount.set(heroConf.club, (clubCount.get(heroConf.club) || 0) + 1);
      }
    });
    return { heroIds, clubCount, heroCount: heroIds.length };
  };
  const checkCondition = (cond, ctx) => {
    switch (cond.type) {
      case "hasHero":
        return getHeroIdsByName(cond.heroName).some((id) => ctx.heroIds.includes(id));
      case "clubCount": {
        const count = ctx.clubCount.get(cond.club) || 0;
        if (cond.min !== void 0 && count < cond.min) return false;
        if (cond.max !== void 0 && count > cond.max) return false;
        return true;
      }
      case "heroCount": {
        if (cond.min !== void 0 && ctx.heroCount < cond.min) return false;
        if (cond.max !== void 0 && ctx.heroCount > cond.max) return false;
        return true;
      }
    }
  };
  const matchRule = (rule, ctx) => rule.conditions.every((cond) => checkCondition(cond, ctx));
  const detectTeamTags = (teamInfo) => {
    if (!teamInfo || teamInfo.size === 0) return [TeamTag.UNKNOWN];
    const ctx = buildContext(teamInfo);
    const matchedTags = [];
    for (const rule of activeRules) {
      if (matchRule(rule, ctx)) {
        matchedTags.push(rule.tag);
      }
    }
    return matchedTags.length > 0 ? matchedTags : [TeamTag.UNKNOWN];
  };
  const detectPrimaryTag = (teamInfo) => {
    const tags = detectTeamTags(teamInfo);
    return tags[0];
  };
  function summarizeTeamInfo(teamInfo) {
    if (!(teamInfo instanceof Map)) {
      return { teamType: "", lossCount: 0, text: "" };
    }
    const teamType = detectPrimaryTag(teamInfo) || TeamTag.UNKNOWN;
    const lossCount = Math.max(0, 5 - teamInfo.size);
    const parts = [teamType];
    if (lossCount > 0) {
      parts.push(`掉${lossCount}`);
    }
    return {
      teamType,
      lossCount,
      text: parts.filter(Boolean).join(" ")
    };
  }
  function handler$3(mod) {
    const ArenaModule = mod?.ArenaModule;
    if (!ArenaModule?.prototype) return false;
    const proto = ArenaModule.prototype;
    proto.loadArenaOpponentTeamSummary = async function(role) {
      if (!role?.roleId) return null;
      const roleId = role.roleId;
      if (!this.__arenaOpponentTeamSummaryCache) {
        this.__arenaOpponentTeamSummaryCache = /* @__PURE__ */ new Map();
      }
      const cache = this.__arenaOpponentTeamSummaryCache;
      const applySummaryToRole = (summary2) => {
        role.teamTypeText = summary2.text;
        return summary2;
      };
      const buildSummary = (teamInfo2) => {
        const fighterMap = teamInfo2?.team instanceof Map ? teamInfo2.team : null;
        const battleTeam = fighterMap ? convertTeamInfo(fighterMap) : /* @__PURE__ */ new Map();
        const summary2 = summarizeTeamInfo(battleTeam);
        const teamType = summary2.teamType || TeamTag.UNKNOWN;
        return {
          roleId,
          teamType,
          text: teamType,
          heroCount: battleTeam.size,
          lossCount: summary2.lossCount
        };
      };
      const cached = cache.get(roleId);
      if (cached) {
        return applySummaryToRole(cached);
      }
      const { EMTeamType } = window.__require("data-index");
      const { GET_MODULE } = window.__require("ModuleManager");
      const { ModuleType } = window.__require("Configs");
      const RankModule = GET_MODULE(ModuleType.RANK);
      const respTeam = await RankModule.sendGetRoleTeam(
        roleId,
        EMTeamType.areaArena
      );
      if (!respTeam || respTeam.code) {
        return applySummaryToRole({
          roleId,
          teamType: TeamTag.UNKNOWN,
          text: TeamTag.UNKNOWN,
          heroCount: 0,
          lossCount: 0
        });
      }
      const teamPayload = respTeam.getData?.() ?? respTeam;
      const teamInfo = teamPayload?.teamInfo ?? teamPayload;
      const summary = buildSummary(teamInfo);
      cache.set(roleId, summary);
      applySummaryToRole(summary);
      Logger.log("[Arena] Opponent team summary", {
        roleId,
        name: role?.info?.name,
        teamType: summary.teamType,
        heroCount: summary.heroCount,
        lossCount: summary.lossCount
      });
      return summary;
    };
    return true;
  }
  function handler$2(mod) {
    const ArenaDetailsDialog = mod?.ArenaDetailsDialog;
    if (!ArenaDetailsDialog?.prototype) return false;
    const proto = ArenaDetailsDialog.prototype;
    const originalOnAwake = proto.onAwake;
    const originalOnShow = proto.onShow;
    if (typeof proto.getBattleTeam !== "function") {
      proto.getBattleTeam = function(roleId) {
        try {
          const consts = window.__require("consts");
          const ModelConst = consts?.ModelConst || {};
          const model = this.model;
          const input = model?.get?.(ModelConst.INPUT_BATTLE_UI_DATA);
          const battleData = input?.battleData;
          const left = battleData?.leftTeam;
          const right = battleData?.rightTeam;
          if (left && right) return left.roleId === roleId ? left : right;
        } catch {
        }
        return void 0;
      };
    }
    proto.onAwake = function() {
      try {
        const dialog = this;
        const ui = dialog.ui;
        const Configs = window.__require("Configs");
        const UIHelper = window.__require("UIHelper")?.UIHelper;
        const MathUtil = window.__require("MathUtil")?.MathUtil;
        const resolveHero = (info, isSelf) => {
          try {
            const roleId = isSelf ? dialog?.selfInfo?.roleId : dialog?.oppoInfo?.roleId;
            const teamMap = dialog?.getBattleTeam?.(roleId)?.team;
            let matched = teamMap?.get?.(info?.slot);
            if (!matched && teamMap) {
              matched = Array.from(teamMap.values?.() || [])?.find?.((e) => e?.id === info?.heroId);
            }
            const HDVMod = window.__require("HeroDataView");
            const HeroDataView = HDVMod?.HeroDataView || HDVMod?.HeroSeasonDataView;
            return HeroDataView?.createByHero?.(matched);
          } catch {
          }
          return null;
        };
        const showHeroTip = (hero) => {
          try {
            const uiIndex = window.__require("index-ui");
            const showDialog = uiIndex?.SHOW_DIALOG_DEFERRED || uiIndex?.SHOW_SIMPLE_DIALOG;
            const tipMod = window.__require("HeroAttributeToolTip");
            const HeroAttributeToolTip = tipMod?.HeroAttributeToolTip;
            showDialog?.(HeroAttributeToolTip, { [HeroAttributeToolTip.OP_HERO_ID]: 0, hero });
          } catch {
          }
        };
        const setupInfoButton = (item, index, isSelf) => {
          try {
            let btn = item.m_btnInfo;
            if (!btn) {
              const g = window.fgui;
              btn = g?.UIPackage?.createObject?.("ui_common", "BtnInfo")?.asButton;
              if (!btn && g && g.GButton) {
                try {
                  btn = new g.GButton();
                } catch {
                }
              }
              const host2 = item.m_hero || item;
              btn?.setScale?.(1.5, 1.5);
              host2?.addChild?.(btn);
              item.m_btnInfo = btn;
              item.m_btnInfoHost = host2;
            }
            btn?.clearClick?.();
            btn?.onClick?.((ev) => {
              try {
                ev?.stopPropagation?.();
              } catch {
              }
              const info = isSelf ? dialog?.selfInfo?.teamInfo?.[index] : dialog?.oppoInfo?.teamInfo?.[index];
              const hero = resolveHero(info, isSelf);
              showHeroTip(hero);
            });
            const host = item.m_hero || item;
            if (btn?.parent !== host) {
              try {
                btn?.removeFromParent?.();
              } catch {
              }
              host?.addChild?.(btn);
            }
            const px = (host?.width || 0) - (btn?.width || 0) / 2;
            const py = 0;
            if (typeof btn?.setXY === "function") btn.setXY(px, py);
            else {
              if (btn) {
                btn.x = px;
                btn.y = py;
              }
            }
          } catch {
          }
        };
        const ResourceType = Configs?.ResourceType;
        if (!ui) return;
        try {
          const list = ui?.m_selfInfo?.m_teamList;
          if (list) {
            list.itemRenderer = (index, item) => {
              item.m_isMe.selectedPage = "true";
              item.m_bg.selectedIndex = index % 2;
              const one = dialog?.selfInfo?.teamInfo?.[index];
              if (!one) return;
              item.m_damageLbl.text = one.damage;
              item.m_treatmentLbl.text = one.treatment;
              item.m_takeDamageLbl.text = one.takeDamage;
              item.m_treatmentPercent.m_color.selectedPage = "green";
              item.m_takeDamagePercent.m_color.selectedPage = "red";
              item.m_treatmentPercent._barObjectH = item.m_treatmentPercent.getChild("green");
              item.m_takeDamagePercent._barObjectH = item.m_takeDamagePercent.getChild("red");
              item.m_damagePercent.value = MathUtil?.calcBattleDetailValue?.(one.damage, dialog.totalPercent?.[0]);
              item.m_treatmentPercent.value = MathUtil?.calcBattleDetailValue?.(one.treatment, dialog.totalPercent?.[1]);
              item.m_takeDamagePercent.value = MathUtil?.calcBattleDetailValue?.(one.takeDamage, dialog.totalPercent?.[2]);
              try {
                item.m_hero.m_type.selectedPage = String(ResourceType?.HERO);
              } catch {
              }
              UIHelper?.showHeroIconFromDetail?.(
                item?.m_hero?.m_hero,
                one.heroId,
                false,
                one.level,
                one.color,
                one.star,
                one.skin && one.skin > 0 ? one.skin : one.heroId
              );
              const hero = resolveHero(one, true);
              const speed = hero ? hero.speed : 0;
              if (hero && speed !== 0) {
                setupInfoButton(item, index, true);
              } else if (item.m_btnInfo) {
                try {
                  item.m_btnInfo.removeFromParent?.();
                } catch {
                }
                item.m_btnInfo = null;
                item.m_btnInfoHost = null;
              }
            };
          }
        } catch {
        }
        try {
          const list = ui?.m_oppoInfo?.m_teamList;
          if (list) {
            list.itemRenderer = (index, item) => {
              item.m_isMe.selectedPage = "false";
              item.m_bg.selectedIndex = index % 2;
              const one = dialog?.oppoInfo?.teamInfo?.[index];
              if (!one) return;
              item.m_damageLbl.text = one.damage;
              item.m_treatmentLbl.text = one.treatment;
              item.m_takeDamageLbl.text = one.takeDamage;
              item.m_treatmentPercent.m_color.selectedPage = "green";
              item.m_takeDamagePercent.m_color.selectedPage = "red";
              item.m_treatmentPercent._barObjectH = item.m_treatmentPercent.getChild("green");
              item.m_takeDamagePercent._barObjectH = item.m_takeDamagePercent.getChild("red");
              item.m_damagePercent.value = MathUtil?.calcBattleDetailValue?.(one.damage, dialog.totalPercent?.[0]);
              item.m_treatmentPercent.value = MathUtil?.calcBattleDetailValue?.(one.treatment, dialog.totalPercent?.[1]);
              item.m_takeDamagePercent.value = MathUtil?.calcBattleDetailValue?.(one.takeDamage, dialog.totalPercent?.[2]);
              try {
                item.m_hero.m_type.selectedPage = String(ResourceType?.HERO);
              } catch {
              }
              UIHelper?.showHeroIconFromDetail?.(
                item?.m_hero?.m_hero,
                one.heroId,
                false,
                one.level,
                one.color,
                one.star,
                one.skin && one.skin > 0 ? one.skin : one.heroId
              );
              const hero = resolveHero(one, false);
              const speed = hero ? hero.speed : 0;
              if (hero && speed !== 0) {
                setupInfoButton(item, index, false);
              } else if (item.m_btnInfo) {
                try {
                  item.m_btnInfo.removeFromParent?.();
                } catch {
                }
                item.m_btnInfo = null;
                item.m_btnInfoHost = null;
              }
            };
          }
        } catch {
        }
        return;
      } catch (e) {
        Logger.warn("[ArenaDetailsDialog] onAwake hook error:", e);
        try {
          originalOnAwake?.call(this);
        } catch {
        }
      }
    };
    proto.onShow = async function() {
      try {
        const dialog = this;
        const ui = dialog.ui;
        const model = dialog.model;
        const uiIndex = window.__require("index-ui");
        const Configs = window.__require("Configs");
        const ModuleManager = window.__require("ModuleManager");
        const UIHelper = window.__require("UIHelper")?.UIHelper;
        const consts = window.__require("consts");
        if (!ui || !model) return;
        const ModelConst = consts?.ModelConst || {};
        const ModuleType = Configs?.ModuleType || {};
        try {
          const canShare = !!ModuleManager?.IS_UNLOCKED?.(ModuleType?.SHARE);
          const input = model.get(ModelConst.INPUT_BATTLE_UI_DATA);
          if (canShare && input) model.set("buttonType", "shareAndReplay");
          else if (input) model.set("buttonType", "replay");
          else if (canShare) model.set("buttonType", "share");
          else model.set("buttonType", "none");
        } catch {
        }
        let record = model.get("record");
        if (!record) return;
        if (typeof record === "string") {
          try {
            record = JSON.parse(record);
          } catch {
          }
        }
        try {
          ui?.m_shareBtn?.onClick?.(dialog._onShare, dialog);
        } catch {
        }
        try {
          ui?.m_replayBtn?.onClick?.(dialog._onReplay, dialog);
        } catch {
        }
        try {
          dialog.getComponent?.(uiIndex?.UIWindow)?.skin?.m_mask?.onClick?.(dialog.close, dialog);
        } catch {
        }
        dialog.selfInfo = record?.sponsor;
        dialog.oppoInfo = record?.accept;
        dialog.totalPercent = [1, 1, 1];
        try {
          const left = dialog?.selfInfo?.teamInfo || [];
          const right = dialog?.oppoInfo?.teamInfo || [];
          for (let i = 0; i < left.length; i++) {
            const e = left[i];
            if (!e) continue;
            if (e.damage >= dialog.totalPercent[0]) dialog.totalPercent[0] = e.damage;
            if (e.treatment >= dialog.totalPercent[1]) dialog.totalPercent[1] = e.treatment;
            if (e.takeDamage >= dialog.totalPercent[2]) dialog.totalPercent[2] = e.takeDamage;
          }
          for (let i = 0; i < right.length; i++) {
            const e = right[i];
            if (!e) continue;
            if (e.damage >= dialog.totalPercent[0]) dialog.totalPercent[0] = e.damage;
            if (e.treatment >= dialog.totalPercent[1]) dialog.totalPercent[1] = e.treatment;
            if (e.takeDamage >= dialog.totalPercent[2]) dialog.totalPercent[2] = e.takeDamage;
          }
        } catch {
        }
        const ROLE = window.ROLE || {};
        try {
          const isWin = !!record?.isWin;
          const left = ui?.m_selfInfo;
          if (left) {
            left.m_isMe.selectedPage = "true";
            left.m_result.selectedPage = isWin ? "victory" : "defeat";
            left.m_nameLbl.text = ROLE?.name ?? "";
            UIHelper?.setHeadIcon?.(left?.m_head?.m_headIcon, ROLE?.headImg, ROLE?.roleId, ROLE?.avatarFrame, true);
          }
          const report = ModuleManager?.GET_MODULE?.(ModuleType?.BATTLEREPORT);
          try {
            const selfInfo = await report?.getReportRoleInfo?.(dialog.selfInfo);
            if (selfInfo && left) {
              left.m_nameLbl.text = selfInfo.name;
              UIHelper?.setHeadIcon?.(left.m_head?.m_headIcon, selfInfo.headImg, selfInfo.roleId, selfInfo.avatarFrame, true);
            }
          } catch {
          }
          const right = ui?.m_oppoInfo;
          try {
            const oppoInfo = await report?.getReportRoleInfo?.(dialog.oppoInfo);
            if (oppoInfo && right) {
              right.m_nameLbl.text = oppoInfo.name;
              UIHelper?.setHeadIcon?.(right.m_head?.m_headIcon, oppoInfo.headImg, oppoInfo.roleId, oppoInfo.avatarFrame, true);
              dialog.roleInfo = oppoInfo;
            }
          } catch {
          }
          if (right) {
            right.m_isMe.selectedPage = "false";
            right.m_result.selectedPage = isWin ? "defeat" : "victory";
          }
          if (left) left.m_teamList.numItems = dialog?.selfInfo?.teamInfo?.length || 0;
          if (right) right.m_teamList.numItems = dialog?.oppoInfo?.teamInfo?.length || 0;
        } catch {
        }
        try {
          if (ui?.m_id) ui.m_id.text = `ID:${record?.id || 0}`;
        } catch {
        }
        return;
      } catch (e) {
        Logger.warn("[ArenaDetailsDialog] onShow hook error:", e);
        try {
          return await originalOnShow?.call(this);
        } catch {
        }
      }
    };
    return true;
  }
  function handler$1(mod) {
    const ArenaOtherDefenseTeamDialog = mod?.ArenaOtherDefenseTeamDialog;
    if (!ArenaOtherDefenseTeamDialog?.prototype) return false;
    const proto = ArenaOtherDefenseTeamDialog.prototype;
    const originalOnShow = proto.onShow;
    proto.onShow = function() {
      try {
        const dialog = this;
        const ui = dialog.ui;
        const model = dialog.model;
        const uiIndex = window.__require("index-ui");
        const Configs = window.__require("Configs");
        const Lang = window.__require("LanguageExt");
        const ModuleManager = window.__require("ModuleManager");
        const UIHelper = window.__require("UIHelper")?.UIHelper;
        const AvatarConfExt = window.__require("AvatarConfExt")?.AvatarConfExt;
        const consts = window.__require("consts");
        const HeroDataViewMod = window.__require("HeroDataView");
        const tipMod = window.__require("HeroAttributeToolTip");
        const HeroDataView = HeroDataViewMod?.HeroDataView || HeroDataViewMod?.HeroSeasonDataView;
        const HeroAttributeToolTip = tipMod?.HeroAttributeToolTip;
        const showHeroTip = (heroObj) => {
          try {
            const showDialog = uiIndex?.SHOW_DIALOG_DEFERRED || uiIndex?.SHOW_SIMPLE_DIALOG;
            showDialog?.(HeroAttributeToolTip, { hero: heroObj });
          } catch {
          }
        };
        const setupInfoButton = (host, onClick) => {
          try {
            if (!host) return;
            let btn = host.m_btnInfo;
            if (!btn) {
              const g = window.fgui;
              btn = g?.UIPackage?.createObject?.("ui_common", "BtnInfo")?.asButton || new g.GButton();
              host.addChild?.(btn);
              host.m_btnInfo = btn;
            }
            btn?.clearClick?.();
            btn?.onClick?.((ev) => {
              try {
                ev?.stopPropagation?.();
              } catch {
              }
              onClick?.();
            });
            if (btn?.parent !== host) {
              btn?.removeFromParent?.();
              host?.addChild?.(btn);
            }
            const px = (host?.width || 0) - (btn?.width || 0) / 2;
            const py = 0;
            if (typeof btn?.setXY === "function") btn.setXY(px, py);
            else {
              if (btn) {
                btn.x = px;
                btn.y = py;
              }
            }
          } catch {
          }
        };
        const OP_TEAM_INFO = ArenaOtherDefenseTeamDialog.OP_TEAM_INFO || "teamInfo";
        const OP_TITLE = ArenaOtherDefenseTeamDialog.OP_TITLE || "opTitle";
        const payload = model.get(OP_TEAM_INFO);
        if (!payload) {
          dialog.close?.();
          return;
        }
        const defaultTitle = Lang?.GET_CONTENT?.("CODE_ArenaDefenseTeamTitle");
        const extTitle = model.get(OP_TITLE);
        model.set(uiIndex?.ConstName?.Title, extTitle ?? defaultTitle);
        const info = payload.teamInfo;
        UIHelper?.setHeadIcon?.(ui?.m_headIcon?.m_headIcon, info.headImg, info.roleId);
        if (ui?.m_playerName) ui.m_playerName.text = info.name;
        try {
          ui?.m_headIcon?.clearClick?.();
          ui?.m_headIcon?.onClick?.(() => {
            ModuleManager?.GET_MODULE?.(Configs?.ModuleType?.RANK)?.showRoleInfo?.(
              info.roleId
            );
          });
        } catch {
        }
        try {
          const serverLegion = Lang?.SERVER_NAME_INFO?.(
            "CODE_NameWithServer",
            payload.serverId,
            info.legionName
          );
          if (ui?.m_legionName)
            ui.m_legionName.text = info.legionName ? serverLegion : "";
        } catch {
        }
        try {
          if (ui?.m_power)
            ui.m_power.text = String.format(
              "{0}{1}",
              Lang?.GET_CONTENT?.("C2_Tower_CONST1"),
              Number.abridge(info.power)
            );
        } catch {
        }
        try {
          const HERO_MAX_SLOT = consts?.HERO_MAX_SLOT ?? 5;
          for (let i = 0; i < HERO_MAX_SLOT; i++) {
            const slot = dialog._heroSlots?.[i];
            if (!slot) continue;
            slot.m_color.selectedPage = "0";
            slot.m_slot.m_color.selectedPage = "0";
            slot.m_slot.m_icon.url = "";
            slot.m_slot.m_showStars.selectedPage = "0";
            slot.m_slot.m_showLevel.selectedPage = "0";
            slot.m_slot.m_club.selectedPage = "0";
          }
        } catch {
        }
        try {
          ModuleManager?.GET_MODULE?.(Configs?.ModuleType?.HERO);
        } catch {
        }
        try {
          const entries = Array.from(info.team);
          for (let i = 0; i < entries.length; i++) {
            const slotIndex = entries[i][0];
            const hero = entries[i][1];
            const heroConf = Configs?.HeroConf?.getById?.(hero.id);
            if (!heroConf) continue;
            let name = "";
            try {
              const getName = HeroDataView?.getHeroName || HeroDataView?.getName;
              name = getName?.(hero, hero.skinName) ?? "";
            } catch {
            }
            const slot = dialog._heroSlots?.[slotIndex];
            if (!slot) continue;
            if (slot.m_skinName) slot.m_skinName.text = name;
            if (slot.m_slot?.m_level) slot.m_slot.m_level.text = "" + hero.level;
            if (slot.m_slot?.m_club)
              slot.m_slot.m_club.selectedIndex = heroConf.club;
            if (slot.m_color) slot.m_color.selectedPage = "" + heroConf.color;
            if (slot.m_slot?.m_color)
              slot.m_slot.m_color.selectedPage = "" + heroConf.color;
            if (slot.m_slot?.m_showStars)
              slot.m_slot.m_showStars.selectedPage = "1";
            if (slot.m_slot?.m_showLevel)
              slot.m_slot.m_showLevel.selectedPage = "1";
            const baseAvatarId = AvatarConfExt?.getAvatarId?.(hero.id, true);
            const finalSkinId = hero.skin > 0 ? hero.skin : baseAvatarId;
            const avatarConf = Configs?.AvatarConf?.getById?.(finalSkinId);
            UIHelper?.showHeroStar?.(slot.m_slot?.m_stars, hero.star);
            UIHelper?.setIcon?.(slot.m_slot?.m_icon, avatarConf?.headIcon);
            try {
              const host = slot?.m_slot || slot;
              const heroView = HeroDataView?.createByHero ? HeroDataView.createByHero(hero) : hero;
              setupInfoButton(host, () => showHeroTip(heroView));
            } catch {
            }
          }
        } catch {
        }
      } catch (e) {
        Logger.warn("[ArenaOtherDefenseTeamDialog] onShow hook error:", e);
        try {
          originalOnShow?.call(this);
        } catch {
        }
      }
    };
    return true;
  }
  function handler(mod) {
    const RankModule = mod?.RankModule;
    if (!RankModule?.prototype) return false;
    const proto = RankModule.prototype;
    const originalSendGetRoleTeam = proto.sendGetRoleTeam;
    if (typeof originalSendGetRoleTeam === "function") {
      proto.sendGetRoleTeam = function(targetId, teamType, cCMonsterId = 0) {
        const numericId = Number(targetId);
        if (Number.isFinite(numericId) && numericId > 0 && numericId <= 999) {
          const teamInfo = {
            roleId: numericId,
            teamType,
            cCMonsterId,
            name: "",
            power: 0,
            weaponId: 0,
            legionName: "",
            team: /* @__PURE__ */ new Map()
          };
          const payload = { teamInfo };
          return Promise.resolve({
            code: 0,
            teamInfo,
            getData: () => payload
          });
        }
        return originalSendGetRoleTeam.call(
          this,
          targetId,
          teamType,
          cCMonsterId
        );
      };
    }
    proto.sendPlayerDuelPVPBattle = function(targetId) {
      return new Promise((resolve) => {
        const { FightService } = window.__require("data-index");
        const { GET_BATTLE_VERSION } = window.__require("PlatformManager");
        FightService.startPVP({
          targetId,
          battleVersion: GET_BATTLE_VERSION()
        }).then(async (resp) => {
          if (resp.code) {
            resolve(null);
            return;
          }
          const data = resp.getData();
          const { EMTeamType } = window.__require("data-index");
          const ModuleManager = window.__require("ModuleManager") || {};
          const Configs = window.__require("Configs") || {};
          const ModuleType = Configs?.ModuleType;
          const RankModule2 = ModuleManager.GET_MODULE(ModuleType.RANK);
          const roleTeamResp = await RankModule2.sendGetRoleTeam(
            targetId,
            17
          );
          if (!roleTeamResp.code) {
            const teamInfo = roleTeamResp.teamInfo;
            const rightTeam = data.battleData.rightTeam;
            let outerFieldsMatch = true;
            for (const key of Object.keys(teamInfo)) {
              if (key === "team" || key === "legionName") continue;
              if (JSON.stringify(teamInfo[key]) !== JSON.stringify(rightTeam[key])) {
                outerFieldsMatch = false;
                break;
              }
            }
            if (outerFieldsMatch) {
              let teamFieldsMatch = true;
              const teamInfoTeam = teamInfo.team;
              const rightTeamTeam = rightTeam.team;
              for (const [index, infoFighter] of teamInfoTeam) {
                const rightFighter = rightTeamTeam.get(index);
                if (!rightFighter) {
                  teamFieldsMatch = false;
                  break;
                }
                for (const key of Object.keys(infoFighter)) {
                  if (key === "attribute" || key === "speed")
                    continue;
                  if (JSON.stringify(infoFighter[key]) !== JSON.stringify(rightFighter[key])) {
                    teamFieldsMatch = false;
                    break;
                  }
                }
                if (!teamFieldsMatch) break;
              }
              if (teamFieldsMatch) {
                for (const [index, infoFighter] of teamInfoTeam) {
                  const rightFighter = rightTeamTeam.get(index);
                  if (rightFighter) {
                    rightFighter.attribute = infoFighter.attribute;
                    rightFighter.speed = infoFighter.speed;
                  }
                }
              }
            }
          }
          const { ClientDuelPVPBattle } = window.__require(
            "../battle-client/ClientDuelPVPBattle"
          );
          ClientDuelPVPBattle.startDuelPVPBattle(data.battleData);
          resolve(data);
        });
      });
    };
    return true;
  }
  installUserscriptFeature({
    key: "arena",
    name: "竞技场增强",
    handlers: {
      ArenaBattleDialog: handler$4,
      ArenaModule: handler$3,
      ArenaDetailsDialog: handler$2,
      ArenaOtherDefenseTeamDialog: handler$1,
      RankModule: handler
    }
  });
})();

//# sourceURL=竞技场增强.jsċߥ