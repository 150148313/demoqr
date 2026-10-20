// 皮肤切换 v3.6（内置版）
//
// 核心思路：
//   Phase 1: Hook HeroConf.getById —— 替换 skinList[0] 为目标皮肤
//   Phase 2: 注入所有皮肤到 hero.skin Map + Hook useSkin/skinId getter
//            让游戏对 override 英雄返回 0，强制走 skinList[0] 路径
//   Phase 3: Hook WS sendAsync —— 拦截 hero_useskin 指令（不发服务器）
//            并深度改写所有响应中的 skinId/useSkin 字段（战斗/阵容协议跳过，保护 inputCode）
//            + Hook HeroDataView.getHeroAvatar/getHeroIcon/judgeSkinValid/hasSkin
//   Phase 4: Hook UIHelper.showHero/showHeroNew/showHeroIconFromDetail —— 渲染层把玩家英雄的
//            真实 skin/avatar 重映射为 override 皮肤（纯本地展示）。战斗回包 {id, skin} 参与
//            inputCode 的 MD5，绝不改数据：服务器/战斗引擎仍用原皮肤，仅展示替换，PVP 校验不受影响。
//            覆盖：大厅/阵容/英雄详情/竞技场阵容面板等 UI。
//   Phase 5: Hook BattleAssetManager.loadSpine —— 战斗场作战骨骼小人走独立 ECS，不经 showHero；
//            把真实皮肤 spine 路径换成 override 皮肤路径（英雄 spine 自成 bundle，bundle===path），
//            让战斗动画本身也显示自定义皮肤。同样零改 battleData。
//   Phase 5b: Hook ResourceManager.loadAsset —— 运行时皮肤战斗特效/附属 spine（阵营门控）。
//   Phase 5c: Hook BattleUIManager 预加载 + ClientActorData.getActorAvatar —— loading 阶段按 override
//            avatar 递归 preloadEffects，解决仅换主模型不换特效的问题。
//   【v3.4 回退】真机证明：v3.2 让 getActorAvatar 在"运行时"也换 avatar 身份，会破坏 PVP 确定性回放的数据流
//            读取——第四回合 round 切换时抛 PLAYBACK_READ_ARRAY 的 RangeError(Invalid array length) → 回放
//            错位、战斗数据不对、卡死。根因：avatarId 被回放序列化流读取依赖，运行时改它会让读指针错位。
//            故回退为"仅预载期换 avatar"(v3.1 安全行为)；战斗内模型换肤仍由 Phase5 loadSpine(资源层,回放安全)负责。
//            运行时特效的安全方向：在 loadSpine/Phase7 资源层映射"原特效 spine 路径→override 特效路径"，
//            绝不改 avatarId（待后续按真机日志逐步验证）。v3.3 的 __ycRemapLoadAssetPair 无效组合修复保留。
//   【v3.5 战斗特效】据真机诊断日志确认特效 spine 规律：bundle=英雄基础 spine 名、path=bundle 或 bundle+后缀
//            （如 zhangjiao6/zhangjiao6_attack_loop）。新增 __ycRemapBattleSpine：当 bundle 命中我方覆盖英雄
//            的 spine 映射(X→Y) 时，把 bundle 与 path 一起换为 Y / Y+后缀（zhangjiao6_attack_loop→zhangjiao5_attack_loop），
//            实现运行时大招/命中/攻击特效换肤。纯资源层、bundle+path 一起换（无 v3.2 的无效组合）、不改 avatarId →
//            回放安全；仅命中我方英雄 bundle → 对手不同英雄不受影响。同时保留只读诊断日志便于核对。
//   Phase 6: 归属门控 —— Hook PlayerInfoDialog/PlayerInfoTopDialog，按 model.ROLE_INFO.roleId 区分
//            自己/他人名片；查看他人时置 __yc_skinSuppress=true，渲染他人英雄不换肤（只换自己的）。
//   Phase 7: 战斗阵营门控 —— Hook SystemSkeletonLoader.onEntityAdded；按 battleData 里
//            roleId===ROLE.roleId 的队伍锚定"本方 camp"（不依赖难取的 CampType 枚举），
//            只换本方阵营英雄，对手/敌方走原皮肤。battleData 仍零改动；取不到时安全回退。
//   Phase 8: 主公皮肤 本地 override（装扮 #1） —— Hook ROLE.getRealLordSkinId/realLordSkinId getter。
//   Phase 9: 头像框 本地 override（装扮 #2） —— Hook UIHelper.setHeadIcon(带 roleId)，仅换自己。
//   Phase 10: 竞技场景(pvpMap) + 名片(card) 本地 override（装扮 #3 #4） —— 自己 ROLE getter，不发服务器。
//   Phase 11: 主线/章节战斗场景跟随竞技场景 —— 主线 map=ChapterConf.mapId（不读 pvpMapId）；getMapUrl 在
//             extras 战斗 bundle 闭包无法 require，故 hook 全局 fgui.UIPackage.createObject：竞技场加载 scene 时
//             捕获其 pkg url（pkg 含 override mapId），主线 map 创建时若该包已加载则替换（未加载保持原图，零破坏）。
//   Phase 12: 盐场飞艇(Airship) 本地 override（装扮 #5） —— Hook LegionWarPlayer.airshipBundle，仅换自己。
//   Phase 13: 击杀特效(MultiKill) 本地 override（装扮 #6） —— Hook LegionWarPlayer.multiKillId，仅换自己。
//   Phase 14: 装扮室全解锁（去锁显示） —— Hook 三个 isHas 返回 true：LordSkinDressData(框/名片/飞艇/连杀/场景)、
//             DRV2LordSkinDecoData(主公皮肤)、DRV2ProfileCardDecoData(工牌)。装扮室 m_isLock=(isHas===false)，故去锁。
//   Phase 15: 装扮"本地装备"（参考英雄皮肤 useskin 拦截） —— 解锁后游戏内点装备会 useDress→服务器(未真拥有→报错
//             "显示问题/重启游戏")。拦截三个 useDress：设本地 override + 返回成功(不发服务器)，并 hook getNowUse 让
//             "已装备"标记正确；视觉走各 Phase 的 getter。彻底消除点装备报错。
//   Phase 16: 主公皮肤主界面头像跟随 —— getCurSkinData() 读 realLordSkinId 后做 lordSkin.has() 校验，override 未拥有
//             →返默认。hook getCurSkinData：override 时用游戏自身 getDepotSkinData() 取出有效 skin data 返回，
//             主界面头像/装扮室预览(都走 getCurSkinData)即跟随 override。永远是自己，无需归属门控。
//
// 账号隔离：localStorage key = __h5web_skinOverrides_<roleId>
// 幂等守卫：3 秒内重复注入直接返回
// 开关：由 Android 层 window.__h5web_skinHook 控制

(function() {
  if (window.__h5web_skinHook === false) {
    console.log('[皮肤管理] 功能已关闭，跳过');
    return;
  }

  // 幂等守卫：3 秒时间窗内重复注入拦截（避免闭包实例化多次导致 window.__h5web_skinOverrides 指针被覆盖、面板 ov 引用过时、用户修改丢失）
  try {
    var __ycNow = Date.now();
    if (window.__h5web_skinHookInitTs && (__ycNow - window.__h5web_skinHookInitTs) < 3000) {
      try { console.log('[皮肤管理] 重复注入已拦截 (3s 内, dt=' + (__ycNow - window.__h5web_skinHookInitTs) + 'ms)'); } catch(e) {}
      return;
    }
    window.__h5web_skinHookInitTs = __ycNow;
  } catch(e) {}
  if (window.__h5web_skinHookDone) return;

  var TAG = '[皮肤管理]';

  // === 持久化皮肤覆盖表（账号隔离: key = __h5web_skinOverrides_<roleId>） ===
  var skinOverrides = {};
  var __ycCurRoleId = null;
  var __ycSkinLoaded = false;
  window.__h5web_skinOverrides = skinOverrides;

  function __ycGetSkinKey() {
    if (!__ycCurRoleId) {
      try { if (window.ROLE && window.ROLE.roleId) __ycCurRoleId = window.ROLE.roleId; } catch(e) {}
    }
    return __ycCurRoleId ? ('__h5web_skinOverrides_' + __ycCurRoleId) : null;
  }
  function loadSkinOverrides() {
    if (__ycSkinLoaded) return true;
    var key = __ycGetSkinKey();
    if (!key) return false;
    try {
      var stored = localStorage.getItem(key);
      if (stored) {
        var obj = JSON.parse(stored);
        for (var k in obj) skinOverrides[k] = obj[k];
      }
      __ycSkinLoaded = true;
      window.__h5web_skinCurRoleId = __ycCurRoleId;
      try { console.log(TAG + ' 已加载 roleId=' + __ycCurRoleId + ' count=' + Object.keys(skinOverrides).length + ' key=' + key); } catch(e) {}
    } catch(e) {}
    return __ycSkinLoaded;
  }
  function saveSkinOverrides() {
    var key = __ycGetSkinKey();
    if (!key) return;
    try {
      localStorage.setItem(key, JSON.stringify(skinOverrides));
      try { console.log(TAG + ' 已保存 roleId=' + __ycCurRoleId + ' count=' + Object.keys(skinOverrides).length); } catch(e) {}
    } catch(e) {}
    // override 变更后置脏：Phase4 渲染层反查表需重建（惰性）
    try { window.__h5web_skinToHeroDirty = true; } catch(e) {}
  }
  window.__h5web_loadSkinOverrides = loadSkinOverrides;
  window.__h5web_saveSkinOverrides = saveSkinOverrides;

  // ======== Phase 1: 极早期保存 origGetById 引用 ========
  var phase1Done = false;
  var origGetById = null;
  var phase1Attempts = 0;

  function phase1() {
    phase1Attempts++;
    if (typeof window.__require !== 'function') {
      if (phase1Attempts < 120) setTimeout(phase1, 200);
      return;
    }
    try {
      var rawConfigs = window.__require('Configs');
      var configs = (rawConfigs && (rawConfigs.Configs || rawConfigs.default)) || rawConfigs;
      if (!configs || !configs.HeroConf) {
        if (phase1Attempts < 120) setTimeout(phase1, 200);
        return;
      }
      var sc = configs.HeroConf;
      if (!sc || typeof sc.getById !== 'function') {
        if (phase1Attempts < 120) setTimeout(phase1, 200);
        return;
      }
      // 已 hook 过则恢复原始引用
      if (sc.getById.__skinHooked && sc.getById.__origFn) {
        origGetById = sc.getById.__origFn;
        phase1Done = true;
        return;
      }
      origGetById = sc.getById.bind(sc);

      // Hook HeroConf.getById — 仅替换 skinList 第一项（默认皮肤）为目标皮肤
      sc.getById = function(id) {
        var ret = origGetById(id);
        if (ret && ret.skinList && skinOverrides[id] && !window.__yc_skinSuppress) {
          var copy = Object.assign({}, ret);
          var targetSkin = skinOverrides[id];
          var newList = ret.skinList.slice(0);
          if (newList.length > 0) newList[0] = targetSkin;
          copy.skinList = newList;
          return copy;
        }
        return ret;
      };
      sc.getById.__skinHooked = true;
      sc.getById.__origFn = origGetById;

      phase1Done = true;
    } catch(e) {
      if (phase1Attempts < 120) setTimeout(phase1, 500);
    }
  }

  // ======== Phase 2: skin Map 注入（只等 ROLE） ========
  var phase2Attempts = 0;
  var skinMapDone = false;

  function phase2() {
    phase2Attempts++;
    if (!phase1Done || !origGetById) {
      if (phase2Attempts < 120) setTimeout(phase2, 300);
      return;
    }
    try {
      var ROLE = window.ROLE;
      if (!ROLE || typeof ROLE.getHeroById !== 'function') {
        if (phase2Attempts < 120) setTimeout(phase2, 300);
        return;
      }
      // 账号隔离: ROLE 就绪后加载当前账号的皮肤配置
      if (!loadSkinOverrides()) {
        if (phase2Attempts < 120) setTimeout(phase2, 300);
        return;
      }

      // 确认 ROLE 数据已加载（探测多个常见 ID，避免硬编码）
      var testH = null;
      var probeIds = [101, 103, 107, 108, 110, 201, 205, 301, 305];
      for (var pi = 0; pi < probeIds.length && !testH; pi++) {
        try { var th = ROLE.getHeroById(probeIds[pi]); if (th && th.skin) testH = th; } catch(e) {}
      }
      if (!testH) {
        if (phase2Attempts < 120) setTimeout(phase2, 300);
        return;
      }

      // 确认 HeroConf 数据已加载
      var testConf = null;
      for (var pi2 = 0; pi2 < probeIds.length && !testConf; pi2++) {
        try { var tc = origGetById(probeIds[pi2]); if (tc && tc.skinList) testConf = tc; } catch(e) {}
      }
      if (!testConf) {
        if (phase2Attempts < 120) setTimeout(phase2, 300);
        return;
      }

      var rawConfigs = window.__require('Configs');
      var configs = (rawConfigs && (rawConfigs.Configs || rawConfigs.default)) || rawConfigs;

      // --- 注入所有皮肤到 hero.skin Map + 缓存原始 skinList ---
      window.__h5web_origSkinLists = window.__h5web_origSkinLists || {};
      window.__h5web_origBaseSkins = window.__h5web_origBaseSkins || {};
      var totalInjected = 0;
      var totalHeroes = 0;
      var allHeroIds = [];
      // 动态获取: 从 HeroConf 配置表枚举所有英雄 ID
      try {
        var hc = configs.HeroConf;
        var confSrc = hc._data || hc._map || hc.datas || hc._pool;
        if (!confSrc && typeof hc.getAll === 'function') confSrc = hc.getAll();
        if (confSrc) {
          var ks = (typeof confSrc.keys === 'function') ? Array.from(confSrc.keys()) : Object.keys(confSrc);
          for (var ki = 0; ki < ks.length; ki++) {
            var hid = parseInt(ks[ki]);
            if (!isNaN(hid)) try { if (ROLE.getHeroById(hid)) allHeroIds.push(hid); } catch(e) {}
          }
        }
      } catch(e) {}
      // 兜底: 宽范围扫描（仅当动态枚举失败时）
      if (allHeroIds.length === 0) {
        for (var hi = 100; hi <= 999; hi++) {
          try { if (ROLE.getHeroById(hi)) allHeroIds.push(hi); } catch(e) {}
        }
      }

      for (var idx = 0; idx < allHeroIds.length; idx++) {
        try {
          var hero = ROLE.getHeroById(allHeroIds[idx]);
          if (!hero || !hero.skin) continue;
          var confHero = origGetById(allHeroIds[idx]);
          if (!confHero || !confHero.skinList) continue;
          window.__h5web_origSkinLists[allHeroIds[idx]] = confHero.skinList.slice(0);
          var baseSkinId = confHero.skinList[0];
          window.__h5web_origBaseSkins[allHeroIds[idx]] = baseSkinId;

          var injected = 0;
          for (var si = 0; si < confHero.skinList.length; si++) {
            var sid = confHero.skinList[si];
            if (sid === allHeroIds[idx] || sid === baseSkinId) continue;
            if (hero.skin.has(sid)) continue;
            hero.skin.set(sid, {
              skinId: sid, name: '', setNameTime: 0, setNameCnt: 0, expiration: -1
            });
            injected++;
            totalInjected++;
          }
          if (injected > 0) totalHeroes++;

          // 给 hero 实例装 useSkin/skinId getter — 关键策略:
          // 对 override 英雄返回 0 欺骗游戏走"未选皮肤"路径，让 phase1 的 HeroConf.skinList[0] hook 生效
          var curHid = allHeroIds[idx];
          try {
            if (!hero.hasOwnProperty('__ycHooked')) {
              (function(heroRef, hidRef) {
                var _useSkin = heroRef.useSkin;
                var _skinId = heroRef.skinId;
                // 修正: 服务器 skinId 常为 0, useSkin 才是真实穿戴皮肤
                // 让 _skinId 在为 0 时采用 _useSkin，这样阵容界面读 skinId 能显示正确皮肤
                if (!_skinId && _useSkin && _useSkin > 0) _skinId = _useSkin;
                Object.defineProperty(heroRef, 'useSkin', {
                  get: function() {
                    try {
                      var ov = window.__h5web_skinOverrides || skinOverrides;
                      if (ov && ov[hidRef]) return 0;  // 伪装未选，强制走 skinList[0] 路径
                    } catch(e) {}
                    return _useSkin;
                  },
                  set: function(v) { _useSkin = v; },
                  configurable: true, enumerable: true
                });
                Object.defineProperty(heroRef, 'skinId', {
                  get: function() {
                    try {
                      var ov = window.__h5web_skinOverrides || skinOverrides;
                      if (ov && ov[hidRef]) return 0;  // 同上
                    } catch(e) {}
                    return _skinId;
                  },
                  set: function(v) { _skinId = v; },
                  configurable: true, enumerable: true
                });
                Object.defineProperty(heroRef, '__ycHooked', { value: true, configurable: true });
              })(hero, curHid);
            }
          } catch(e) {}
        } catch(e) {}
      }
      skinMapDone = true;
      window.__h5web_skinReady = true;
      try { console.log(TAG + ' phase2 就绪 roleId=' + __ycCurRoleId + ' scanned=' + allHeroIds.length + ' injectedSkins=' + totalInjected + ' coveredHeroes=' + totalHeroes + ' overrides=' + Object.keys(skinOverrides).length); } catch(e) {}
    } catch(e) {
      if (phase2Attempts < 120) setTimeout(phase2, 500);
    }
  }

  // ======== Phase 3: WS hook（等 ws 就绪） ========
  var phase3Attempts = 0;

  function phase3() {
    phase3Attempts++;
    if (!skinMapDone) {
      if (phase3Attempts < 60) setTimeout(phase3, 1000);
      return;
    }
    try {
      var gameWS = window.ws;
      if (!gameWS || typeof gameWS.sendAsync !== 'function') {
        if (phase3Attempts < 60) setTimeout(phase3, 1000);
        return;
      }
      if (gameWS.sendAsync.__skinHooked) return;

      var rawConfigs = window.__require('Configs');
      var configs = (rawConfigs && (rawConfigs.Configs || rawConfigs.default)) || rawConfigs;

      // Override curUseSkin getter — 绕过 judgeSkinValid 验证
      var ROLE = window.ROLE;
      try {
        var anyHero = null;
        var phIds = [101, 103, 107, 108, 110, 201, 205, 301];
        for (var pi = 0; pi < phIds.length && !anyHero; pi++) {
          try { anyHero = ROLE.getHeroById(phIds[pi]); } catch(e) {}
        }
        if (anyHero) {
          var heroProto = Object.getPrototypeOf(anyHero);
          var cusd = Object.getOwnPropertyDescriptor(heroProto, 'curUseSkin');
          if (cusd && cusd.get && !window.__h5web_curUseSkinOverridden) {
            var origCurUseSkinGetter = cusd.get;
            Object.defineProperty(heroProto, 'curUseSkin', {
              get: function() {
                var hid = this.heroId || this.id || this.roleId || this.oriHeroId || this.heroID;
                if (hid && skinOverrides[hid] && !window.__yc_skinSuppress) {
                  var sid = skinOverrides[hid];
                  this.useSkin = sid;
                  return sid;
                }
                return origCurUseSkinGetter.call(this);
              },
              configurable: true
            });
            window.__h5web_curUseSkinOverridden = true;
          }
        }
      } catch(e) {}

      // Override useSkin — 根治: 拦截游戏读取 useSkin，返回 override 值。
      // 三段式策略: (1) 原型链向上找 getter (2) 原型覆盖 (3) 实例层遍历 defineProperty
      try {
        var anyHeroU = null;
        var phIds2 = [101, 103, 107, 108, 110, 201, 205, 301];
        for (var pi3 = 0; pi3 < phIds2.length && !anyHeroU; pi3++) {
          try { anyHeroU = ROLE.getHeroById(phIds2[pi3]); } catch(e) {}
        }
        if (anyHeroU && !window.__h5web_useSkinOverridden) {
          // 阶段1: 原型链向上查找 useSkin 描述符
          var foundProto = null; var foundDesc = null;
          var cur = anyHeroU;
          var depth = 0;
          while (cur && depth < 6) {
            var p = Object.getPrototypeOf(cur);
            if (!p) break;
            var d = Object.getOwnPropertyDescriptor(p, 'useSkin');
            if (d) { foundProto = p; foundDesc = d; break; }
            cur = p; depth++;
          }

          var hookOkProto = false;
          if (foundDesc && foundDesc.get) {
            var origG = foundDesc.get; var origS = foundDesc.set;
            Object.defineProperty(foundProto, 'useSkin', {
              get: function() {
                try {
                  var hid = this.heroId || this.id || this.roleId || this.oriHeroId || this.heroID;
                  var ov = window.__h5web_skinOverrides || skinOverrides;
                  if (!window.__yc_skinSuppress && hid && ov && ov[hid]) return ov[hid];
                } catch(e) {}
                return origG.call(this);
              },
              set: origS, configurable: true
            });
            hookOkProto = true;
            try { console.log(TAG + ' useSkin 原型 getter 已覆盖 (depth=' + depth + ')'); } catch(e) {}
          }

          // 阶段2: 兜底——无论原型是否成功，都对所有 hero 实例做 defineProperty
          var instOk = 0, instFail = 0, instSkip = 0;
          var heroIds = window.__h5web_origSkinLists ? Object.keys(window.__h5web_origSkinLists) : [];
          for (var hi2 = 0; hi2 < heroIds.length; hi2++) {
            try {
              var hid2 = parseInt(heroIds[hi2]);
              var h = ROLE.getHeroById(hid2);
              if (!h) continue;
              if (h.__ycHooked) { instSkip++; continue; }
              var curVal;
              try { curVal = h.useSkin; } catch(e) { curVal = 0; }
              (function(heroRef, initial) {
                var _val = initial;
                Object.defineProperty(heroRef, 'useSkin', {
                  get: function() {
                    try {
                      var hidInner = heroRef.heroId || heroRef.id;
                      var ov = window.__h5web_skinOverrides || skinOverrides;
                      if (hidInner && ov && ov[hidInner]) return ov[hidInner];
                    } catch(e) {}
                    return _val;
                  },
                  set: function(v) { _val = v; },
                  configurable: true, enumerable: true
                });
              })(h, curVal);
              instOk++;
            } catch(e) { instFail++; }
          }
          window.__h5web_useSkinOverridden = true;
          try { console.log(TAG + ' useSkin 实例覆盖: ok=' + instOk + ' fail=' + instFail + ' skip=' + instSkip + ' protoHook=' + hookOkProto); } catch(e) {}
        }
      } catch(e) {}

      // Override realSkinName getter — 从 SkinConf 取正确皮肤名
      try {
        var anyHero2 = null;
        var phIds3 = [101, 103, 107, 108, 110, 201, 205, 301];
        for (var pi4 = 0; pi4 < phIds3.length && !anyHero2; pi4++) {
          try { anyHero2 = ROLE.getHeroById(phIds3[pi4]); } catch(e) {}
        }
        if (anyHero2) {
          var heroProto2 = Object.getPrototypeOf(anyHero2);
          var rsd = Object.getOwnPropertyDescriptor(heroProto2, 'realSkinName');
          if (rsd && rsd.get && !window.__h5web_realSkinNameOverridden) {
            var origRealSkinNameGetter = rsd.get;
            var SkinConf = configs.SkinConf || null;
            Object.defineProperty(heroProto2, 'realSkinName', {
              get: function() {
                var hid = this.heroId || this.id || this.roleId || this.oriHeroId || this.heroID;
                if (hid && skinOverrides[hid] && SkinConf && !window.__yc_skinSuppress) {
                  try {
                    var si = SkinConf.getById(skinOverrides[hid]);
                    if (si && si.skinName) return si.skinName;
                  } catch(e) {}
                }
                return origRealSkinNameGetter.call(this);
              },
              configurable: true
            });
            window.__h5web_realSkinNameOverridden = true;
          }
        }
      } catch(e) {}

      var origSendAsync = gameWS.sendAsync.bind(gameWS);

      // 战斗/阵容协议：响应内 battleData 以服务器为准，禁止 patch skin（否则 PVP inputCode/outputCode 校验失败、战斗卡死）
      // 跳过 patch 的协议：①战斗/阵容（保护 inputCode）②他人/排行/查看类（不能把别人英雄的 skin 改成我的 override）
      var __ycSkipPatchCmdRe = /(^(fight_|team_|presetteam_|role_gettargetteam|arena_|rank_|legion_|guild_|friend_))|getotherinfo|getroleinfo|gettargetteam|targetteam|peekteam|watchrole|otherrole|otherteam|otherinfo/i;
      var __ycBattleDataKeys = {
        battleData: 1, battleResult: 1, leftTeam: 1, rightTeam: 1,
        sponsor: 1, accept: 1, teamInfo: 1
      };

      function __ycRespHasBattlePayload(obj, depth) {
        if (!obj || typeof obj !== 'object' || depth > 4) return false;
        if (obj.battleData || obj.battleResult) return true;
        try {
          if (typeof obj.getData === 'function') {
            var d = obj.getData();
            if (d && (d.battleData || d.battleResult)) return true;
          }
        } catch(e) {}
        for (var k in obj) {
          if (__ycBattleDataKeys[k] && obj[k] && typeof obj[k] === 'object') return true;
        }
        return false;
      }

      function __ycShouldSkipPatch(cmd, resp) {
        if (cmd && __ycSkipPatchCmdRe.test(cmd)) return true;
        if (resp && __ycRespHasBattlePayload(resp, 0)) return true;
        return false;
      }

      // 深度递归扫描响应数据: 兼容 heroId/hid + useSkin/uSkin/skinId/skin_id + Map 实例 + 多种字段名
      var __ycPatchStats = {};
      var __ycSeenCmds = {};
      function __ycPatchResp(obj, depth, inBattleCtx) {
        if (!obj || typeof obj !== 'object' || depth > 12) return 0;
        inBattleCtx = !!inBattleCtx;
        var hits = 0;
        if (Array.isArray(obj)) {
          for (var ai = 0; ai < obj.length; ai++) hits += __ycPatchResp(obj[ai], depth + 1, inBattleCtx);
          return hits;
        }
        if (typeof Map !== 'undefined' && obj instanceof Map) {
          try {
            obj.forEach(function(v) { hits += __ycPatchResp(v, depth + 1, inBattleCtx); });
          } catch(e) {}
          return hits;
        }
        if (typeof Set !== 'undefined' && obj instanceof Set) return 0;
        if (!inBattleCtx) {
          try {
            var ov = window.__h5web_skinOverrides || skinOverrides;
            var hid = obj.heroId || obj.hid || obj.hero_id || obj.heroID;
            // 战斗数据格式 {id, skin}：仅用于战斗引擎，绝不 patch（见 game.js HeroDataView / SHOW_BATTLE_UI）
            if (!hid && typeof obj.id === 'number' && typeof obj.skin === 'number') {
              var knownHeroIds = window.__h5web_origSkinLists;
              if (knownHeroIds && knownHeroIds.hasOwnProperty(obj.id)) {
                hid = null;
              }
            }
            if (hid && ov && ov[hid]) {
              var target = ov[hid];
              var allowedSkins = (window.__h5web_origSkinLists || {})[hid] || [];
              var skinAllowed = allowedSkins.indexOf(target) >= 0;
              if (skinAllowed) {
                var skinKeys = ['useSkin', 'uSkin', 'skinId', 'skin_id', 'curSkin', 'curUseSkin'];
                for (var ski = 0; ski < skinKeys.length; ski++) {
                  var kk = skinKeys[ski];
                  if (obj[kk] !== undefined && typeof obj[kk] === 'number' && obj[kk] !== target && obj[kk] !== -1) {
                    obj[kk] = target; hits++;
                  }
                }
              }
            }
          } catch(e) {}
        }
        for (var k in obj) {
          if (k === '_t' || k === '_raw' || k === '_sendMsg') continue;
          try {
            if (obj.hasOwnProperty && obj.hasOwnProperty(k) && obj[k] && typeof obj[k] === 'object') {
              hits += __ycPatchResp(obj[k], depth + 1, inBattleCtx || !!__ycBattleDataKeys[k]);
            }
          } catch(e) {}
        }
        return hits;
      }
      window.__h5web_patchSkinResp = __ycPatchResp;
      window.__h5web_shouldSkipSkinPatch = __ycShouldSkipPatch;

      gameWS.sendAsync = function(msg) {
        if (msg && msg.cmd === 'hero_useskin') {
          var heroId = msg.params && msg.params.heroId;
          var newSkinId = msg.params && msg.params.skinId;

          if (heroId && newSkinId !== undefined) {
            // 完全拦截，不发服务器请求
            // 关键: 不修改 hero 实例字段, 保留 _useSkin/_skinId 为玩家原本穿戴的皮肤
            // 这样删除 override 时 getter 回退到原值而非 override 值
            skinOverrides[heroId] = newSkinId;
            saveSkinOverrides();

            return Promise.resolve({code: 0, data: {heroId: heroId, skinId: newSkinId}});
          }
        }
        var cmd = (msg && msg.cmd) || 'unknown';
        if (!__ycSeenCmds[cmd]) {
          __ycSeenCmds[cmd] = true;
        }
        return origSendAsync(msg).then(function(resp) {
          try {
            // 收到"他人资料"响应 → 开启不换肤窗口：渲染他人英雄时不应用 override（防 Phase4 反查表按同 heroId 误换）。
            // 不含 gettargetteam（PVP 战斗前置，避免误伤本方战斗换肤）；进入战斗(Phase7)与名片关闭(Phase6)/超时会清除。
            if (cmd && /getroleinfo|getotherinfo|otherrole/i.test(cmd)) {
              if (!window.__yc_skinSuppress) { try { console.log(TAG + ' 进入他人视图(' + cmd + ') suppress=on'); } catch(e) {} }
              window.__yc_skinSuppress = true;
              try { if (window.__yc_suppressTimer) clearTimeout(window.__yc_suppressTimer); } catch(e) {}
              try { window.__yc_suppressTimer = setTimeout(function() { window.__yc_skinSuppress = false; }, 8000); } catch(e) {}
            }
            if (__ycShouldSkipPatch(cmd, resp)) {
              return resp;
            }
            var hits = __ycPatchResp(resp, 0, false);
            if (hits > 0) {
              __ycPatchStats[cmd] = (__ycPatchStats[cmd] || 0) + hits;
              if (__ycPatchStats[cmd] === hits) {
                try { console.log(TAG + ' 响应已改写 cmd=' + cmd + ' hits=' + hits); } catch(e) {}
              }
            }
          } catch(e) {}
          return resp;
        });
      };
      gameWS.sendAsync.__skinHooked = true;

      // Hook HeroDataView — 根治: 绕过 useSkin 优先逻辑
      try {
        var HDVwrap = window.__require && window.__require('HeroDataView');
        var HDV = (HDVwrap && HDVwrap.HeroDataView) || HDVwrap;

        // getHeroAvatar: 静态优先，原型兜底
        if (HDV && typeof HDV.getHeroAvatar === 'function' && !HDV.getHeroAvatar.__ycGhaHooked) {
          var origGHA = HDV.getHeroAvatar;
          HDV.getHeroAvatar = function(e) {
            try {
              var hid = (typeof e === 'number') ? e : (e && (e.heroId || e.id || e.roleId));
              var ov = window.__h5web_skinOverrides || skinOverrides;
              if (!window.__yc_skinSuppress && hid && ov && ov[hid]) return ov[hid];
            } catch(ex) {}
            return origGHA.apply(this, arguments);
          };
          HDV.getHeroAvatar.__ycGhaHooked = true;
          try { console.log(TAG + ' HeroDataView.getHeroAvatar (static) 已 hook'); } catch(e) {}
        } else if (HDV && HDV.prototype && typeof HDV.prototype.getHeroAvatar === 'function' && !HDV.prototype.getHeroAvatar.__ycGhaHooked) {
          var origGHA2 = HDV.prototype.getHeroAvatar;
          HDV.prototype.getHeroAvatar = function(e) {
            try {
              var hid = (typeof e === 'number') ? e : (e && (e.heroId || e.id || e.roleId));
              var ov = window.__h5web_skinOverrides || skinOverrides;
              if (!window.__yc_skinSuppress && hid && ov && ov[hid]) return ov[hid];
            } catch(ex) {}
            return origGHA2.apply(this, arguments);
          };
          HDV.prototype.getHeroAvatar.__ycGhaHooked = true;
          try { console.log(TAG + ' HeroDataView.prototype.getHeroAvatar 已 hook'); } catch(e) {}
        }

        // judgeSkinValid: 关键: 若游戏拒绝 skinOverrides 的 skinId 导致 fallback，这里强制放行
        if (HDV && typeof HDV.judgeSkinValid === 'function' && !HDV.judgeSkinValid.__ycJsvHooked) {
          var origJSV = HDV.judgeSkinValid;
          HDV.judgeSkinValid = function(heroId, skinId) {
            try {
              var hid = (typeof heroId === 'number') ? heroId : (heroId && (heroId.heroId || heroId.id));
              var sid = (typeof skinId === 'number') ? skinId : (skinId && (skinId.skinId || skinId.id));
              var ov = window.__h5web_skinOverrides || skinOverrides;
              if (hid && ov && ov[hid] && (sid === ov[hid] || sid === undefined)) return true;
            } catch(ex) {}
            return origJSV.apply(this, arguments);
          };
          HDV.judgeSkinValid.__ycJsvHooked = true;
          try { console.log(TAG + ' judgeSkinValid 已 hook'); } catch(e) {}
        }

        // getHeroIcon: 仿 getHeroAvatar
        if (HDV && typeof HDV.getHeroIcon === 'function' && !HDV.getHeroIcon.__ycGhiHooked) {
          var origGHI = HDV.getHeroIcon;
          HDV.getHeroIcon = function(e) {
            try {
              var hid = (typeof e === 'number') ? e : (e && (e.heroId || e.id || e.roleId));
              var ov = window.__h5web_skinOverrides || skinOverrides;
              if (!window.__yc_skinSuppress && hid && ov && ov[hid]) return ov[hid];
            } catch(ex) {}
            return origGHI.apply(this, arguments);
          };
          HDV.getHeroIcon.__ycGhiHooked = true;
          try { console.log(TAG + ' getHeroIcon 已 hook'); } catch(e) {}
        }

        // hasSkin: 若游戏用 hasSkin 判定"玩家是否拥有该皮肤"，对 override 返回 true
        if (HDV && typeof HDV.hasSkin === 'function' && !HDV.hasSkin.__ycHsHooked) {
          var origHS = HDV.hasSkin;
          HDV.hasSkin = function(heroId, skinId) {
            try {
              var hid = (typeof heroId === 'number') ? heroId : (heroId && (heroId.heroId || heroId.id));
              var sid = (typeof skinId === 'number') ? skinId : (skinId && (skinId.skinId || skinId.id));
              var ov = window.__h5web_skinOverrides || skinOverrides;
              if (hid && ov && ov[hid] && (sid === ov[hid] || sid === undefined)) return true;
            } catch(ex) {}
            return origHS.apply(this, arguments);
          };
          HDV.hasSkin.__ycHsHooked = true;
          try { console.log(TAG + ' hasSkin 已 hook'); } catch(e) {}
        }
      } catch(e) {}

      // ======== Phase 4: 渲染层皮肤重映射（本地显示 override，绝不改 battleData） ========
      // 战斗回包 {id, skin} 会进入 inputCode 的 MD5（game.js ~158937: leftTeam/rightTeam 入哈希），
      // 改数据必致 PVP 校验失败、战斗卡死。这里改为 hook UIHelper 的模型/头像加载函数，在"展示时"把
      // 玩家英雄的真实 skin/avatar 替换成 override 皮肤——服务器与战斗引擎仍收到原皮肤，校验不受影响。
      try {
        var UIHwrap = window.__require && window.__require('UIHelper');
        var UIH = (UIHwrap && UIHwrap.UIHelper) || UIHwrap;
        var ACEwrap = window.__require && window.__require('AvatarConfExt');
        var ACE = (ACEwrap && ACEwrap.AvatarConfExt) || ACEwrap;

        // skin/avatar id -> heroId 反查表：仅收录"有 override 的英雄"的全部皮肤 + 默认 avatar；
        // override 变更时置脏惰性重建。怪物/boss 的 avatar 不在表内，绝不会被误换。
        function __ycRebuildSkinToHero() {
          var map = {};
          var pmap = {};  // Phase5 战斗骨骼: 真实 spine path -> override spine path
          var emap = {};  // 实验性(问题3): 皮肤战斗特效资源 uri 重映射表(原皮肤 effect uri -> override effect uri)
          try {
            var ov = window.__h5web_skinOverrides || skinOverrides;
            var lists = window.__h5web_origSkinLists || {};
            var AC = (configs && configs.AvatarConf) || null;
            var EC = (configs && configs.EffectConf) || null;
            for (var hid in ov) {
              if (!ov.hasOwnProperty(hid) || !ov[hid]) continue;
              var hidNum = parseInt(hid);
              if (isNaN(hidNum)) continue;
              var target = ov[hid];
              var skins = lists[hidNum] || [];
              for (var si4 = 0; si4 < skins.length; si4++) {
                if (typeof skins[si4] === 'number') map[skins[si4]] = hidNum;
              }
              map[hidNum] = hidNum;  // 兜底：个别路径直接以 heroId 当 avatar
              var avDef = null;
              try {
                if (ACE && typeof ACE.getAvatarId === 'function') {
                  avDef = ACE.getAvatarId(hidNum, true);  // 原始默认 avatar（t.skin===0 战斗/战斗槽用它）
                  if (typeof avDef === 'number' && avDef > 0) map[avDef] = hidNum;
                }
              } catch(e) {}
              // 战斗场骨骼: 真实皮肤/默认 avatar 的 spine path -> override 的 spine path
              // 英雄 avatar spine 自成 bundle(bundleName===path)，换 path 即换肤，不碰 battleData
              try {
                if (AC && typeof AC.getById === 'function') {
                  var overConf = AC.getById(target);
                  var overPath = overConf && overConf.path;
                  if (overPath) {
                    var srcIds = skins.slice(0);
                    if (avDef) srcIds.push(avDef);
                    for (var pi5 = 0; pi5 < srcIds.length; pi5++) {
                      var sc = AC.getById(srcIds[pi5]);
                      if (sc && sc.path && sc.path !== overPath) pmap[sc.path] = overPath;
                      // 实验性(问题3): 附属资源按下标对应重映射(光环/武器子 avatar + 皮肤战斗特效)，
                      // 仅在原皮肤与 override 皮肤都存在对应项时建立映射，避免错配；皆为路径/uri 级别，零改 battleData。
                      try {
                        if (sc && sc.asset && overConf.asset && sc.asset !== overConf.asset) pmap[sc.asset] = overConf.asset;
                        var scPre = (sc && sc.preload) || [], ovPre = (overConf && overConf.preload) || [];
                        for (var ppi = 0; ppi < scPre.length && ppi < ovPre.length; ppi++) {
                          var scPC = AC.getById(scPre[ppi]), ovPC = AC.getById(ovPre[ppi]);
                          if (scPC && ovPC && scPC.path && ovPC.path && scPC.path !== ovPC.path) pmap[scPC.path] = ovPC.path;
                          if (scPC && ovPC && scPC.asset && ovPC.asset && scPC.asset !== ovPC.asset) pmap[scPC.asset] = ovPC.asset;
                        }
                        if (EC && typeof EC.getById === 'function') {
                          var scEff = (sc && sc.preloadEffects) || [], ovEff = (overConf && overConf.preloadEffects) || [];
                          for (var pei = 0; pei < scEff.length; pei++) {
                            var scEC = EC.getById(scEff[pei]);
                            var ovEC = EC.getById(ovEff[pei >= ovEff.length ? ovEff.length - 1 : pei]);
                            __ycMapEffectConfPair(scEC, ovEC, emap);
                          }
                        } else if (!window.__yc_effectConfWarned) {
                          window.__yc_effectConfWarned = true;
                          try { console.log(TAG + ' Phase4 警告: EffectConf 不可用，effectRes 映射跳过'); } catch(e) {}
                        }
                      } catch(e) {}
                    }
                  }
                }
              } catch(e) {}
            }
          } catch(e) {}
          window.__h5web_skinToHero = map;
          window.__h5web_spinePathMap = pmap;
          window.__h5web_effectResMap = emap;
          try { console.log(TAG + ' Phase4 映射重建: skinMap=' + Object.keys(map).length + ' spinePath=' + Object.keys(pmap).length + ' effectRes=' + Object.keys(emap).length); } catch(e) {}
          window.__h5web_skinToHeroDirty = false;
          return map;
        }
        window.__h5web_rebuildSkinToHero = __ycRebuildSkinToHero;

        // 给定渲染用的真实 skin/avatar id：属于某 override 英雄则返回其 override 皮肤，否则原样返回
        function __ycRemapAvatar(realId) {
          try {
            if (window.__yc_skinSuppress) return realId;  // Phase6: 渲染他人英雄时不换肤
            if (typeof realId !== 'number' || realId <= 0) return realId;
            if (window.__h5web_skinToHeroDirty !== false || !window.__h5web_skinToHero) __ycRebuildSkinToHero();
            var map = window.__h5web_skinToHero || {};
            var hid = map[realId];
            if (!hid) return realId;
            var ov = window.__h5web_skinOverrides || skinOverrides;
            var target = ov && ov[hid];
            if (!target || target === realId) return realId;
            var allowed = (window.__h5web_origSkinLists || {})[hid] || [];
            if (allowed.indexOf(target) >= 0) return target;
          } catch(e) {}
          return realId;
        }
        window.__h5web_remapAvatar = __ycRemapAvatar;

        // 给定战斗 spine 资源路径：属于某 override 英雄的真实皮肤路径则返回 override 皮肤路径，否则原样返回
        function __ycRemapSpinePath(path) {
          try {
            // 注意: 战斗 loadSpine 只用阵营门控(battleRemapAllow)，不看 __yc_skinSuppress。
            // 因为后台挂机战斗持续触发，若用 suppress 会与"查看他人名片"互相干扰。本方战斗换肤由阵营门控保证。
            if (window.__yc_battleRemapAllow === false) return path;  // Phase7: 战斗中只换本方阵营
            if (!path || typeof path !== 'string') return path;
            if (window.__h5web_skinToHeroDirty !== false || !window.__h5web_spinePathMap) __ycRebuildSkinToHero();
            var pm = window.__h5web_spinePathMap || {};
            var np = pm[path];
            if (np && np !== path) return np;
          } catch(e) {}
          return path;
        }
        window.__h5web_remapSpinePath = __ycRemapSpinePath;

        // v3.5 战斗 spine 资源层换肤（含运行时特效）：返回 [newBundle, newPath]。
        // 只换资源字节、绝不改 avatarId → PVP 确定性回放安全（与已验证安全的主模型 loadSpine 换肤同一机制；
        // 运行时改 avatarId 才会让回放 PLAYBACK_READ_ARRAY 错位卡死，见 v3.4 注释）。
        // 归属保证：仅当 bundle 命中"我方覆盖英雄"的 spine 映射表(X→Y)才换；对手是不同英雄、bundle 不在表内，不受影响。
        // 真机诊断规律：英雄主 spine bundle===path（如 zhangjiao6/zhangjiao6）；
        //   特效 spine bundle=英雄基础 spine 名、path=bundle 或 bundle+后缀（如 zhangjiao6/zhangjiao6_attack_loop）。
        // v3.7 缺失特效替换表：override 皮肤物理缺某后缀时，映射到“同一 override bundle 内已存在的最近特效”，
        //   做到“每个攻击都用 override 自己的特效、不回退原皮肤”。键/值均为 override bundle 内完整资源名，
        //   依据真机转储(devlog 12:03)各 override 实际清单建立；可经 window.__h5web_battleSpineSubMap 覆盖。
        var __YC_SUBMAP = (window.__h5web_battleSpineSubMap = window.__h5web_battleSpineSubMap || {
          'daqiao7_attack_loop': 'daqiao7_attack_line',        // 大乔 daqiao7 缺 attack_loop
          'daqiao7_skill_loop':  'daqiao7_skill_hit',          // 大乔 daqiao7 缺 skill_loop
          'zhangjiao5_skill_line':   'zhangjiao5_skill_hit',   // 太乙真人 zhangjiao5 缺 skill_line
          'zhangjiao5_skill_line_2': 'zhangjiao5_skill_hit',   // 太乙真人 zhangjiao5 缺 skill_line_2
          'zhangjiao5_guanghuan':    'zhangjiao5_2',           // 太乙真人 zhangjiao5 缺 guanghuan(光环) → 用 _2 凑
          'zhouyu9_huomiao': 'zhouyu9_attack_hit',             // 周瑜 zhouyu9 缺 huomiao
          'daqiao7_buff_shield': 'daqiao7_armor_intro'         // 大乔自盾：daqiao5_buff_shield→armor_intro（仅大乔给自己上盾时）
        });
        var __YC_DAQIAO_HERO_ID = 119;
        // v3.8 大乔团队盾换肤：盾特效可叠加——battleEffect/shield 仅本方受盾者（v3.9 ctx 栈）；{hero}_buff_shield 自盾层保留
        function __ycGetDaqiaoOverrideBundle() {
          try {
            var ov = window.__h5web_skinOverrides || skinOverrides;
            var dqSkin = ov && ov[__YC_DAQIAO_HERO_ID];
            if (!dqSkin) return null;
            var AC = (configs && configs.AvatarConf) || null;
            if (!AC || typeof AC.getById !== 'function') return null;
            var conf = AC.getById(dqSkin);
            return (conf && conf.path) || null;
          } catch(e) {}
          return null;
        }
        function __ycIsDaqiaoOnOurBattleField() {
          try {
            var dqPath = __ycGetDaqiaoOverrideBundle();
            if (!dqPath) return false;
            if (window.__h5web_skinToHeroDirty !== false || !window.__h5web_spinePathMap) __ycRebuildSkinToHero();
            var pm = window.__h5web_spinePathMap || {};
            var src = window.__yc_myBattleSrcBundles;
            if (src) {
              if (src[dqPath]) return true;
              for (var k in pm) {
                if (Object.prototype.hasOwnProperty.call(pm, k) && pm[k] === dqPath && src[k]) return true;
              }
            }
            if (!window.__yc_myBattleHasRecord) return true;
          } catch(e) {}
          return false;
        }
        // v3.9 盾层归属：loadSpine 无 camp，须在 createArmorEffect 内压栈记录「当前受盾者是否本方」
        function __ycExtractArmorOwnerFromEffectEntity(e) {
          try {
            if (!e) return null;
            if (e.owner && e.owner.actor) return e.owner;
            var owner = null;
            if (typeof e.getComponents === 'function') {
              var arr = e.getComponents();
              for (var i = 0; i < arr.length; i++) {
                var c = arr[i];
                if (c && c.armor && c.armor.owner) return c.armor.owner;
              }
            }
            if (e._components) {
              var comps = e._components;
              if (typeof comps.forEach === 'function') {
                comps.forEach(function(c) {
                  if (!owner && c && c.armor && c.armor.owner) owner = c.armor.owner;
                });
                if (owner) return owner;
              } else {
                for (var k in comps) {
                  var c2 = comps[k];
                  if (c2 && c2.armor && c2.armor.owner) return c2.armor.owner;
                }
              }
            }
          } catch(ex) {}
          return null;
        }
        function __ycPushArmorShieldOwnerCtx(ownerEntity) {
          try {
            if (!window.__yc_armorShieldCtxStack) window.__yc_armorShieldCtxStack = [];
            var camp = ownerEntity && ownerEntity.actor && ownerEntity.actor.camp;
            var mc = window.__yc_myCamp;
            var ally = (mc != null && camp != null) ? (camp === mc) : false;
            window.__yc_armorShieldCtxStack.push(ally);
          } catch(e) {
            try { window.__yc_armorShieldCtxStack.push(false); } catch(ex) {}
          }
        }
        function __ycPopArmorShieldOwnerCtx() {
          try {
            var s = window.__yc_armorShieldCtxStack;
            if (s && s.length) s.pop();
          } catch(e) {}
        }
        function __ycIsAllyArmorShieldCtx() {
          try {
            var s = window.__yc_armorShieldCtxStack;
            return !!(s && s.length && s[s.length - 1]);
          } catch(e) {}
          return false;
        }
        function __ycResolveShieldOwnerEntity(entity) {
          try {
            if (!entity) return null;
            if (entity.target && entity.target.actor) return entity.target;
            if (entity.owner && entity.owner.actor) return entity.owner;
            if (entity.actor) return entity;
            return __ycExtractArmorOwnerFromEffectEntity(entity);
          } catch(e) {}
          return null;
        }
        function __ycGetSkeletonAssetFromEntity(entity) {
          try {
            if (!entity || typeof entity.getComponents !== 'function') return null;
            var arr = entity.getComponents();
            for (var i = 0; i < arr.length; i++) {
              var c = arr[i];
              if (c && c.bundleName != null && c.path != null) return c;
            }
          } catch(e) {}
          return null;
        }
        function __ycIsBattleEffectShieldSk(sk) {
          if (!sk) return false;
          var bn = String(sk.bundleName || ''), sp = String(sk.path || '');
          return bn === 'battleEffect' && sp.indexOf('shield') >= 0;
        }
        function __ycResolveAllyFromOwnerEntity(ownerEntity) {
          try {
            var camp = ownerEntity && ownerEntity.actor && ownerEntity.actor.camp;
            var mc = window.__yc_myCamp;
            return (mc != null && camp != null) ? (camp === mc) : false;
          } catch(e) {}
          return false;
        }
        function __ycFindEntityComp(entity, matcher) {
          try {
            if (!entity || typeof entity.getComponents !== 'function') return null;
            var arr = entity.getComponents();
            for (var i = 0; i < arr.length; i++) {
              if (matcher(arr[i])) return arr[i];
            }
          } catch(e) {}
          return null;
        }
        function __ycGetTransformComp(entity) {
          return __ycFindEntityComp(entity, function(c) {
            return c && c.offset && c.position != null && (typeof c.init === 'function' || c.dirty != null);
          });
        }
        function __ycGetDisplayProxyComp(entity) {
          return __ycFindEntityComp(entity, function(c) {
            return c && typeof c.setPosition === 'function';
          });
        }
        function __ycTagDqShieldEntity(entity, ownerEntity) {
          try {
            if (!entity) return;
            var sk = __ycGetSkeletonAssetFromEntity(entity);
            if (!__ycIsBattleEffectShieldSk(sk)) return;
            var owner = ownerEntity || __ycResolveShieldOwnerEntity(entity);
            entity.__yc_dqShieldAllyRemap = __ycResolveAllyFromOwnerEntity(owner);
          } catch(e) {}
        }
        // v3.9.4：loadSpine 在 _createArmorEffect 内部同步触发，须在调用原函数前预注册归属（WeakMap）
        function __ycEnsureDqShieldPendingMap() {
          try {
            if (!window.__yc_dqShieldPendingMap) window.__yc_dqShieldPendingMap = new WeakMap();
          } catch(e) {}
        }
        function __ycPreRegisterDqShieldArmorEntity(entity, ownerEntity) {
          try {
            if (!entity) return;
            __ycEnsureDqShieldPendingMap();
            var owner = ownerEntity || __ycExtractArmorOwnerFromEffectEntity(entity);
            var ally = __ycResolveAllyFromOwnerEntity(owner);
            window.__yc_dqShieldPendingMap.set(entity, ally);
          } catch(e) {}
        }
        function __ycResolveDqShieldAllyForEntity(entity) {
          try {
            if (!entity) return false;
            if (entity.__yc_dqShieldAllyRemap != null) return !!entity.__yc_dqShieldAllyRemap;
            if (window.__yc_dqShieldPendingMap && window.__yc_dqShieldPendingMap.has(entity)) {
              return !!window.__yc_dqShieldPendingMap.get(entity);
            }
          } catch(e) {}
          return __ycResolveAllyFromOwnerEntity(__ycResolveShieldOwnerEntity(entity));
        }
        function __ycMaybePushShieldLoadCtx(entity) {
          try {
            var sk = __ycGetSkeletonAssetFromEntity(entity);
            if (!__ycIsBattleEffectShieldSk(sk)) return false;
            if (!window.__yc_armorShieldCtxStack) window.__yc_armorShieldCtxStack = [];
            var ally = __ycResolveDqShieldAllyForEntity(entity);
            window.__yc_armorShieldCtxStack.push(!!ally);
            try {
              if (window.__h5web_spineDiag !== false) {
                var _pn = (window.__yc_shieldPushDiagN = (window.__yc_shieldPushDiagN || 0) + 1);
                if (_pn <= 40) console.log(TAG + ' [v3.9.4盾层]压栈 battleEffect/' + sk.path + ' ally=' + ally + ' ctx→' + window.__yc_armorShieldCtxStack.length);
              }
            } catch(e) {}
            return true;
          } catch(e) {}
          return false;
        }
        function __ycConsumeArmorShieldRemapFlag() {
          return __ycIsAllyArmorShieldCtx();
        }
        // v3.9.2/3.9.3：大乔团队盾 armor_intro 锚点偏高，叠加层 Y 下移（window.__h5web_dqShieldYOffset，默认 -50）
        function __ycGetDqShieldYOffset() {
          try {
            var v = window.__h5web_dqShieldYOffset;
            if (v == null || v === '') return -50;
            return Number(v) || 0;
          } catch(e) {}
          return -50;
        }
        function __ycApplyDaqiaoShieldYOffset(entity) {
          try {
            var dy = __ycGetDqShieldYOffset();
            if (!dy || !entity) return;
            if (entity.__yc_dqShieldYOffsetApplied != null) return;
            var sk = __ycGetSkeletonAssetFromEntity(entity);
            if (!sk) return;
            sk.yOffset = (Number(sk.yOffset) || 0) + dy;
            var tr = __ycGetTransformComp(entity);
            if (tr && tr.offset) {
              var ox = (tr.offset.x != null) ? Number(tr.offset.x) : (Number(sk.xOffset) || 0);
              var oy = (Number(tr.offset.y) || 0) + dy;
              if (typeof tr.offset.set === 'function') tr.offset.set(ox, oy);
              else tr.offset.y = oy;
              if (tr.dirty != null) tr.dirty = 7;
            }
            entity.__yc_dqShieldYOffsetApplied = dy;
            try {
              if (window.__h5web_spineDiag !== false) {
                var _yn = (window.__yc_shieldYOffsetDiagN = (window.__yc_shieldYOffsetDiagN || 0) + 1);
                if (_yn <= 20) console.log(TAG + ' [v3.9.3盾位] 团队盾下移 dy=' + dy + ' skY=' + sk.yOffset + ' ally=' + entity.__yc_dqShieldAllyRemap);
              }
            } catch(e) {}
          } catch(ex) {}
        }
        function __ycRefreshDaqiaoShieldDisplay(entity) {
          try {
            if (!entity || entity.__yc_dqShieldYOffsetApplied == null) return;
            var tr = __ycGetTransformComp(entity);
            var dp = __ycGetDisplayProxyComp(entity);
            if (tr && dp && typeof dp.setPosition === 'function') {
              dp.setPosition(tr.position.x + (tr.offset ? tr.offset.x : 0), tr.position.y + (tr.offset ? tr.offset.y : 0));
              if (tr.dirty != null) tr.dirty = 7;
            }
          } catch(e) {}
        }
        function __ycRemapDaqiaoShieldLayer(bundle, path) {
          try {
            if (window.__h5web_battleReskin === false) return null;
            if (!__ycIsDaqiaoOnOurBattleField()) return null;
            var dqPath = __ycGetDaqiaoOverrideBundle();
            if (!dqPath) return null;
            var b = String(bundle), p = String(path);
            if (b !== 'battleEffect' || p.indexOf('shield') < 0) return null;
            // v3.9.4：同步栈（实体预注册 WeakMap + 标记），仅本方 battleEffect/shield 才换
            if (!__ycConsumeArmorShieldRemapFlag()) {
              try {
                if (window.__h5web_spineDiag !== false) {
                  var _sk = (window.__yc_shieldSkipEnemyN = (window.__yc_shieldSkipEnemyN || 0) + 1);
                  if (_sk <= 30) console.log(TAG + ' [v3.9盾层]跳过非我方受盾 battleEffect/' + p + ' ctx=' + (window.__yc_armorShieldCtxStack ? window.__yc_armorShieldCtxStack.length : 0));
                }
              } catch(e) {}
              return null;
            }
            __ycDumpBundle(dqPath);
            var intro = dqPath + '_armor_intro';
            var fallback = __YC_SUBMAP[dqPath + '_buff_shield'] || intro;
            var resSet = window.__yc_bundleRes && window.__yc_bundleRes[dqPath];
            var target = (resSet && resSet[intro]) ? intro : ((resSet && resSet[fallback]) ? fallback : null);
            if (!target) return null;
            try {
              if (window.__h5web_spineDiag !== false) {
                var _sn = (window.__yc_shieldLayerDiagN = (window.__yc_shieldLayerDiagN || 0) + 1);
                if (_sn <= 40) console.log(TAG + ' [v3.9盾层]我方叠加层 ' + b + '/' + p + ' → ' + dqPath + '/' + target);
              }
            } catch(e) {}
            return [dqPath, target];
          } catch(e) {}
          return null;
        }
        function __ycRemapBattleSpine(bundle, path) {
          try {
            if (window.__h5web_battleReskin === false) return [bundle, path];   // v3.7.2 战斗换肤总开关：设 false 全关，复用同一回放 A/B 对比，隔离“战斗不一致”是否由换肤引起
            if (!bundle || !path) return [bundle, path];
            var dqShield = __ycRemapDaqiaoShieldLayer(bundle, path);
            if (dqShield) return dqShield;
            if (window.__yc_battleRemapAllow === false) return [bundle, path];  // Phase7: onEntityAdded 明确判为非我方阵营时不换
            if (window.__h5web_skinToHeroDirty !== false || !window.__h5web_spinePathMap) __ycRebuildSkinToHero();
            var pm = window.__h5web_spinePathMap || {};
            var b = String(bundle), p = String(path);
            // ① 英雄主 spine：bundle===path，整体替换
            if (b === p) {
              var ny0 = pm[p];
              if (ny0 && ny0 !== p) {
                if (window.__yc_battleRemapAllow === true) {        // v3.7.1：仅本方阵营主模型登记“我方本场英雄源 bundle”，供特效归属判定
                  if (!window.__yc_myBattleSrcBundles) window.__yc_myBattleSrcBundles = {};
                  window.__yc_myBattleSrcBundles[p] = 1;
                  window.__yc_myBattleHasRecord = true;
                }
                __ycDumpBundle(ny0);
                return [ny0, ny0];
              }
              return [bundle, path];
            }
            // ② 特效/子资源：bundle=英雄基础 spine 名(映射表内 X→Y)，path=bundle 或 bundle+后缀 → 整体换为 Y / Y+后缀
            var ny = pm[b];
            if (ny && ny !== b) {
              // v3.7.1 归属修复：特效 loadSpine 多在 onEntityAdded 之外（camp=undefined），无法靠 battleRemapAllow 分敌我。
              //   改用“本场已登记的我方英雄源 bundle”集合：仅当 b 属我方本场英雄才换特效；
              //   对面单独装备的同名英雄（如本场对面周瑜 zhouyu8、我方未上阵）保持原特效，绝不串到我方 override。
              //   兜底：本场尚无任何登记（camp 识别失败）时维持旧行为，避免丢我方特效。
              if (!(window.__yc_myBattleSrcBundles && window.__yc_myBattleSrcBundles[b]) && window.__yc_myBattleHasRecord) {
                return [bundle, path];
              }
              __ycDumpBundle(ny);  // v3.6 诊断：转储 override bundle 实际资源清单，核对其真实特效后缀
              if (p === b) return [ny, ny];
              if (p.indexOf(b) === 0) {
                var ty = ny + p.slice(b.length);                  // 目标：override 同后缀特效，例 zhangjiao6_attack_loop → zhangjiao5_attack_loop
                var resSet = window.__yc_bundleRes && window.__yc_bundleRes[ny];
                if (resSet && !resSet[ty]) {                      // v3.7：override 物理缺该后缀
                  var sub = __YC_SUBMAP[ty];                      // 查“同 override 内最近特效”替换表
                  if (sub && resSet[sub]) return [ny, sub];       // 用 override 自己的最近特效（不回退原皮肤）
                  return [bundle, path];                          // 未配置/替换目标也不存在：保持原始资源，避免 doesn't contain 报错+缺特效
                }
                return [ny, ty];                                  // override 有该后缀：直接用（bundle+path 一起换，绝不只换一半）
              }
              // path 不以 bundle 开头：换 bundle 会造无效组合，保持原样（安全）
            }
          } catch(e) {}
          return [bundle, path];
        }
        window.__h5web_remapBattleSpine = __ycRemapBattleSpine;

        // v3.6 诊断（只读）：转储 override skin bundle 的实际资源清单（每个 bundle 只打一次），
        // 用于核对其真实特效后缀名 —— 部分 override 皮肤的特效命名与原皮肤不同/有缺失，需据此建立精准映射，
        // 而非盲目"原后缀→同后缀"。bundle 未加载时不标记，等加载后下次再转储。
        function __ycDumpBundle(bundleName) {
          try {
            if (!bundleName) return;
            if (!window.__yc_dumpedBundles) window.__yc_dumpedBundles = {};
            if (window.__yc_dumpedBundles[bundleName]) return;
            var bd = (typeof cc !== 'undefined' && cc.assetManager && cc.assetManager.bundles && cc.assetManager.bundles.get) ? cc.assetManager.bundles.get(bundleName) : null;
            if (!bd) return;  // 未加载：暂不标记，等加载后下次再转储
            // v3.6.1 转储修复：Cocos 2.4 资源元数据在 bd._config（下划线，game.js:28257 用 _config.assetInfos）。
            //   原 v3.6 用 bd.config.paths 取不到 → 资源数=0。改为多策略兜底，纯只读、不改任何加载行为。
            var paths = [];
            var dumpSrc = 'none';
            var cfg = bd._config || bd.config || {};
            function __ycAsStr(x) { return (typeof x === 'string' && x) ? x : null; }
            // v3.6.2 修复：_config.paths 的 value 是 info 对象（v3.6.1 误把对象当 path → 打印成 [object Object]）。
            //   Cocos getInfoWithPath(path) 内部按 _map[path] 取值 → _map 的 KEY 才是资源 path 字符串。
            // 策略1（首选）：getDirWithPath('') —— 游戏自身在用（game.js:273845），返回 [{path,uuid,ctor}]，path 为字符串
            try {
              if (typeof bd.getDirWithPath === 'function') {
                var dir = bd.getDirWithPath('') || [];
                for (var i = 0; i < dir.length; i++) {
                  var it = dir[i];
                  var p1 = __ycAsStr(it) || (it && __ycAsStr(it.path)) || (Array.isArray(it) ? __ycAsStr(it[0]) : null);
                  if (p1) paths.push(p1);
                }
                if (paths.length) dumpSrc = 'dir';
              }
            } catch(e) {}
            // 策略2：_config.paths —— Paths._map 的 KEY 即资源 path 字符串（value 为 info 对象，不可当 path）
            if (!paths.length) {
              try {
                var pp = cfg.paths;
                var src = (pp && (pp._map || pp)) || null;
                if (src) {
                  for (var k in src) {
                    if (src.hasOwnProperty && !src.hasOwnProperty(k)) continue;
                    var v = src[k];
                    var p2 = __ycAsStr(k) || __ycAsStr(v) || (Array.isArray(v) ? __ycAsStr(v[0]) : null) || (v && __ycAsStr(v.path));
                    if (p2) paths.push(p2);
                  }
                  if (paths.length) dumpSrc = 'paths(key)';
                }
              } catch(e) {}
            }
            // 策略3（兜底）：_config.assetInfos（Cache，带 forEach，game.js:28257）
            if (!paths.length) {
              try {
                var ai = cfg.assetInfos;
                if (ai && typeof ai.forEach === 'function') {
                  ai.forEach(function(info) {
                    var p3 = (info && (__ycAsStr(info.path) || __ycAsStr(info.uuid))) || null;
                    if (p3) paths.push(p3);
                  });
                  if (paths.length) dumpSrc = 'assetInfos';
                }
              } catch(e) {}
            }
            // v3.7：把资源清单存为集合，供 __ycRemapBattleSpine 做“缺失后缀存在性校验”（避免加载不存在的特效 → 消 doesn't contain 报错）
            if (paths.length) {
              if (!window.__yc_bundleRes) window.__yc_bundleRes = {};
              var __rs = window.__yc_bundleRes[bundleName] = {};
              for (var __ri = 0; __ri < paths.length; __ri++) __rs[paths[__ri]] = 1;
            }
            window.__yc_dumpedBundles[bundleName] = 1;
            try { console.log(TAG + ' [转储]bundle ' + bundleName + ' 资源数=' + paths.length + ' src=' + dumpSrc + ' → ' + paths.slice(0, 120).join(',')); } catch(e) {}
          } catch(e) {}
        }
        window.__h5web_dumpBundle = __ycDumpBundle;

        // loadAsset(bundle, uri) 双参数重映射（Phase5b ResourceManager + 运行时特效资源）
        function __ycRemapLoadAssetPair(bundle, uri) {
          try {
            if (window.__h5web_skinToHeroDirty !== false || !window.__h5web_spinePathMap) __ycRebuildSkinToHero();
            var pm = window.__h5web_spinePathMap || {};
            var em = window.__h5web_effectResMap || {};
            var ck = (bundle != null ? String(bundle) : '') + '|' + (uri != null ? String(uri) : '');
            // ① 完整 bundle|uri 配对（最安全）：原皮肤特效整对 → override 特效整对替换。
            if (em[ck]) {
              var parts = em[ck].split('|');
              if (parts.length === 2) return [parts[0], parts[1]];
            }
            // ② v3.3 关键修复：仅当 bundle===uri（英雄主 spine/特效，包名===资源名、整体自成一个 bundle）时，
            //    才允许"单值"重映射，并且 bundle 与 uri 必须一起换。
            //    绝不"只换 bundle 不换 uri"——那会造出 "新bundle + 旧子资源名" 的无效组合，导致
            //    loadAsset 报错并使战斗回放等待该资源 → 第二回合卡死。
            //    真机证据: Phase5b zhangjiao6/zhangjiao6_2 → zhangjiao5/zhangjiao6_2
            //              → "Bundle zhangjiao5 doesn't contain zhangjiao6_2" → 回放卡死。
            if (bundle != null && uri != null && String(bundle) === String(uri)) {
              var np = pm[bundle] || em[bundle];
              if (np && np !== bundle) return [np, np];
            }
          } catch(e) {}
          return [bundle, uri];
        }
        window.__h5web_remapLoadAssetPair = __ycRemapLoadAssetPair;

        function __ycMapEffectConfPair(scEC, ovEC, emap) {
          try {
            if (!scEC || !ovEC || !scEC.uri || !ovEC.uri || scEC.uri === ovEC.uri) return;
            emap[scEC.uri] = ovEC.uri;
            var sb = scEC.bundle != null ? String(scEC.bundle) : '';
            var ob = ovEC.bundle != null ? String(ovEC.bundle) : '';
            if (sb && ob) {
              emap[sb + '|' + scEC.uri] = ob + '|' + ovEC.uri;
              if (sb !== ob) emap[sb] = ob;
            }
          } catch(e) {}
        }

        function __ycIsMyBattleUnit(unit) {
          try {
            var bd = window.__yc_currentBattleData;
            var myId = window.ROLE && window.ROLE.roleId;
            if (!bd || myId == null || !unit) return false;
            var hid = unit.id != null ? unit.id : (unit.heroId != null ? unit.heroId : null);
            if (hid == null) return false;
            var teams = __ycGetMyTeams(bd, myId);
            for (var ti = 0; ti < teams.length; ti++) {
              if (__ycTeamHasHero(teams[ti], hid)) return true;
            }
          } catch(e) {}
          return false;
        }

        // Phase7: 判定"本方阵营"的 camp 值 —— 不依赖 CampType 枚举（types-battle 是 extras 模块，
        // 主线程 window.__require 取不到）。改为按 battleData 中 roleId===ROLE.roleId 的队伍锚定：
        // 遇到一个"我的英雄"actor 时，其 actor.camp 即本方 camp（含同阵营队友）。按 world 实例每场重判。
        function __ycTeamHasHero(team, hid) {
          try {
            var m = team && team.team;
            if (!m) return false;
            if (typeof m.forEach === 'function') {
              var found = false;
              m.forEach(function(u) {
                if (found || !u) return;
                if (u.id === hid || u.heroId === hid || (u.hero && (u.hero.id === hid || u.hero.heroId === hid))) found = true;
              });
              return found;
            }
            if (Array.isArray(m)) {
              for (var i = 0; i < m.length; i++) { var u = m[i]; if (u && (u.id === hid || u.heroId === hid)) return true; }
            }
          } catch(e) {}
          return false;
        }
        function __ycGetMyTeams(bd, myId) {
          var teams = [];
          try {
            var cand = [];
            if (bd.leftTeam) cand.push(bd.leftTeam);
            if (bd.rightTeam) cand.push(bd.rightTeam);
            if (bd.leftTeams && bd.leftTeams.length) cand = cand.concat(Array.prototype.slice.call(bd.leftTeams));
            if (bd.rightTeams && bd.rightTeams.length) cand = cand.concat(Array.prototype.slice.call(bd.rightTeams));
            for (var i = 0; i < cand.length; i++) if (cand[i] && cand[i].roleId === myId) teams.push(cand[i]);
          } catch(e) {}
          return teams;
        }
        function __ycResolveMyCamp(world, entity) {
          try {
            if (window.__yc_myCampWorld !== world) { window.__yc_myCamp = null; window.__yc_myCampWorld = world; }
            if (window.__yc_myCamp != null) return window.__yc_myCamp;
            var bd = world && world.options && world.options.battleData;
            var actor = entity && entity.actor;
            var camp = actor && actor.camp;
            var myId = window.ROLE && window.ROLE.roleId;
            if (!bd || camp == null || myId == null) return null;
            var hid = null;
            if (actor.data) hid = (actor.data.id != null ? actor.data.id : (actor.data.heroId != null ? actor.data.heroId : actor.data.oriHeroId));
            if (hid == null) hid = actor.id;
            if (hid == null) return null;
            var myTeams = __ycGetMyTeams(bd, myId);
            for (var i = 0; i < myTeams.length; i++) {
              if (__ycTeamHasHero(myTeams[i], hid)) {
                window.__yc_myCamp = camp;
                try { console.log(TAG + ' Phase7 本方camp=' + camp + ' (battleData锚定 myRoleId=' + myId + ' hid=' + hid + ')'); } catch(e) {}
                return camp;
              }
            }
          } catch(e) {}
          return null;
        }
        window.__h5web_resolveMyCamp = __ycResolveMyCamp;

        if (UIH) {
          // showHero(node, skinId, ...)：英雄 spine 模型加载中心入口（PVP 部署槽 _showHeroTeam、阵容 showHeroTeam 均汇入）
          if (typeof UIH.showHero === 'function' && !UIH.showHero.__ycReskinHooked) {
            var __ycOrigShowHero = UIH.showHero;
            UIH.showHero = function() {
              var args = Array.prototype.slice.call(arguments);
              try { if (args.length >= 2) args[1] = __ycRemapAvatar(args[1]); } catch(ex) {}
              return __ycOrigShowHero.apply(this, args);
            };
            UIH.showHero.__ycReskinHooked = true;
          }
          // showHeroNew(node, skinId, ...)：FixLoader3D 开关下的 3D 变体
          if (typeof UIH.showHeroNew === 'function' && !UIH.showHeroNew.__ycReskinHooked) {
            var __ycOrigShowHeroNew = UIH.showHeroNew;
            UIH.showHeroNew = function() {
              var args = Array.prototype.slice.call(arguments);
              try { if (args.length >= 2) args[1] = __ycRemapAvatar(args[1]); } catch(ex) {}
              return __ycOrigShowHeroNew.apply(this, args);
            };
            UIH.showHeroNew.__ycReskinHooked = true;
          }
          // showHeroIconFromDetail(node, heroId, showName, level, color, star, skin)：战斗详情头像（参数直接含 heroId）
          if (typeof UIH.showHeroIconFromDetail === 'function' && !UIH.showHeroIconFromDetail.__ycReskinHooked) {
            var __ycOrigSHIFD = UIH.showHeroIconFromDetail;
            UIH.showHeroIconFromDetail = function() {
              var args = Array.prototype.slice.call(arguments);
              try {
                if (!window.__yc_skinSuppress) {  // Phase6: 渲染他人英雄时不换肤
                  var hidNum = (typeof args[1] === 'number') ? args[1] : parseInt(args[1]);
                  var ov = window.__h5web_skinOverrides || skinOverrides;
                  if (hidNum && ov && ov[hidNum]) {
                    var allowed = (window.__h5web_origSkinLists || {})[hidNum] || [];
                    if (allowed.indexOf(ov[hidNum]) >= 0) args[6] = ov[hidNum];
                  }
                }
              } catch(ex) {}
              return __ycOrigSHIFD.apply(this, args);
            };
            UIH.showHeroIconFromDetail.__ycReskinHooked = true;
          }
          // 关键兜底: 渲染他人英雄时 getAvatarId(heroId,false) 会用"本地 ROLE 实例"(ROLE.heroes.get)解析 avatar →
          // 拿到我的 override。suppress 时强制 force=true（用 HeroConf.avatar 配置默认，不经本地实例/skinList）→ 他人不显示我的皮肤。
          try {
            if (ACE && typeof ACE.getAvatarId === 'function' && !ACE.getAvatarId.__ycSuppressHooked) {
              var __ycOrigGAI = ACE.getAvatarId;
              ACE.getAvatarId = function(e, t) {
                if (window.__yc_skinSuppress) { try { return __ycOrigGAI.call(this, e, true); } catch(ex) {} }
                return __ycOrigGAI.apply(this, arguments);
              };
              ACE.getAvatarId.__ycSuppressHooked = true;
              try { console.log(TAG + ' Phase4 getAvatarId suppress 兜底已安装'); } catch(e) {}
            }
          } catch(e) {}
          // 头像框 override（装扮 #2）：setHeadIcon(node, headImg, roleId, avatarFrame{id,expire}, ...) 带 roleId；
          // 对自己(roleId===ROLE.roleId)替换 avatarFrame 为 override 框；他人不受影响。不发服务器。
          if (typeof UIH.setHeadIcon === 'function' && !UIH.setHeadIcon.__ycFrameHooked) {
            var __ycOrigSetHead = UIH.setHeadIcon;
            UIH.setHeadIcon = function(e, t, i, o, n) {
              try {
                var myId = window.ROLE && window.ROLE.roleId;
                if (i === myId && window.__h5web_frameOverride) {
                  var args = Array.prototype.slice.call(arguments);
                  args[3] = { id: window.__h5web_frameOverride, expire: -1 };
                  return __ycOrigSetHead.apply(this, args);
                }
              } catch(ex) {}
              return __ycOrigSetHead.apply(this, arguments);
            };
            UIH.setHeadIcon.__ycFrameHooked = true;
            try { console.log(TAG + ' Phase9 头像框 hook 已安装 (setHeadIcon)'); } catch(e) {}
          }
          try { console.log(TAG + ' Phase4 渲染层重映射已安装 (showHero/showHeroNew/showHeroIconFromDetail)'); } catch(e) {}
        } else {
          try { console.log(TAG + ' Phase4 警告: 未取到 UIHelper 模块，渲染层重映射跳过'); } catch(e) {}
        }

        // ======== Phase 5: 战斗场作战骨骼小人换肤（hook BattleAssetManager.loadSpine） ========
        // 战斗作战单位走 ECS(SystemSkeletonLoader.onEntityAdded → loadSpine(bundleName, path))，
        // 不经 UIHelper.showHero，故 Phase4 覆盖不到。英雄 avatar spine 自成 bundle(bundleName===path)，
        // 把真实皮肤的 spine path 换成 override 皮肤的 path 即可换肤——battleData 零改动，inputCode 不变。
        // 注：战斗 bundle 懒加载，模块就绪前重试；仅命中 override 英雄路径，怪物/特效/子弹不受影响。
        (function __ycHookBattleSpine(attempt) {
          try {
            var BAMwrap = window.__require && window.__require('manager-asset');
            var BAM = (BAMwrap && BAMwrap.BattleAssetManager) || null;
            if (BAM && BAM.prototype && typeof BAM.prototype.loadSpine === 'function') {
              if (!BAM.prototype.loadSpine.__ycReskinHooked) {
                var __ycOrigLoadSpine = BAM.prototype.loadSpine;
                BAM.prototype.loadSpine = function(bundleName, path, autoRelease) {
                  var __ycOb = bundleName, __ycOp = path;
                  try {
                    // v3.5：资源层换肤（主模型 + 运行时特效），bundle 与 path 一起换，绝不改 avatarId → 回放安全。
                    var __ycPair = __ycRemapBattleSpine(bundleName, path);
                    var __ycDid = (__ycPair[0] !== bundleName || __ycPair[1] !== path);
                    bundleName = __ycPair[0];
                    path = __ycPair[1];
                    // 诊断（只读，不改加载行为）：记录战斗内所有 spine 资源的"原始→最终"路径，便于据真机日志核对。
                    // 仅打印前 80 条避免刷屏。开关：window.__h5web_spineDiag === false 可关闭。
                    try {
                      if (window.__h5web_spineDiag !== false) {
                        var _ds = (window.__yc_spineDiagN = (window.__yc_spineDiagN || 0) + 1);
                        if (_ds <= 80) {
                      var _layer = (__ycOp.indexOf('_buff_shield') >= 0) ? ' [英雄盾层·叠加保留]' : '';
                      console.log(TAG + ' [诊断]loadSpine ' + __ycOb + '/' + __ycOp + ' → ' + bundleName + '/' + path + ' remap=' + __ycDid + ' camp=' + window.__yc_battleRemapAllow + _layer);
                    }
                      }
                    } catch(e) {}
                  } catch(ex) {}
                  return __ycOrigLoadSpine.call(this, bundleName, path, autoRelease);
                };
                BAM.prototype.loadSpine.__ycReskinHooked = true;
                try { console.log(TAG + ' Phase5 战斗骨骼换肤已安装 (BattleAssetManager.loadSpine)'); } catch(e) {}
              }
              return;
            }
          } catch(e) {}
          if (attempt < 40) setTimeout(function() { __ycHookBattleSpine(attempt + 1); }, 500);
          else { try { console.log(TAG + ' Phase5 警告: 未取到 BattleAssetManager，战斗骨骼换肤跳过'); } catch(e) {} }
        })(0);

        // ======== Phase 5b (问题3): hook ResourceManager.loadAsset —— 战斗特效/附属 spine 资源 ========
        // 真机日志证实 BattleAssetManager 无 loadAsset（仅 loadSpine→ResourceManager.loadAsset），
        // 战斗 loading 与运行时特效均走 ResourceManager.instance.loadAsset(bundle, uri, type)。
        // 预加载阶段由 Phase5c getActorAvatar 重映射 avatarId；运行时由 Phase7 阵营门控 __yc_battleRemapAllow。
        (function __ycHookResourceLoadAsset(attempt) {
          try {
            var RMwrap = window.__require && window.__require('ResourceManager');
            var RM = (RMwrap && RMwrap.ResourceManager) || RMwrap;
            if (RM && RM.prototype && typeof RM.prototype.loadAsset === 'function') {
              if (!RM.prototype.loadAsset.__ycReskinHooked) {
                var __ycOrigRMLoad = RM.prototype.loadAsset;
                RM.prototype.loadAsset = function(bundle, uri) {
                  try {
                    if (window.__yc_battleRemapAllow === true) {
                      var pair = __ycRemapLoadAssetPair(bundle, uri);
                      if (pair[0] !== bundle || pair[1] !== uri) {
                        try {
                          var _na = (window.__yc_laLog = (window.__yc_laLog || 0) + 1);
                          if (_na <= 8) console.log(TAG + ' Phase5b loadAsset 重映射 ' + bundle + '/' + uri + ' → ' + pair[0] + '/' + pair[1]);
                        } catch(e) {}
                        bundle = pair[0];
                        uri = pair[1];
                      }
                    }
                  } catch(ex) {}
                  var args = Array.prototype.slice.call(arguments);
                  args[0] = bundle;
                  args[1] = uri;
                  return __ycOrigRMLoad.apply(this, args);
                };
                RM.prototype.loadAsset.__ycReskinHooked = true;
                try { console.log(TAG + ' Phase5b loadAsset hook 已安装 (ResourceManager, 阵营门控)'); } catch(e) {}
              }
              return;
            }
          } catch(e) {}
          if (attempt < 40) setTimeout(function() { __ycHookResourceLoadAsset(attempt + 1); }, 500);
          else { try { console.log(TAG + ' Phase5b 警告: 未取到 ResourceManager.loadAsset'); } catch(e) {} }
        })(0);

        // ======== Phase 5c (问题3): 战斗 loading 预加载 —— hook getActorAvatar 加载 override 的 preloadEffects ========
        // showBattleLoading 在 Phase7 之前按 battleData 原始 skin 递归 preload；仅 hook loadSpine 换主模型不够，
        // 必须把预加载入口 avatarId 换为 override，才会加载 override 皮肤的 preloadEffects/附属 avatar。
        (function __ycHookBattlePreload(attempt) {
          try {
            var hooked = false;
            var BUIwrap = window.__require && window.__require('BattleUIManager');
            var BUI = (BUIwrap && BUIwrap.BattleUIManager) || null;
            function __ycWrapBattleLoadingFn(proto, fnName, logLabel) {
              if (!proto || typeof proto[fnName] !== 'function' || proto[fnName].__ycPreloadHooked) return false;
              var __ycOrigBL = proto[fnName];
              proto[fnName] = function() {
                var prevBd = window.__yc_currentBattleData;
                var prevPre = window.__yc_inBattlePreload;
                var battleModel = arguments[2];
                window.__yc_currentBattleData = battleModel && battleModel.battleData;
                window.__yc_inBattlePreload = true;
                var fin = function() {
                  window.__yc_inBattlePreload = prevPre;
                  window.__yc_currentBattleData = prevBd;
                };
                try {
                  var ret = __ycOrigBL.apply(this, arguments);
                  if (ret && typeof ret.then === 'function') {
                    return ret.then(function(r) { fin(); return r; }, function(err) { fin(); throw err; });
                  }
                  fin();
                  return ret;
                } catch(ex) {
                  fin();
                  throw ex;
                }
              };
              proto[fnName].__ycPreloadHooked = true;
              try { console.log(TAG + ' Phase5c 战斗预加载 hook 已安装 (' + logLabel + ')'); } catch(e) {}
              return true;
            }
            if (BUI && BUI.prototype) {
              if (__ycWrapBattleLoadingFn(BUI.prototype, 'showBattleLoading', 'showBattleLoading')) hooked = true;
              if (__ycWrapBattleLoadingFn(BUI.prototype, 'showSkyBattleLoading', 'showSkyBattleLoading')) hooked = true;
            }
            var BDwrap = window.__require && (window.__require('battle-data') || window.__require('ClientActorData'));
            var CAD = (BDwrap && BDwrap.ClientActorData) || null;
            if (CAD && typeof CAD.getActorAvatar === 'function' && !CAD.getActorAvatar.__ycPreloadHooked) {
              var __ycOrigGAA = CAD.getActorAvatar;
              CAD.getActorAvatar = function(unit) {
                var av = __ycOrigGAA.apply(this, arguments);
                try {
                  // v3.4 回退：仅在"预载期"对我方单位换 avatar（让 override 皮肤的 preloadEffects 提前进缓存）。
                  // 绝不在"运行时"改 avatarId —— avatarId 被 PVP 确定性回放的序列化流读取依赖，运行时改它会让
                  // PLAYBACK_READ_ARRAY 读指针错位（RangeError: Invalid array length，回合切换处卡死）。
                  // 战斗内模型换肤改由 Phase5 loadSpine 在资源层完成（只换字节、不改 avatarId，回放安全）。
                  if (window.__yc_inBattlePreload && __ycIsMyBattleUnit(unit)) {
                    var nav = __ycRemapAvatar(av);
                    if (nav !== av) {
                      try {
                        var _ng = (window.__yc_gaaLog = (window.__yc_gaaLog || 0) + 1);
                        if (_ng <= 8) console.log(TAG + ' Phase5c getActorAvatar 预加载 ' + av + ' → ' + nav);
                      } catch(e) {}
                      av = nav;
                    }
                  }
                } catch(ex) {}
                return av;
              };
              CAD.getActorAvatar.__ycPreloadHooked = true;
              try { console.log(TAG + ' Phase5c getActorAvatar hook 已安装'); } catch(e) {}
              hooked = true;
            }
            if (hooked) return;
          } catch(e) {}
          if (attempt < 40) setTimeout(function() { __ycHookBattlePreload(attempt + 1); }, 500);
          else { try { console.log(TAG + ' Phase5c 警告: 战斗预加载 hook 未完全就绪'); } catch(e) {} }
        })(0);

        // ======== Phase 6: 归属门控 —— 只换"本地玩家自己"的英雄，查看他人时不换 ========
        // 反查表是按 skin/path 全局映射的，无法区分"我的英雄101"和"别人的英雄101"。
        // PlayerInfoDialog 同时用于自己/他人名片，靠 model 的 ROLE_INFO.roleId 区分：
        // 打开他人名片(roleId!==ROLE.roleId)时置 __yc_skinSuppress=true，渲染其队伍 spine/头像时跳过重映射；
        // 自己名片/大厅/阵容(suppress=false)照常换肤。关闭名片还原。
        (function __ycHookOwnerGate(attempt) {
          try {
            var PIwrap = window.__require && window.__require('PlayerInfoDialog');
            if (PIwrap) {
              var dialogs = [PIwrap.PlayerInfoDialog, PIwrap.PlayerInfoTopDialog];
              var hookedAny = false;
              function __ycIsForeignDialog(self) {
                try {
                  var ri = self && self.model && typeof self.model.get === 'function' && self.model.get('ROLE_INFO');
                  var myId = window.ROLE && window.ROLE.roleId;
                  return !!(ri && ri.roleId && myId && ri.roleId !== myId);
                } catch(e) { return false; }
              }
              for (var di = 0; di < dialogs.length; di++) {
                var D = dialogs[di];
                if (!D || !D.prototype || D.prototype.__ycOwnerHooked) continue;
                (function(proto) {
                  var showMethods = ['onShow', 'onShown'];
                  for (var mi = 0; mi < showMethods.length; mi++) {
                    (function(mname) {
                      if (typeof proto[mname] !== 'function') return;
                      var orig = proto[mname];
                      proto[mname] = function() {
                        try {
                          var f = __ycIsForeignDialog(this);
                          window.__yc_skinSuppress = f;
                          if (f) { try { console.log(TAG + ' Phase6 他人名片 suppress=on (不换肤)'); } catch(e) {} }
                        } catch(e) {}
                        return orig.apply(this, arguments);
                      };
                    })(showMethods[mi]);
                  }
                  if (typeof proto.onHide === 'function') {
                    var origHide = proto.onHide;
                    proto.onHide = function() {
                      try { window.__yc_skinSuppress = false; } catch(e) {}
                      return origHide.apply(this, arguments);
                    };
                  }
                  proto.__ycOwnerHooked = true;
                })(D.prototype);
                hookedAny = true;
              }
              if (hookedAny) { try { console.log(TAG + ' Phase6 归属门控已安装 (查看他人名片不换肤)'); } catch(e) {} return; }
            }
          } catch(e) {}
          if (attempt < 40) setTimeout(function() { __ycHookOwnerGate(attempt + 1); }, 500);
          else { try { console.log(TAG + ' Phase6 警告: 未取到 PlayerInfoDialog，归属门控跳过'); } catch(e) {} }
        })(0);

        // ======== Phase 7: 战斗场只换"本方阵营"英雄（PVP 对手不换） ========
        // PVP/竞技场战斗中对手英雄与你同 heroId，Phase5 会把对手也换肤。这里 hook 战斗骨骼加载系统
        // SystemSkeletonLoader.onEntityAdded：在每个 actor 加载 spine 前，按 actor.camp === CampType.FRIEND
        // 判定本方；只有本方英雄才允许 Phase5 的 loadSpine 重映射（onEntityAdded→loadSpine 同步，标志即时生效）。
        // battleData 仍零改动。CampType 取不到时安全回退（不门控 = 维持只换本方失败但不丢自己皮肤的旧行为）。
        (function __ycHookBattleCamp(attempt) {
          try {
            var SLwrap = window.__require && window.__require('system-skeleton-loader');
            var SL = (SLwrap && SLwrap.SystemSkeletonLoader) || null;
            if (SL && SL.prototype && typeof SL.prototype.onEntityAdded === 'function') {
              if (!SL.prototype.onEntityAdded.__ycCampHooked) {
                var __ycOrigOEA = SL.prototype.onEntityAdded;
                SL.prototype.onEntityAdded = function(t, e) {
                  var prev = window.__yc_battleRemapAllow;
                  var shieldCtxPushed = false;
                  try {
                    if (this.world !== window.__yc_lastBattleWorld) {   // v3.7.1：新一场战斗 → 重置“我方本场英雄”登记（特效归属防串场）
                      window.__yc_lastBattleWorld = this.world;
                      window.__yc_myBattleSrcBundles = {};
                      window.__yc_myBattleHasRecord = false;
                    }
                    var camp = t && t.actor && t.actor.camp;
                    var mc = __ycResolveMyCamp(this.world, t);
                    if (camp != null && mc != null) window.__yc_battleRemapAllow = (camp === mc);
                    shieldCtxPushed = __ycMaybePushShieldLoadCtx(t);
                  } catch(ex) {}
                  var __ycRet;
                  try {
                    __ycRet = __ycOrigOEA.apply(this, arguments);
                    return __ycRet;
                  } finally {
                    window.__yc_battleRemapAllow = prev;
                    if (shieldCtxPushed) __ycPopArmorShieldOwnerCtx();
                  }
                };
                SL.prototype.onEntityAdded.__ycCampHooked = true;
                if (typeof SL.prototype.setSkeleton === 'function' && !SL.prototype.setSkeleton.__ycDqShieldHooked) {
                  var __ycOrigSetSk = SL.prototype.setSkeleton;
                  SL.prototype.setSkeleton = function(entity, spineData, uuid) {
                    __ycOrigSetSk.apply(this, arguments);
                    try {
                      var sk = __ycGetSkeletonAssetFromEntity(entity);
                      if (entity && __ycIsBattleEffectShieldSk(sk) && __ycResolveDqShieldAllyForEntity(entity)) {
                        __ycTagDqShieldEntity(entity);
                        __ycApplyDaqiaoShieldYOffset(entity);
                        __ycRefreshDaqiaoShieldDisplay(entity);
                      }
                    } catch(e) {}
                  };
                  SL.prototype.setSkeleton.__ycDqShieldHooked = true;
                }
                try { console.log(TAG + ' Phase7 战斗阵营门控已安装 (SystemSkeletonLoader + v3.9.4盾层)'); } catch(e) {}
              }
              return;
            }
          } catch(e) {}
          if (attempt < 40) setTimeout(function() { __ycHookBattleCamp(attempt + 1); }, 500);
          else { try { console.log(TAG + ' Phase7 警告: 未取到 SystemSkeletonLoader，战斗阵营门控跳过'); } catch(e) {} }
        })(0);

        // ======== Phase 7b: 大乔盾层归属上下文（SystemSkeletonLoader 同步 loadSpine + createArmorEffect 辅路径） ========
        (function __ycHookArmorShieldCtx(attempt) {
          try {
            var SCEwrap = window.__require && window.__require('system-create-effect');
            var SCE = (SCEwrap && SCEwrap.SystemCreateEffect) || null;
            if (SCE && SCE.prototype) {
              if (typeof SCE.prototype._createArmorEffect === 'function' && !SCE.prototype._createArmorEffect.__ycDqShieldHooked) {
                var __ycOrigCAE = SCE.prototype._createArmorEffect;
                SCE.prototype._createArmorEffect = function(e) {
                  var owner = null;
                  try { owner = __ycExtractArmorOwnerFromEffectEntity(e); } catch(ex) {}
                  __ycPreRegisterDqShieldArmorEntity(e, owner);
                  var ret = __ycOrigCAE.apply(this, arguments);
                  try {
                    if (ret) {
                      if (ret !== e) __ycPreRegisterDqShieldArmorEntity(ret, owner);
                      __ycTagDqShieldEntity(ret, owner);
                    }
                  } catch(ex2) {}
                  return ret;
                };
                SCE.prototype._createArmorEffect.__ycDqShieldHooked = true;
              }
              if (typeof SCE.prototype._createArmorIntroduceEffect === 'function' && !SCE.prototype._createArmorIntroduceEffect.__ycDqShieldHooked) {
                var __ycOrigCAIE = SCE.prototype._createArmorIntroduceEffect;
                SCE.prototype._createArmorIntroduceEffect = function(e) {
                  var owner = null;
                  try { owner = __ycExtractArmorOwnerFromEffectEntity(e); } catch(ex) {}
                  __ycPreRegisterDqShieldArmorEntity(e, owner);
                  var ret = __ycOrigCAIE.apply(this, arguments);
                  try {
                    if (ret) {
                      if (ret !== e) __ycPreRegisterDqShieldArmorEntity(ret, owner);
                      __ycTagDqShieldEntity(ret, owner);
                    }
                  } catch(ex2) {}
                  return ret;
                };
                SCE.prototype._createArmorIntroduceEffect.__ycDqShieldHooked = true;
              }
              if (SCE.prototype._createArmorEffect && SCE.prototype._createArmorEffect.__ycDqShieldHooked) {
                try { console.log(TAG + ' Phase7b 大乔盾层预注册已安装 (createArmor* 前 WeakMap + 后标记)'); } catch(e) {}
                return;
              }
            }
          } catch(e) {}
          if (attempt < 40) setTimeout(function() { __ycHookArmorShieldCtx(attempt + 1); }, 500);
          else { try { console.log(TAG + ' Phase7b 警告: 未取到 SystemCreateEffect，盾层归属上下文跳过'); } catch(e) {} }
        })(0);

        // ======== Phase 7c: 团队盾 followTarget 后刷新下移后的显示位置 ========
        (function __ycHookDqShieldFollow(attempt) {
          try {
            var SEwrap = window.__require && window.__require('system-effect');
            var SE = (SEwrap && SEwrap.SystemEffect) || null;
            if (SE && SE.prototype && typeof SE.prototype._updateEffectPos === 'function') {
              if (!SE.prototype._updateEffectPos.__ycDqShieldHooked) {
                var __ycOrigUEP = SE.prototype._updateEffectPos;
                SE.prototype._updateEffectPos = function(entity, force) {
                  __ycOrigUEP.apply(this, arguments);
                  try { __ycRefreshDaqiaoShieldDisplay(entity); } catch(e) {}
                };
                SE.prototype._updateEffectPos.__ycDqShieldHooked = true;
                try { console.log(TAG + ' Phase7c 团队盾位置刷新已安装 (SystemEffect._updateEffectPos)'); } catch(e) {}
              }
              return;
            }
          } catch(e) {}
          if (attempt < 40) setTimeout(function() { __ycHookDqShieldFollow(attempt + 1); }, 500);
        })(0);

        // ======== Phase 8: 主公皮肤 本地 override（装扮 #1） ========
        // 显示走 ROLE.getRealLordSkinId(roleInfo)（自己→realLordSkinId）→ refreshLord → LordSkinConf.avatarId（不校验拥有）。
        // hook 它对自己返回 override（未拥有也能本地显示）；他人(e.roleId!==myId)走原值，不受影响。面板选择，不发服务器、不涉 battleData。
        try {
          var __ycRoleObj = window.ROLE;
          if (__ycRoleObj) {
            var __ycRoleProto = Object.getPrototypeOf(__ycRoleObj);
            if (__ycRoleProto && typeof __ycRoleProto.getRealLordSkinId === 'function' && !__ycRoleProto.getRealLordSkinId.__ycLordHooked) {
              var __ycOrigGRLS = __ycRoleProto.getRealLordSkinId;
              __ycRoleProto.getRealLordSkinId = function(e) {
                try {
                  var myId = window.ROLE && window.ROLE.roleId;
                  if (e && e.roleId === myId && window.__h5web_lordOverride) return window.__h5web_lordOverride;
                } catch(ex) {}
                return __ycOrigGRLS.apply(this, arguments);
              };
              __ycRoleProto.getRealLordSkinId.__ycLordHooked = true;
              try { console.log(TAG + ' Phase8 主公皮肤 hook 已安装 (getRealLordSkinId)'); } catch(e) {}
            }
            // realLordSkinId getter（getCurSkinData 等用它）→ 自己有 override 时返回 override
            try {
              var __ycRLSDesc = null, __ycp = __ycRoleProto, __ycdep = 0;
              while (__ycp && __ycdep < 6 && !__ycRLSDesc) { __ycRLSDesc = Object.getOwnPropertyDescriptor(__ycp, 'realLordSkinId'); if (!__ycRLSDesc) { __ycp = Object.getPrototypeOf(__ycp); __ycdep++; } }
              if (__ycRLSDesc && __ycRLSDesc.get && !window.__h5web_realLordSkinIdHooked) {
                var __ycOrigRLSGet = __ycRLSDesc.get;
                Object.defineProperty(__ycp, 'realLordSkinId', {
                  get: function() { try { if (window.__h5web_lordOverride) return window.__h5web_lordOverride; } catch(ex) {} return __ycOrigRLSGet.call(this); },
                  configurable: true
                });
                window.__h5web_realLordSkinIdHooked = true;
                try { console.log(TAG + ' Phase8 realLordSkinId getter 已覆盖'); } catch(e) {}
              }
            } catch(e) {}
          }
        } catch(e) {}
      } catch(e) {}

      // ======== Phase 10: 竞技场景(pvpMap) + 名片(card) 本地 override（装扮 #3 #4） ========
      // 均为自己(ROLE)的 getter，他人走各自数据不受影响；显示走 Conf，不发服务器、不涉 battleData。
      try {
        var __ycRP = window.ROLE && Object.getPrototypeOf(window.ROLE);
        var __ycCfgR = window.__require && window.__require('Configs');
        var __ycCfg = (__ycCfgR && (__ycCfgR.Configs || __ycCfgR.default)) || __ycCfgR;
        if (__ycRP && __ycCfg) {
          // 竞技场景: pvpMapId getter → override 的 mapId
          if (!window.__h5web_pvpMapHooked) {
            var __pp = __ycRP, __pd = 0, __pmDesc = null;
            while (__pp && __pd < 6 && !__pmDesc) { __pmDesc = Object.getOwnPropertyDescriptor(__pp, 'pvpMapId'); if (!__pmDesc) { __pp = Object.getPrototypeOf(__pp); __pd++; } }
            if (__pmDesc && __pmDesc.get) {
              var __origPM = __pmDesc.get, __PVPC = __ycCfg.PVPMapConf;
              Object.defineProperty(__pp, 'pvpMapId', {
                get: function() { try { if (window.__h5web_pvpMapOverride && __PVPC) { var c = __PVPC.getById(window.__h5web_pvpMapOverride); var rv = c && c.mapId; if (rv) { try { window.__yc_pvpGetterTs = Date.now(); } catch(et) {} try { var _n = (window.__yc_pvpLogN = (window.__yc_pvpLogN || 0) + 1); if (_n <= 8) console.log(TAG + ' Phase10 pvpMapId getter 命中: override=' + window.__h5web_pvpMapOverride + ' → mapId=' + rv); } catch(e2) {} return rv; } else { try { var _n2 = (window.__yc_pvpLogF = (window.__yc_pvpLogF || 0) + 1); if (_n2 <= 4) console.log(TAG + ' Phase10 pvpMapId getById 失败: override=' + window.__h5web_pvpMapOverride + ' conf=' + (c ? 'has' : 'null') + ' mapId=' + (c && c.mapId)); } catch(e3) {} } } } catch(ex) {} return __origPM.call(this); },
                configurable: true
              });
              window.__h5web_pvpMapHooked = true;
              try { console.log(TAG + ' Phase10 竞技场景 hook 已安装 (pvpMapId)'); } catch(e) {}
            }
          }
          // 名片: cardData / customCard getter → {id: override}
          // 关键：查看自己信息时游戏传 ROLE_INFO=ROLE（见 game.js SHOW_PROXY(PlayerInfoDialog,{ROLE_INFO:ROLE})），
          // 渲染名片走 showRoleCardComp(node, roleInfo.customCard|.cardData)。ROLE 上有 cardData getter 但【没有 customCard】，
          // 故 customCard 分支原本因找不到 getter 而静默跳过 → 自己名片读到 undefined → 不生效。此处对缺失的 getter 主动新增。
          ['cardData', 'customCard'].forEach(function(prop) {
            try {
              if (window['__h5web_' + prop + 'Hooked']) return;
              var __cp = __ycRP, __cd = 0, __cDesc = null;
              while (__cp && __cd < 6 && !__cDesc) { __cDesc = Object.getOwnPropertyDescriptor(__cp, prop); if (!__cDesc) { __cp = Object.getPrototypeOf(__cp); __cd++; } }
              if (__cDesc && __cDesc.get) {
                var __origCard = __cDesc.get;
                Object.defineProperty(__cp, prop, {
                  get: function() { try { if (window.__h5web_cardOverride) return { id: window.__h5web_cardOverride, expire: -1 }; } catch(ex) {} return __origCard.call(this); },
                  configurable: true
                });
                window['__h5web_' + prop + 'Hooked'] = true;
                try { console.log(TAG + ' Phase10 名片 hook 已安装 (' + prop + ', 覆盖原 getter)'); } catch(e) {}
              } else {
                // ROLE 原型链不存在该属性（customCard 即此情况）：在 ROLE 原型上新增 getter。
                // override 时返回 override 名片；否则回退到 cardData（自己真实名片）。仅 ROLE 单例受影响，
                // 服务器下发的他人角色信息对象是别的类、其 customCard 是普通字段，绝不会被波及。
                Object.defineProperty(__ycRP, prop, {
                  get: function() {
                    try { if (window.__h5web_cardOverride) return { id: window.__h5web_cardOverride, expire: -1 }; } catch(ex) {}
                    try { return this.cardData; } catch(ex) {}
                    return { id: 0, expire: 0 };
                  },
                  set: function() {},
                  configurable: true, enumerable: false
                });
                window['__h5web_' + prop + 'Hooked'] = true;
                try { console.log(TAG + ' Phase10 名片 getter 新增 (' + prop + ', ROLE 原无此属性)'); } catch(e) {}
              }
            } catch(e) {}
          });
        }
      } catch(e) {}

      // ======== Phase 11: 主线/章节战斗场景跟随竞技场景 override（hook fgui.UIPackage.createObject） ========
      // 主线/home/关卡 map = ChapterConf.mapId（getMapUrlByChapter），不读 ROLE.pvpMapId，所以竞技场 hook 影响不到主线。
      // getMapUrl 在 extras 战斗 bundle 闭包里，game.js 无法 require/调用，无法直接构造 override 的 map url。
      // 策略：hook 全局 fgui.UIPackage.createObject(pkg, "Map")：
      //   - 捕获：竞技场加载 scene 时（pvpMapId getter 3s 内刚返回 override），记录该 Map pkg = override scene 的 url
      //   - 替换：主线/章节 map 创建时（getter 时间戳已过期），若 override scene 包已加载，则把 pkg 换成 override scene
      //           （未加载则保持原章节图，零破坏）；竞技场本身已是 override，不受影响。
      try {
        if (!window.__h5web_mapCreateHooked && window.fgui && window.fgui.UIPackage && typeof window.fgui.UIPackage.createObject === 'function') {
          var __UP = window.fgui.UIPackage;
          var __origCreateObj = __UP.createObject;
          var __p11CfgR = window.__require && window.__require('Configs');
          var __p11Cfg = (__p11CfgR && (__p11CfgR.Configs || __p11CfgR.default)) || __p11CfgR;
          var __p11PVPC = __p11Cfg && __p11Cfg.PVPMapConf;
          var __p11BAMwrap = window.__require && window.__require('manager-asset');
          var __p11BAM = __p11BAMwrap && __p11BAMwrap.BattleAssetManager;
          // url 格式已知：map_<mapId>（日志确认）。直接构造 override scene url，不依赖捕获。
          function __ycOverrideMapId() { try { if (window.__h5web_pvpMapOverride && __p11PVPC) { var c = __p11PVPC.getById(window.__h5web_pvpMapOverride); return (c && c.mapId) || null; } } catch(e) {} return null; }
          window.__ycOverrideSceneUrlNow = function() { var m = __ycOverrideMapId(); return m ? ('map_' + m) : null; };
          // 按需加载 override scene 包并保持（autoRelease=false），供 createObject 替换 + 防止离场释放
          window.__ycPreloadOverrideScene = function() {
            try {
              var url = window.__ycOverrideSceneUrlNow();
              if (!url || !__p11BAM || !__p11BAM.instance) return;
              if (__UP.getByName && __UP.getByName(url)) return; // 已加载
              if (window.__yc_scenePreloading === url) return;
              window.__yc_scenePreloading = url;
              __p11BAM.instance.loadMap(url, false).then(function() {
                window.__yc_scenePreloading = null;
                try { console.log(TAG + ' Phase11 override scene 已预加载并保持: ' + url); } catch(e) {}
              }).catch(function() { window.__yc_scenePreloading = null; });
            } catch(e) { window.__yc_scenePreloading = null; }
          };
          __UP.createObject = function(pkg, res) {
            try {
              if (res === 'Map' && window.__h5web_pvpMapOverride) {
                var ovUrl = window.__ycOverrideSceneUrlNow();
                if (ovUrl && ovUrl !== pkg) {
                  var loaded = false;
                  try { loaded = !!(__UP.getByName && __UP.getByName(ovUrl)); } catch(e) {}
                  if (loaded) {
                    try { console.log(TAG + ' Phase11 主线 map 替换: ' + pkg + ' → ' + ovUrl); } catch(e) {}
                    pkg = ovUrl;
                  } else {
                    // 还没加载：触发预加载，本次保持原图，下次重建即替换
                    try { window.__ycPreloadOverrideScene(); } catch(e) {}
                    try { var _wn = (window.__yc_mapWaitLog = (window.__yc_mapWaitLog||0)+1); if (_wn <= 5) console.log(TAG + ' Phase11 override scene 加载中，本次保持原图（重建后生效）'); } catch(e) {}
                  }
                }
              }
            } catch(ex) {}
            return __origCreateObj.call(this, pkg, res);
          };
          window.__h5web_mapCreateHooked = true;
          try { console.log(TAG + ' Phase11 主线场景 hook 已安装 (fgui.UIPackage.createObject, url=map_<mapId>)'); } catch(e) {}
          // 安装即预加载一次（若已选 override）
          try { if (window.__h5web_pvpMapOverride) window.__ycPreloadOverrideScene(); } catch(e) {}
        }
      } catch(e) {}

      // ======== Phase 12+13: 盐场/军团战 飞艇(Airship) + 击杀特效(MultiKill) 本地 override ========
      // hook LegionWarPlayer.airshipBundle / multiKillId getter，仅对自己(roleId 命中)替换，他人/队友走原数据；不改 serverData。
      (function __ycHookLWPlayer(attempt) {
        function __ycIsSelfLWP(o) {
          // 盐场/军团战玩家匿名化：roleId/id getter 返回 _serverData.codeIdV2（匿名编码），codeId 恒为 0，
          // 均不等于 ROLE.roleId。游戏自身用 isMe(this.id===LEGION_WAR.selfCodeId) 判定本人，必须以它为准。
          try {
            if (o) {
              var me = o.isMe;
              if (me === true || me === false) return me;
            }
          } catch(e) {}
          // 兜底：isMe 取不到（模块未就绪等极端情况）时退回旧的 roleId 比对
          try {
            var my = window.ROLE && window.ROLE.roleId;
            if (!my) return false;
            if (o.roleId === my || o.id === my) return true;
            var sd = o._serverData;
            if (sd && (sd.roleId === my || sd.codeId === my || sd.codeIdV2 === my)) return true;
          } catch(e) {}
          return false;
        }
        try {
          var LWPwrap = window.__require && window.__require('LegionWarPlayer');
          var LWP = LWPwrap && (LWPwrap.LegionWarPlayer || LWPwrap.default);
          var proto = LWP && LWP.prototype;
          if (proto) {
            var __lwCfgR = window.__require('Configs');
            var __lwCfg = (__lwCfgR && (__lwCfgR.Configs || __lwCfgR.default)) || __lwCfgR;
            var __AC = __lwCfg && __lwCfg.AirshipConf;
            // 飞艇: airshipBundle getter
            if (!window.__h5web_lwAirshipHooked) {
              var __d1 = Object.getOwnPropertyDescriptor(proto, 'airshipBundle');
              if (__d1 && __d1.get) {
                var __origAir = __d1.get;
                Object.defineProperty(proto, 'airshipBundle', {
                  get: function() {
                    try {
                      if (window.__h5web_airshipOverride && __AC && __ycIsSelfLWP(this)) {
                        var c = __AC.getById(window.__h5web_airshipOverride);
                        if (c && c.airshipSkin) { try { var _n=(window.__yc_airLog=(window.__yc_airLog||0)+1); if(_n<=4) console.log(TAG+' Phase12 飞艇 self 命中 → '+c.airshipSkin); } catch(e){} return c.airshipSkin; }
                      }
                    } catch(ex) {}
                    return __origAir.call(this);
                  }, configurable: true
                });
                window.__h5web_lwAirshipHooked = true;
                try { console.log(TAG + ' Phase12 盐场飞艇 hook 已安装 (LegionWarPlayer.airshipBundle)'); } catch(e) {}
              }
            }
            // 击杀特效: multiKillId getter
            if (!window.__h5web_lwMultiKillHooked) {
              var __d2 = Object.getOwnPropertyDescriptor(proto, 'multiKillId');
              if (__d2 && __d2.get) {
                var __origMK = __d2.get;
                Object.defineProperty(proto, 'multiKillId', {
                  get: function() {
                    try {
                      if (window.__h5web_multiKillOverride && __ycIsSelfLWP(this)) { try { var _n2=(window.__yc_mkLog=(window.__yc_mkLog||0)+1); if(_n2<=4) console.log(TAG+' Phase13 连杀 self 命中 → '+window.__h5web_multiKillOverride); } catch(e){} return window.__h5web_multiKillOverride; }
                    } catch(ex) {}
                    return __origMK.call(this);
                  }, configurable: true
                });
                window.__h5web_lwMultiKillHooked = true;
                try { console.log(TAG + ' Phase13 击杀特效 hook 已安装 (LegionWarPlayer.multiKillId)'); } catch(e) {}
              }
            }
            if (window.__h5web_lwAirshipHooked && window.__h5web_lwMultiKillHooked) return;
          }
        } catch(e) {}
        if (attempt < 40) setTimeout(function(){ __ycHookLWPlayer(attempt + 1); }, 500);
        else { try { console.log(TAG + ' Phase12/13 警告: 未取到 LegionWarPlayer（' + (window.__h5web_lwAirshipHooked?'飞艇ok':'飞艇缺') + '/' + (window.__h5web_lwMultiKillHooked?'连杀ok':'连杀缺') + '）'); } catch(e){} }
      })(0);

      // ======== Phase 14: 装扮室全解锁（去锁显示） —— hook 三个 isHas 返回 true（有效 conf id） ========
      // 装扮室列表项 m_isLock = (isHas(id)===false)；hook isHas→true 即去除锁标。覆盖：
      //   LordSkinDressData.isHas: 头像框/名片/盐场飞艇/连杀特效/竞技场景
      //   DRV2LordSkinDecoData.isHas: 主公皮肤；  DRV2ProfileCardDecoData.isHas: 工牌(ProfileCard)
      // 注：仅解锁"显示"；游戏内点装备会走 useDress→服务器(未拥有可能失败)，实际换装用悬浮面板。
      (function __ycHookDressUnlock(attempt) {
        function patchIsHas(proto, tag) {
          try {
            if (!proto || typeof proto.isHas !== 'function') return false;
            if (proto.isHas.__ycUnlockHooked) return true;
            var orig = proto.isHas;
            proto.isHas = function(e) {
              try {
                if (e === 0 || e == null) return true;
                var conf = (typeof this.getConfById === 'function') ? this.getConfById(e) : null;
                if (conf) return true;
              } catch(ex) {}
              return orig.call(this, e);
            };
            proto.isHas.__ycUnlockHooked = true;
            try { console.log(TAG + ' Phase14 装扮解锁 hook 已安装: ' + tag); } catch(e) {}
            return true;
          } catch(e) { return false; }
        }
        try {
          var ok = 0;
          var LSDP = window.__require && window.__require('LordSkinOtherDressPage');
          if (LSDP && LSDP.LordSkinDressData && patchIsHas(LSDP.LordSkinDressData.prototype, 'LordSkinDressData(框/名片/飞艇/连杀/场景)')) ok++;
          var DDA = window.__require && window.__require('DRV2DataAdapter');
          if (DDA && DDA.DRV2LordSkinDecoData && patchIsHas(DDA.DRV2LordSkinDecoData.prototype, 'DRV2LordSkinDecoData(主公皮肤)')) ok++;
          if (DDA && DDA.DRV2ProfileCardDecoData && patchIsHas(DDA.DRV2ProfileCardDecoData.prototype, 'DRV2ProfileCardDecoData(工牌)')) ok++;
          if (ok >= 3) { try { console.log(TAG + ' Phase14 装扮室全解锁完成 (3/3)'); } catch(e){} return; }
        } catch(e) {}
        if (attempt < 40) setTimeout(function(){ __ycHookDressUnlock(attempt + 1); }, 500);
        else { try { console.log(TAG + ' Phase14 警告: 装扮解锁部分未安装'); } catch(e){} }
      })(0);

      // ======== Phase 15: 装扮"本地装备"（拦截 useDress 不发服务器，参考英雄皮肤 useskin 拦截） ========
      // 解锁后游戏内点"装备"会 useDress→服务器，未真拥有→报错"显示问题/重启游戏"。这里拦截 useDress：
      // 设本地 override + 返回成功(不发服务器)，并 hook getNowUse 让"已装备"标记正确；视觉走各 Phase 的 getter。
      (function __ycHookUseDress(attempt) {
        // EMDressType: confs[_type] = [null,AvatarFrame(1),CustomCard(2),Airship(3),MultiKill(4),PVPMap(5)]
        var __lsdName = {1:'frameOverride', 2:'cardOverride', 3:'airshipOverride', 4:'multiKillOverride', 5:'pvpMapOverride'};
        function __ycSetOv(name, id) {
          try {
            window['__h5web_' + name] = id;
            var rid = window.ROLE && window.ROLE.roleId;
            if (rid) { var k = '__h5web_' + name + '_' + rid; if (id) localStorage.setItem(k, '' + id); else localStorage.removeItem(k); }
          } catch(e) {}
        }
        try {
          var okN = 0;
          // 1) LordSkinDressData: 框/名片/飞艇/连杀/场景
          var LSDP = window.__require && window.__require('LordSkinOtherDressPage');
          var LSD = LSDP && LSDP.LordSkinDressData;
          if (LSD && LSD.prototype && !LSD.prototype.useDress.__ycLocalEquip) {
            var __ou = LSD.prototype.useDress, __og = LSD.prototype.getNowUse;
            LSD.prototype.useDress = function(id) {
              try { var nm = __lsdName[this._type]; if (nm) { __ycSetOv(nm, id); if (this._type === 5 && window.__ycPreloadOverrideScene) try { window.__ycPreloadOverrideScene(); } catch(e){} try { console.log(TAG + ' Phase15 本地装备 type=' + this._type + ' → ' + id + '（不发服务器）'); } catch(e){} return Promise.resolve(true); } } catch(ex) {}
              return __ou.call(this, id);
            };
            LSD.prototype.useDress.__ycLocalEquip = true;
            LSD.prototype.getNowUse = function() { try { var nm = __lsdName[this._type]; if (nm && window['__h5web_' + nm]) return window['__h5web_' + nm]; } catch(ex) {} return __og.call(this); };
            okN++; try { console.log(TAG + ' Phase15 useDress 拦截已装 (LordSkinDressData)'); } catch(e){}
          } else if (LSD && LSD.prototype && LSD.prototype.useDress.__ycLocalEquip) okN++;
          // 2) DRV2LordSkinDecoData: 主公皮肤；3) DRV2ProfileCardDecoData: 工牌
          var DDA = window.__require && window.__require('DRV2DataAdapter');
          if (DDA && DDA.DRV2LordSkinDecoData && DDA.DRV2LordSkinDecoData.prototype && !DDA.DRV2LordSkinDecoData.prototype.useDress.__ycLocalEquip) {
            var __olu = DDA.DRV2LordSkinDecoData.prototype.useDress, __olg = DDA.DRV2LordSkinDecoData.prototype.getNowUse;
            DDA.DRV2LordSkinDecoData.prototype.useDress = function(id) { try { __ycSetOv('lordOverride', id); try { console.log(TAG + ' Phase15 本地装备 主公皮肤 → ' + id + '（不发服务器）'); } catch(e){} return Promise.resolve(true); } catch(ex) {} return __olu.call(this, id); };
            DDA.DRV2LordSkinDecoData.prototype.useDress.__ycLocalEquip = true;
            DDA.DRV2LordSkinDecoData.prototype.getNowUse = function() { try { if (window.__h5web_lordOverride) return window.__h5web_lordOverride; } catch(ex) {} return __olg.call(this); };
            okN++; try { console.log(TAG + ' Phase15 useDress 拦截已装 (DRV2LordSkinDecoData)'); } catch(e){}
          } else if (DDA && DDA.DRV2LordSkinDecoData && DDA.DRV2LordSkinDecoData.prototype.useDress.__ycLocalEquip) okN++;
          if (DDA && DDA.DRV2ProfileCardDecoData && DDA.DRV2ProfileCardDecoData.prototype && !DDA.DRV2ProfileCardDecoData.prototype.useDress.__ycLocalEquip) {
            var __opu = DDA.DRV2ProfileCardDecoData.prototype.useDress, __opg = DDA.DRV2ProfileCardDecoData.prototype.getNowUse;
            DDA.DRV2ProfileCardDecoData.prototype.useDress = function(id) { try { __ycSetOv('profileCardOverride', id); try { console.log(TAG + ' Phase15 本地装备 工牌 → ' + id + '（不发服务器）'); } catch(e){} return Promise.resolve(true); } catch(ex) {} return __opu.call(this, id); };
            DDA.DRV2ProfileCardDecoData.prototype.useDress.__ycLocalEquip = true;
            DDA.DRV2ProfileCardDecoData.prototype.getNowUse = function() { try { if (window.__h5web_profileCardOverride) return window.__h5web_profileCardOverride; } catch(ex) {} return __opg.call(this); };
            okN++; try { console.log(TAG + ' Phase15 useDress 拦截已装 (DRV2ProfileCardDecoData)'); } catch(e){}
          } else if (DDA && DDA.DRV2ProfileCardDecoData && DDA.DRV2ProfileCardDecoData.prototype.useDress.__ycLocalEquip) okN++;
          if (okN >= 3) { try { console.log(TAG + ' Phase15 装扮本地装备拦截完成 (3/3)'); } catch(e){} return; }
        } catch(e) {}
        if (attempt < 40) setTimeout(function(){ __ycHookUseDress(attempt + 1); }, 500);
        else { try { console.log(TAG + ' Phase15 警告: useDress 拦截部分未安装'); } catch(e){} }
      })(0);

      // ======== Phase 16: 主公皮肤主界面头像跟随 override（hook lordSkinData.getCurSkinData） ========
      // 根因：getCurSkinData() 读 realLordSkinId(Phase8已返回override)，但 lordSkin.has(override) 未拥有→false→返默认。
      // 修：override 时用游戏自身 getDepotSkinData() 取出 override 的有效 skin data 返回（参考英雄皮肤注入有效数据）。
      // getLordSkinAvatarId/主界面头像/装扮室预览都走 getCurSkinData，故一处生效全覆盖。永远是自己(ROLE)的，无需归属门控。
      (function __ycHookLordCurSkin(attempt) {
        try {
          var DDA = window.__require && window.__require('DRV2DataAdapter');
          var inst = DDA && DDA.DRV2LordSkinDecoData && DDA.DRV2LordSkinDecoData.instance;
          var lsd = inst && inst.lordSkinData;
          var proto = lsd && Object.getPrototypeOf(lsd);
          if (proto && typeof proto.getCurSkinData === 'function') {
            if (!proto.getCurSkinData.__ycLordCur) {
              var __origCur = proto.getCurSkinData;
              proto.getCurSkinData = function() {
                try {
                  var ov = window.__h5web_lordOverride;
                  if (ov) {
                    if (window.__yc_lordSkinDataCache && window.__yc_lordSkinDataCacheId === ov) return window.__yc_lordSkinDataCache;
                    var arr = (typeof this.getDepotSkinData === 'function') ? this.getDepotSkinData() : null;
                    if (arr) { for (var i = 0; i < arr.length; i++) { if (arr[i] && arr[i].lordSkinId === ov) { window.__yc_lordSkinDataCache = arr[i]; window.__yc_lordSkinDataCacheId = ov; try { var _n=(window.__yc_lordCurLog=(window.__yc_lordCurLog||0)+1); if(_n<=3) console.log(TAG+' Phase16 getCurSkinData → override '+ov+' (avatarId='+arr[i].avatarId+')'); } catch(e){} return arr[i]; } } }
                  }
                } catch(ex) {}
                return __origCur.call(this);
              };
              proto.getCurSkinData.__ycLordCur = true;
              try { console.log(TAG + ' Phase16 主公皮肤 getCurSkinData hook 已安装（主界面头像跟随）'); } catch(e) {}
            }
            return;
          }
        } catch(e) {}
        if (attempt < 40) setTimeout(function(){ __ycHookLordCurSkin(attempt + 1); }, 500);
        else { try { console.log(TAG + ' Phase16 警告: 未取到 lordSkinData'); } catch(e){} }
      })(0);

      window.__h5web_skinHookDone = true;
      try { console.log(TAG + ' 所有 Hook 安装完成'); } catch(e) {}
    } catch(e) {
      if (phase3Attempts < 60) setTimeout(phase3, 2000);
    }
  }

  // 同时启动所有阶段
  phase1();
  phase2();
  phase3();

  // ======== 悬浮皮肤管理面板 ========
  (function installPicker() {
    if (document.getElementById('__yc_skpanel')) return;
    var waitAttempts = 0;
    function waitReady() {
      waitAttempts++;
      if (!window.__h5web_skinReady) {
        if (waitAttempts < 120) setTimeout(waitReady, 500);
        return;
      }
      init();
    }

    function init() {
      var ov = window.__h5web_skinOverrides || {};
      var origLists = window.__h5web_origSkinLists || {};
      var baseSkins = window.__h5web_origBaseSkins || {};
      var ROLE = window.ROLE;
      var rawC = window.__require('Configs');
      var cfgs = (rawC && (rawC.Configs || rawC.default)) || rawC;
      var SC = cfgs && cfgs.SkinConf;
      var LC = cfgs && cfgs.LanguageConf;
      var LSC = cfgs && cfgs.LordSkinConf;

      // 主公皮肤 override 加载 + 辅助
      function lordKey() { var rid = ROLE && ROLE.roleId; return rid ? ('__h5web_lordOverride_' + rid) : null; }
      if (window.__h5web_lordOverride == null) {
        try { var __lk = lordKey(); var __lv = __lk && localStorage.getItem(__lk); window.__h5web_lordOverride = __lv ? (parseInt(__lv) || 0) : 0; } catch(e) { window.__h5web_lordOverride = 0; }
      }
      function lordName(id) {
        try {
          var s = LSC && LSC.getById(id);
          if (s) {
            var nm = s.skinName || s.name || s.lordSkinName;
            if (nm) {
              if (LC && LC.getByKey) { try { var lg = LC.getByKey(nm); if (lg && lg.chinese) return lg.chinese; } catch(e) {} }
              return nm;
            }
          }
        } catch(e) {}
        return '主公#' + id;
      }
      function lordList() {
        var arr = [];
        try {
          var src = LSC && (LSC.list || (LSC.map && typeof LSC.map.values === 'function' ? Array.from(LSC.map.values()) : null));
          if (src && src.forEach) src.forEach(function(c) { if (c && c.id != null && c.id !== 0) arr.push(c.id); });
        } catch(e) {}
        return arr;
      }

      // 头像框 override 加载 + 辅助（装扮 #2）
      var AFC = cfgs && cfgs.AvatarFrameConf;
      function frameKey() { var rid = ROLE && ROLE.roleId; return rid ? ('__h5web_frameOverride_' + rid) : null; }
      if (window.__h5web_frameOverride == null) {
        try { var __fk = frameKey(); var __fv = __fk && localStorage.getItem(__fk); window.__h5web_frameOverride = __fv ? (parseInt(__fv) || 0) : 0; } catch(e) { window.__h5web_frameOverride = 0; }
      }
      function frameName(id) {
        try { var s = AFC && AFC.getById(id); if (s) { var nm = s.name; if (nm) { if (LC && LC.getByKey) { try { var lg = LC.getByKey(nm); if (lg && lg.chinese) return lg.chinese; } catch(e) {} } return nm; } } } catch(e) {}
        return '框#' + id;
      }
      function frameList() {
        var arr = [];
        try {
          var src = AFC && (AFC.list || (AFC.map && typeof AFC.map.values === 'function' ? Array.from(AFC.map.values()) : null));
          if (src && src.forEach) src.forEach(function(c) { if (c && c.id != null && c.id !== 0) arr.push(c.id); });
        } catch(e) {}
        return arr;
      }

      // 通用 Conf 枚举 + 名称（装扮 #3 #4）
      function confList(CF) {
        var arr = [];
        try {
          var src = CF && (CF.list || (CF.map && typeof CF.map.values === 'function' ? Array.from(CF.map.values()) : null));
          if (src && src.forEach) src.forEach(function(c) { if (c && c.id != null && c.id !== 0) arr.push(c.id); });
        } catch(e) {}
        return arr;
      }
      function confName(CF, id, pre) {
        try { var s = CF && CF.getById(id); if (s) { var nm = s.name || s.skinName; if (nm) { if (LC && LC.getByKey) { try { var lg = LC.getByKey(nm); if (lg && lg.chinese) return lg.chinese; } catch(e) {} } return nm; } } } catch(e) {}
        return pre + id;
      }
      var PVPC = cfgs && cfgs.PVPMapConf;
      var CCC = cfgs && cfgs.CustomCardConf;
      var ASC = cfgs && cfgs.AirshipConf;
      var MKC = cfgs && cfgs.MultiKillConf;
      function pvpKey() { var rid = ROLE && ROLE.roleId; return rid ? ('__h5web_pvpMapOverride_' + rid) : null; }
      function cardKey() { var rid = ROLE && ROLE.roleId; return rid ? ('__h5web_cardOverride_' + rid) : null; }
      function airKey() { var rid = ROLE && ROLE.roleId; return rid ? ('__h5web_airshipOverride_' + rid) : null; }
      function mkKey() { var rid = ROLE && ROLE.roleId; return rid ? ('__h5web_multiKillOverride_' + rid) : null; }
      if (window.__h5web_pvpMapOverride == null) { try { var __pk = pvpKey(); var __pv = __pk && localStorage.getItem(__pk); window.__h5web_pvpMapOverride = __pv ? (parseInt(__pv) || 0) : 0; } catch(e) { window.__h5web_pvpMapOverride = 0; } }
      if (window.__h5web_cardOverride == null) { try { var __ck = cardKey(); var __cv = __ck && localStorage.getItem(__ck); window.__h5web_cardOverride = __cv ? (parseInt(__cv) || 0) : 0; } catch(e) { window.__h5web_cardOverride = 0; } }
      if (window.__h5web_airshipOverride == null) { try { var __ak = airKey(); var __av = __ak && localStorage.getItem(__ak); window.__h5web_airshipOverride = __av ? (parseInt(__av) || 0) : 0; } catch(e) { window.__h5web_airshipOverride = 0; } }
      if (window.__h5web_multiKillOverride == null) { try { var __mk = mkKey(); var __mv = __mk && localStorage.getItem(__mk); window.__h5web_multiKillOverride = __mv ? (parseInt(__mv) || 0) : 0; } catch(e) { window.__h5web_multiKillOverride = 0; } }

      // 通用装扮分区 HTML 生成
      function decoSectionHtml(title, color, bg, cls, cur, ids, CF, pre) {
        var h = '';
        if (!ids.length) return h;
        h += '<div style="display:flex;align-items:center;padding:14px 20px 6px;">';
        h += '<div style="width:3px;height:14px;border-radius:2px;background:' + color + ';margin-right:8px;"></div>';
        h += '<span style="font-size:14px;font-weight:bold;color:#1A1A2E;">' + title + '</span>';
        if (cur) { h += '<span style="margin-left:8px;font-size:11px;color:#06B6D4;background:#F0F4FF;padding:1px 6px;border-radius:4px;">已设置</span>'; }
        h += '</div><div style="display:flex;flex-wrap:wrap;gap:6px;padding:4px 20px 8px;">';
        var def = !cur;
        h += '<div class="' + cls + '" data-d="0" style="padding:5px 12px;border-radius:6px;cursor:pointer;font-size:13px;border:1px solid ' + (def ? color : '#E0E0E0') + ';color:' + (def ? color : '#6B7280') + ';background:' + (def ? bg : '#fff') + ';">默认</div>';
        for (var i = 0; i < ids.length; i++) {
          var id = ids[i]; var act = cur === id;
          h += '<div class="' + cls + '" data-d="' + id + '" style="padding:5px 12px;border-radius:6px;cursor:pointer;font-size:13px;border:1px solid ' + (act ? color : '#E0E0E0') + ';color:' + (act ? color : '#374151') + ';background:' + (act ? bg : '#fff') + ';">' + confName(CF, id, pre) + '</div>';
        }
        h += '</div><div style="height:0.5px;background:#E0E0E0;margin:0 20px;"></div>';
        return h;
      }

      function save() {
        if (window.__h5web_saveSkinOverrides) {
          window.__h5web_saveSkinOverrides();
        } else {
          try {
            var k = window.__h5web_skinCurRoleId ? '__h5web_skinOverrides_' + window.__h5web_skinCurRoleId : null;
            if (k) localStorage.setItem(k, JSON.stringify(ov));
          } catch(e) {}
        }
      }

      function skinName(sid) {
        try {
          var s = SC && SC.getById(sid);
          if (s && s.skinName) {
            if (LC && LC.getByKey) {
              try { var lang = LC.getByKey(s.skinName); if (lang && lang.chinese) return lang.chinese; } catch(e) {}
            }
            if (/[\u4e00-\u9fff]/.test(s.skinName)) return s.skinName;
            return s.skinName;
          }
        } catch(e) {}
        return 'ID:' + sid;
      }

      function heroName(hid) {
        var bs = baseSkins[hid] || hid;
        var sn = skinName(bs);
        if (sn && sn.indexOf('ID:') !== 0) return sn;
        try {
          var saved = ov[hid];
          delete ov[hid];
          var h = ROLE && ROLE.getHeroById(hid);
          if (h) {
            var n = h.realSkinName;
            if (saved) ov[hid] = saved;
            if (n) {
              if (LC && LC.getByKey) {
                try { var lang = LC.getByKey(n); if (lang && lang.chinese) return lang.chinese; } catch(e) {}
              }
              return n;
            }
          }
          if (saved) ov[hid] = saved;
        } catch(e) {}
        return 'ID:' + hid;
      }

      var hnCache = {};
      for (var k in origLists) hnCache[k] = heroName(parseInt(k));

      // 遮罩层
      var mask = document.createElement('div');
      mask.id = '__yc_skmask';
      mask.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.4);z-index:99999;display:none;';
      document.body.appendChild(mask);

      // 底部弹出面板（模拟原生 BottomSheet）
      var panel = document.createElement('div');
      panel.id = '__yc_skpanel';
      panel.style.cssText = 'position:fixed;left:0;right:0;bottom:0;max-height:80vh;background:#fff;border-radius:16px 16px 0 0;z-index:100000;display:none;flex-direction:column;font-family:-apple-system,sans-serif;color:#1A1A2E;font-size:14px;transition:transform 0.2s ease;';
      document.body.appendChild(panel);

      // 固定头部
      var header = document.createElement('div');
      header.style.cssText = 'flex-shrink:0;background:#fff;border-radius:16px 16px 0 0;padding-bottom:4px;touch-action:none;';
      header.innerHTML = '<div style="display:flex;justify-content:center;padding:12px 0 10px;"><div style="width:36px;height:5px;border-radius:3px;background:#9CA3AF;"></div></div><div style="padding:0 20px 4px;font-size:17px;font-weight:bold;color:#1A1A2E;">皮肤管理</div><div style="height:0.5px;background:#E0E0E0;margin:8px 20px 0;"></div>';
      panel.appendChild(header);

      // 可滚动内容区
      var body = document.createElement('div');
      body.style.cssText = 'flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding-bottom:env(safe-area-inset-bottom,16px);';
      panel.appendChild(body);

      // 下滑关闭手势
      var startY = 0, curY = 0, dragging = false;
      header.addEventListener('touchstart', function(e) { startY = e.touches[0].clientY; curY = startY; dragging = true; panel.style.transition = 'none'; });
      header.addEventListener('touchmove', function(e) {
        if (!dragging) return;
        curY = e.touches[0].clientY;
        var dy = curY - startY;
        if (dy > 0) panel.style.transform = 'translateY(' + dy + 'px)';
      });
      header.addEventListener('touchend', function() {
        if (!dragging) return;
        dragging = false;
        panel.style.transition = 'transform 0.2s ease';
        if (curY - startY > 80) { hidePanel(); }
        panel.style.transform = '';
      });

      function build() {
        var h = '';
        // 恢复默认
        h += '<div id="__yc_skreset" style="margin:12px 20px;padding:8px 0;border-radius:8px;text-align:center;cursor:pointer;font-size:13px;color:#EF4444;border:1px solid #FCA5A5;background:#FEF2F2;">恢复全部默认</div>';

        // 主公皮肤分区（装扮 #1）
        try {
          var lids = lordList();
          if (lids.length) {
            var lcur = window.__h5web_lordOverride || 0;
            h += '<div style="display:flex;align-items:center;padding:14px 20px 6px;">';
            h += '<div style="width:3px;height:14px;border-radius:2px;background:#A855F7;margin-right:8px;"></div>';
            h += '<span style="font-size:14px;font-weight:bold;color:#1A1A2E;">主公皮肤</span>';
            if (lcur) { h += '<span style="margin-left:8px;font-size:11px;color:#06B6D4;background:#F0F4FF;padding:1px 6px;border-radius:4px;">已设置·回大厅查看</span>'; }
            h += '</div>';
            h += '<div style="display:flex;flex-wrap:wrap;gap:6px;padding:4px 20px 8px;">';
            var ldef = !lcur;
            h += '<div class="__yc_lord" data-l="0" style="padding:5px 12px;border-radius:6px;cursor:pointer;font-size:13px;border:1px solid ' + (ldef ? '#A855F7' : '#E0E0E0') + ';color:' + (ldef ? '#A855F7' : '#6B7280') + ';background:' + (ldef ? '#FAF5FF' : '#fff') + ';">默认</div>';
            for (var li = 0; li < lids.length; li++) {
              var lid = lids[li]; var lact = lcur === lid;
              h += '<div class="__yc_lord" data-l="' + lid + '" style="padding:5px 12px;border-radius:6px;cursor:pointer;font-size:13px;border:1px solid ' + (lact ? '#A855F7' : '#E0E0E0') + ';color:' + (lact ? '#A855F7' : '#374151') + ';background:' + (lact ? '#FAF5FF' : '#fff') + ';">' + lordName(lid) + '</div>';
            }
            h += '</div>';
            h += '<div style="height:0.5px;background:#E0E0E0;margin:0 20px;"></div>';
          }
        } catch(e) {}

        // 头像框分区（装扮 #2）
        try {
          var fids = frameList();
          if (fids.length) {
            var fcur = window.__h5web_frameOverride || 0;
            h += '<div style="display:flex;align-items:center;padding:14px 20px 6px;">';
            h += '<div style="width:3px;height:14px;border-radius:2px;background:#F59E0B;margin-right:8px;"></div>';
            h += '<span style="font-size:14px;font-weight:bold;color:#1A1A2E;">头像框</span>';
            if (fcur) { h += '<span style="margin-left:8px;font-size:11px;color:#06B6D4;background:#F0F4FF;padding:1px 6px;border-radius:4px;">已设置</span>'; }
            h += '</div>';
            h += '<div style="display:flex;flex-wrap:wrap;gap:6px;padding:4px 20px 8px;">';
            var fdef = !fcur;
            h += '<div class="__yc_frame" data-f="0" style="padding:5px 12px;border-radius:6px;cursor:pointer;font-size:13px;border:1px solid ' + (fdef ? '#F59E0B' : '#E0E0E0') + ';color:' + (fdef ? '#F59E0B' : '#6B7280') + ';background:' + (fdef ? '#FFFBEB' : '#fff') + ';">默认</div>';
            for (var fi = 0; fi < fids.length; fi++) {
              var fid = fids[fi]; var fact = fcur === fid;
              h += '<div class="__yc_frame" data-f="' + fid + '" style="padding:5px 12px;border-radius:6px;cursor:pointer;font-size:13px;border:1px solid ' + (fact ? '#F59E0B' : '#E0E0E0') + ';color:' + (fact ? '#F59E0B' : '#374151') + ';background:' + (fact ? '#FFFBEB' : '#fff') + ';">' + frameName(fid) + '</div>';
            }
            h += '</div>';
            h += '<div style="height:0.5px;background:#E0E0E0;margin:0 20px;"></div>';
          }
        } catch(e) {}

        // 竞技场景（装扮 #3）+ 个性名片（装扮 #4）+ 盐场飞艇（#5）+ 击杀特效（#6）
        try { var __pl = confList(PVPC), __cl = confList(CCC), __al = confList(ASC), __ml = confList(MKC); console.log(TAG + ' 面板装扮选项: 竞技场景=' + __pl.length + ' 名片=' + __cl.length + ' 飞艇=' + __al.length + ' 连杀=' + __ml.length); h += decoSectionHtml('竞技场景', '#10B981', '#ECFDF5', '__yc_pvpmap', window.__h5web_pvpMapOverride || 0, __pl, PVPC, '场景#'); h += decoSectionHtml('个性名片', '#EC4899', '#FDF2F8', '__yc_card', window.__h5web_cardOverride || 0, __cl, CCC, '名片#'); h += decoSectionHtml('盐场飞艇', '#0EA5E9', '#E0F2FE', '__yc_airship', window.__h5web_airshipOverride || 0, __al, ASC, '飞艇#'); h += decoSectionHtml('击杀特效', '#F59E0B', '#FEF3C7', '__yc_multikill', window.__h5web_multiKillOverride || 0, __ml, MKC, '连杀#'); } catch(e) { try { console.log(TAG + ' 面板装扮渲染异常: ' + e); } catch(e2){} }

        var ids = Object.keys(origLists).sort(function(a, b) { return a - b; });
        for (var i = 0; i < ids.length; i++) {
          var hid = parseInt(ids[i]);
          var skins = origLists[hid];
          if (!skins || skins.length < 1) continue;
          var bs = baseSkins[hid] || hid;
          var extra = 0;
          for (var ei = 0; ei < skins.length; ei++) if (skins[ei] !== hid && skins[ei] !== bs) extra++;
          if (extra < 1) continue;
          var cur = ov[hid] || 0;
          var hn = hnCache[hid] || heroName(hid);

          // 英雄分区标题（蓝色竖条 + 粗体名）
          h += '<div style="display:flex;align-items:center;padding:14px 20px 6px;">';
          h += '<div style="width:3px;height:14px;border-radius:2px;background:#3B82F6;margin-right:8px;"></div>';
          h += '<span style="font-size:14px;font-weight:bold;color:#1A1A2E;">' + hn + '</span>';
          if (cur) { h += '<span style="margin-left:8px;font-size:11px;color:#06B6D4;background:#F0F4FF;padding:1px 6px;border-radius:4px;">已设置</span>'; }
          h += '</div>';

          // 皮肤选项
          h += '<div style="display:flex;flex-wrap:wrap;gap:6px;padding:4px 20px 8px;">';
          var isDef = !cur;
          h += '<div class="__yc_si" data-h="' + hid + '" data-s="0" style="padding:5px 12px;border-radius:6px;cursor:pointer;font-size:13px;border:1px solid ' + (isDef ? '#3B82F6' : '#E0E0E0') + ';color:' + (isDef ? '#3B82F6' : '#6B7280') + ';background:' + (isDef ? '#EFF6FF' : '#fff') + ';">默认</div>';
          for (var j = 0; j < skins.length; j++) {
            var sid = skins[j];
            if (sid === hid || sid === bs) continue;
            var act = cur === sid;
            h += '<div class="__yc_si" data-h="' + hid + '" data-s="' + sid + '" style="padding:5px 12px;border-radius:6px;cursor:pointer;font-size:13px;border:1px solid ' + (act ? '#3B82F6' : '#E0E0E0') + ';color:' + (act ? '#3B82F6' : '#374151') + ';background:' + (act ? '#EFF6FF' : '#fff') + ';">' + skinName(sid) + '</div>';
          }
          h += '</div>';
          // 分割线
          h += '<div style="height:0.5px;background:#E0E0E0;margin:0 20px;"></div>';
        }
        h += '<div style="height:16px;"></div>';
        body.innerHTML = h;
      }

      function showPanel() { build(); mask.style.display = 'block'; panel.style.display = 'flex'; panel.style.transform = ''; }
      function hidePanel() { mask.style.display = 'none'; panel.style.display = 'none'; panel.style.transform = ''; }
      window.__h5web_showSkinPicker = showPanel;
      window.__h5web_hideSkinPicker = hidePanel;
      mask.addEventListener('click', hidePanel);

      body.addEventListener('click', function(e) {
        var t = e.target;
        if (t.classList.contains('__yc_lord')) {
          var lid = parseInt(t.dataset.l) || 0;
          window.__h5web_lordOverride = lid;
          try { var lk2 = lordKey(); if (lk2) { if (lid) localStorage.setItem(lk2, '' + lid); else localStorage.removeItem(lk2); } } catch(ex) {}
          build();
          return;
        }
        if (t.classList.contains('__yc_frame')) {
          var fid = parseInt(t.dataset.f) || 0;
          window.__h5web_frameOverride = fid;
          try { var fk2 = frameKey(); if (fk2) { if (fid) localStorage.setItem(fk2, '' + fid); else localStorage.removeItem(fk2); } } catch(ex) {}
          build();
          return;
        }
        if (t.classList.contains('__yc_pvpmap')) {
          var pid = parseInt(t.dataset.d) || 0;
          window.__h5web_pvpMapOverride = pid;
          window.__yc_pvpLogN = 0; window.__yc_pvpLogF = 0;
          try { var pk2 = pvpKey(); if (pk2) { if (pid) localStorage.setItem(pk2, '' + pid); else localStorage.removeItem(pk2); } } catch(ex) {}
          try { if (pid && window.__ycPreloadOverrideScene) window.__ycPreloadOverrideScene(); } catch(ex) {}
          try { console.log(TAG + ' Phase10 竞技场景 已选 override=' + pid + '（竞技场即时生效；主线/home 做一场战斗或重登后生效）'); } catch(ex) {}
          build();
          return;
        }
        if (t.classList.contains('__yc_card')) {
          var cid = parseInt(t.dataset.d) || 0;
          window.__h5web_cardOverride = cid;
          try { var ck2 = cardKey(); if (ck2) { if (cid) localStorage.setItem(ck2, '' + cid); else localStorage.removeItem(ck2); } } catch(ex) {}
          try { console.log(TAG + ' Phase10 个性名片 已选 override=' + cid); } catch(ex) {}
          build();
          return;
        }
        if (t.classList.contains('__yc_airship')) {
          var aid = parseInt(t.dataset.d) || 0;
          window.__h5web_airshipOverride = aid;
          try { var ak2 = airKey(); if (ak2) { if (aid) localStorage.setItem(ak2, '' + aid); else localStorage.removeItem(ak2); } } catch(ex) {}
          try { console.log(TAG + ' Phase12 盐场飞艇 已选 override=' + aid + '（进盐场/军团战查看）'); } catch(ex) {}
          build();
          return;
        }
        if (t.classList.contains('__yc_multikill')) {
          var mid = parseInt(t.dataset.d) || 0;
          window.__h5web_multiKillOverride = mid;
          try { var mk2 = mkKey(); if (mk2) { if (mid) localStorage.setItem(mk2, '' + mid); else localStorage.removeItem(mk2); } } catch(ex) {}
          try { console.log(TAG + ' Phase13 击杀特效 已选 override=' + mid + '（进盐场/军团战连杀查看）'); } catch(ex) {}
          build();
          return;
        }
        if (t.id === '__yc_skreset') {
          for (var k2 in ov) {
            try { var hr = ROLE.getHeroById(parseInt(k2)); if (hr) { hr.skinId = 0; hr.useSkin = 0; } } catch(ex) {}
            delete ov[k2];
          }
          save(); build();
          return;
        }
        if (t.classList.contains('__yc_si')) {
          var hid = parseInt(t.dataset.h);
          var sid = parseInt(t.dataset.s);
          if (sid === 0) {
            delete ov[hid];
            try { var hr2 = ROLE.getHeroById(hid); if (hr2) { hr2.skinId = 0; hr2.useSkin = 0; } } catch(ex) {}
          } else {
            ov[hid] = sid;
            try { var hr3 = ROLE.getHeroById(hid); if (hr3) { hr3.skinId = sid; hr3.useSkin = sid; } } catch(ex) {}
          }
          save(); build();
        }
      });
    }

    waitReady();
  })();

  console.log(TAG + ' 已注入，Phase 1/2/3 启动中');
})();
