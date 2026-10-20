// ==UserScript==
// @name         十殿抽奖增强
// @version      1.1.0
// @description  跳过十殿（噩梦）抽奖的滚动动画：scrollToIndex 直接结算并弹出奖励。
//               修复：原版用 contentWindow.__require 在 App 内 WebView 环境是 undefined，
//               注入即抛 ReferenceError；且无等待逻辑，游戏模块未加载时直接失败。
// ==/UserScript==

(function () {
  'use strict';

  var TAG = '[十殿抽奖]';

  /**
   * 通用模块补丁器：__require 取模块 → 取同名导出类 → 替换 scrollToIndex
   * @param {string} moduleName 游戏模块名（导出类与模块同名）
   * @param {Function} impl     新的 scrollToIndex 实现
   * @returns {boolean} 是否已成功打补丁（含此前已打过）
   */
  function patchScrollToIndex(moduleName, impl) {
    try {
      var mod = window.__require(moduleName);
      var cls = mod && mod[moduleName];
      if (!cls || !cls.prototype) return false;
      if (cls.prototype.__yqGachaPatched) return true;
      cls.prototype.scrollToIndex = impl;
      cls.prototype.__yqGachaPatched = true;
      console.log(TAG + ' ✅ ' + moduleName + '.scrollToIndex 已替换（跳过滚动动画）');
      return true;
    } catch (e) {
      // 模块尚未加载（__require 抛错），等下一轮
      return false;
    }
  }

  /** 普通十殿抽奖容器：直接走单次结算 → 弹奖励 → 检查下一次抽奖 */
  function nightmareImpl() {
    try {
      this.afterOneGacha(false);
      this.popThisReward();
      this.checkNextGacha();
    } catch (e) {
      console.warn(TAG + ' NightmareGachaContainer 执行异常:', e.message);
    }
  }

  /** 星级十殿抽奖容器：直接弹奖励 → 结束抽奖 */
  function nightmareStarImpl() {
    try {
      this.popThisReward();
      this.gachaFinished();
    } catch (e) {
      console.warn(TAG + ' NightmareStarGachaContainer 执行异常:', e.message);
    }
  }

  /** 两个容器互相独立安装（可能先后加载），都成功才算完成 */
  function tryInstall() {
    if (typeof window.__require !== 'function') return false;
    var ok1 = patchScrollToIndex('NightmareGachaContainer', nightmareImpl);
    var ok2 = patchScrollToIndex('NightmareStarGachaContainer', nightmareStarImpl);
    return ok1 && ok2;
  }

  // 轮询安装（等待游戏模块加载），最多 60 次 × 500ms = 30s
  var attempts = 0;
  var timer = setInterval(function () {
    attempts++;
    if (tryInstall() || attempts > 60) {
      clearInterval(timer);
      if (attempts > 60) console.warn(TAG + ' 安装超时：十殿抽奖模块 30s 内未加载（未进入十殿场景属正常）');
    }
  }, 500);

  console.log(TAG + ' 已注入，等待游戏加载...');
})();

//# sourceURL=十殿抽奖增强.js