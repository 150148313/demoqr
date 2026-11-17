// ==UserScript==
// @name         XYZW Click + Box Enhancement
// @namespace    https://hortorgames.local/game-agent
// @version      0.1.0
// @description  Continuous click, torch quantity use, and box opening enhancements bundled as one Tampermonkey userscript.
// @match        *://*/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function() {
  "use strict";
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
  const getSearchParams = () => new URLSearchParams(window.location.search);
  const getEmbedInstanceId = () => {
    const win = window;
    if (typeof win.__XYZW_INSTANCE_ID__ === "string" && win.__XYZW_INSTANCE_ID__.trim()) {
      return win.__XYZW_INSTANCE_ID__.trim();
    }
    const params = getSearchParams();
    const raw = params.get("instance") || params.get("pane_id");
    return raw?.trim() || null;
  };
  const getEmbedPaneId = () => {
    const params = getSearchParams();
    return params.get("pane_id")?.trim() || getEmbedInstanceId();
  };
  const getEmbedGameRoleId = () => {
    const params = getSearchParams();
    return params.get("game_role_id")?.trim() || params.get("role_id")?.trim() || null;
  };
  const HOST_WINDOW_MESSAGE_SOURCE = "xyzwbot-host";
  const CONTINUOUS_CLICK_STYLE_ID = "xyzw-continuous-click-style";
  const CONTINUOUS_CLICK_ROOT_CLASS = "xyzw-continuous-click-enabled";
  const CONTINUOUS_CLICK_EVENT_MARKER = "__xyzw_continuous_click__";
  const OPERATION_SYNC_REPLAY_MARKER = "__xyzw_operation_sync_replay__";
  const CONTINUOUS_CLICK_DEBUG_STORAGE_KEY = "xyzw_continuous_click_debug";
  const DEFAULT_ENABLED = true;
  const DEFAULT_FRAME_INTERVAL = 1;
  const DEFAULT_DELAY_MS = 350;
  const MIN_FRAME_INTERVAL = 1;
  const MAX_FRAME_INTERVAL = 30;
  const MIN_DELAY_MS = 200;
  const MAX_DELAY_MS = 1e3;
  const MOVE_CANCEL_THRESHOLD_PX = 10;
  let continuousClickDebugEnabledCache = null;
  const clampNumber = (value, fallback, min, max) => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return fallback;
    }
    return Math.min(max, Math.max(min, Math.trunc(value)));
  };
  const normalizeConfig = (payload) => ({
    enabled: payload?.enabled ?? DEFAULT_ENABLED,
    frameInterval: clampNumber(
      payload?.frame_interval,
      DEFAULT_FRAME_INTERVAL,
      MIN_FRAME_INTERVAL,
      MAX_FRAME_INTERVAL
    ),
    delayMs: clampNumber(
      payload?.delay_ms,
      DEFAULT_DELAY_MS,
      MIN_DELAY_MS,
      MAX_DELAY_MS
    )
  });
  const markContinuousClickEvent = (event) => {
    try {
      Object.defineProperty(event, CONTINUOUS_CLICK_EVENT_MARKER, {
        value: true,
        configurable: true
      });
      Object.defineProperty(event, OPERATION_SYNC_REPLAY_MARKER, {
        value: true,
        configurable: true
      });
    } catch {
    }
    return event;
  };
  const isSyntheticEvent = (event) => {
    const candidate = event;
    return candidate[CONTINUOUS_CLICK_EVENT_MARKER] === true || candidate[OPERATION_SYNC_REPLAY_MARKER] === true;
  };
  const isContinuousClickDebugEnabled = () => {
    if (window.__XYZW_CONTINUOUS_CLICK_DEBUG__ === true) {
      return true;
    }
    if (continuousClickDebugEnabledCache != null) {
      return continuousClickDebugEnabledCache;
    }
    try {
      const queryValue = new URLSearchParams(window.location.search).get(
        CONTINUOUS_CLICK_DEBUG_STORAGE_KEY
      );
      if (queryValue != null) {
        continuousClickDebugEnabledCache = queryValue !== "0" && queryValue !== "false";
        return continuousClickDebugEnabledCache;
      }
      const storageValue = window.sessionStorage?.getItem(CONTINUOUS_CLICK_DEBUG_STORAGE_KEY) ?? window.localStorage?.getItem(CONTINUOUS_CLICK_DEBUG_STORAGE_KEY);
      if (storageValue === "0" || storageValue === "false" || storageValue === "no") {
        continuousClickDebugEnabledCache = false;
        return false;
      }
      if (storageValue === "1" || storageValue === "true" || storageValue === "yes") {
        continuousClickDebugEnabledCache = true;
        return true;
      }
    } catch {
      continuousClickDebugEnabledCache = false;
      return false;
    }
    continuousClickDebugEnabledCache = false;
    return false;
  };
  const debugContinuousClick = (label, details) => {
    if (!isContinuousClickDebugEnabled()) {
      return;
    }
    try {
      console.debug("[xyzw continuous-click]", label, details ?? {});
    } catch {
    }
  };
  const getRuntimeCanvasElement = () => {
    const runtime = window;
    const candidate = runtime.cc?.game?.canvas ?? runtime.cc?.view?._canvas ?? document.querySelector("canvas");
    return candidate instanceof HTMLCanvasElement ? candidate : null;
  };
  const resolveContinuousClickTarget = (target) => {
    if (!(target instanceof Element)) {
      return null;
    }
    const canvas = getRuntimeCanvasElement();
    if (!canvas) {
      return null;
    }
    return target === canvas ? canvas : null;
  };
  const describeEventTarget = (target) => {
    if (!(target instanceof Element)) {
      return null;
    }
    const tagName = target.tagName.toLowerCase();
    const id = target.id ? `#${target.id}` : "";
    const className = typeof target.className === "string" && target.className ? `.${target.className.trim().split(/\s+/).join(".")}` : "";
    return `${tagName}${id}${className}`;
  };
  const describeTouchList = (touches) => Array.from(touches).map((touch) => ({
    identifier: touch.identifier,
    target: describeEventTarget(touch.target),
    clientX: touch.clientX,
    clientY: touch.clientY
  }));
  const describeError = (error) => {
    if (error instanceof Error) {
      return `${error.name}: ${error.message}`;
    }
    return String(error);
  };
  const getCocosTouchDiagnostics = () => {
    const cocos = window.cc;
    const eventManager = cocos?.internal?.eventManager;
    const inputManager = cocos?.internal?.inputManager;
    let touchIds = null;
    try {
      const touches = inputManager?.getGlobalTouches?.();
      if (touches && typeof touches === "object") {
        touchIds = Object.keys(touches);
      }
    } catch {
      touchIds = null;
    }
    return {
      enableMultiTouch: cocos?.macro?.ENABLE_MULTI_TOUCH ?? null,
      hasCurrentTouch: Boolean(eventManager?._currentTouch),
      currentTouchListenerNode: eventManager?._currentTouchListener?._node?.name ?? null,
      currentTouchListenerActive: eventManager?._currentTouchListener?._node?.activeInHierarchy ?? null,
      globalTouchCount: inputManager?.getGlobalTouchCount?.() ?? null,
      globalTouchIds: touchIds
    };
  };
  const getCocosInputManager = () => {
    const inputManager = window.cc?.internal?.inputManager;
    return inputManager ?? null;
  };
  const describeCocosTouch = (touch) => {
    if (!touch) {
      return null;
    }
    return {
      id: touch.getID?.() ?? null,
      x: touch.getLocationX?.() ?? touch._point?.x ?? null,
      y: touch.getLocationY?.() ?? touch._point?.y ?? null
    };
  };
  const decorateMouseLikeEvent = (event, state) => {
    const scrollX = window.scrollX || document.documentElement.scrollLeft || document.body.scrollLeft || 0;
    const scrollY = window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
    const patch = {
      pageX: state.clientX + scrollX,
      pageY: state.clientY + scrollY,
      screenX: state.clientX,
      screenY: state.clientY,
      x: state.clientX,
      y: state.clientY,
      which: state.button + 1
    };
    for (const [key, value] of Object.entries(patch)) {
      try {
        Object.defineProperty(event, key, {
          value,
          configurable: true
        });
      } catch {
      }
    }
    return event;
  };
  class ContinuousClickController {
    constructor() {
      this.config = normalizeConfig();
      this.activePresses = /* @__PURE__ */ new Map();
      this.installed = false;
      this.handlePointerDown = (event) => {
        debugContinuousClick("pointerdown:received", {
          pointerId: event.pointerId,
          pointerType: event.pointerType,
          button: event.button,
          buttons: event.buttons,
          isPrimary: event.isPrimary,
          cancelable: event.cancelable,
          target: describeEventTarget(event.target),
          clientX: event.clientX,
          clientY: event.clientY
        });
        if (!this.config.enabled || isSyntheticEvent(event)) {
          debugContinuousClick("pointerdown:ignored", {
            reason: !this.config.enabled ? "disabled" : "synthetic",
            pointerId: event.pointerId,
            pointerType: event.pointerType
          });
          return;
        }
        if (event.pointerType === "mouse" && event.button !== 0) {
          debugContinuousClick("pointerdown:ignored", {
            reason: "non-primary-mouse-button",
            pointerId: event.pointerId,
            button: event.button
          });
          return;
        }
        const target = resolveContinuousClickTarget(event.target);
        if (!target) {
          debugContinuousClick("pointerdown:ignored", {
            reason: "target-not-runtime-canvas",
            pointerId: event.pointerId,
            target: describeEventTarget(event.target)
          });
          return;
        }
        this.clearPress(event.pointerId);
        const state = {
          pointerId: event.pointerId,
          pointerType: event.pointerType || "mouse",
          touchIdentifier: null,
          nativeTouchReleased: false,
          target,
          startX: event.clientX,
          startY: event.clientY,
          clientX: event.clientX,
          clientY: event.clientY,
          button: event.button,
          buttons: event.buttons || 1,
          armed: false,
          framesSinceLastClick: 0,
          delayTimerId: null,
          frameRequestId: null
        };
        this.activePresses.set(event.pointerId, state);
        debugContinuousClick("pointerdown:candidate-created", {
          pointerId: state.pointerId,
          pointerType: state.pointerType,
          delayMs: this.config.delayMs,
          frameInterval: this.config.frameInterval
        });
        state.delayTimerId = window.setTimeout(() => {
          const active = this.activePresses.get(state.pointerId);
          if (!active || !this.config.enabled) {
            debugContinuousClick("candidate:delay-expired-ignored", {
              pointerId: state.pointerId,
              reason: !active ? "candidate-cleared" : "disabled",
              source: "pointer"
            });
            return;
          }
          active.armed = true;
          active.framesSinceLastClick = 0;
          active.delayTimerId = null;
          const releasedNativeTouch = this.releaseNativeTouchBeforeRepeat(active);
          debugContinuousClick("candidate:armed", {
            pointerId: active.pointerId,
            pointerType: active.pointerType,
            touchIdentifier: active.touchIdentifier,
            releasedNativeTouch,
            source: "pointer",
            cocos: getCocosTouchDiagnostics()
          });
          if (!releasedNativeTouch) {
            this.dispatchSyntheticClick(active);
          }
          if (this.activePresses.has(active.pointerId)) {
            this.scheduleNextFrame(active);
          }
        }, this.config.delayMs);
      };
      this.handleTouchObserve = (event) => {
        if (isSyntheticEvent(event)) {
          return;
        }
        const associations = event.type === "touchstart" ? this.associateNativeTouchIdentifiers(event.changedTouches) : [];
        if (!isContinuousClickDebugEnabled()) {
          return;
        }
        debugContinuousClick("touch:observed", {
          type: event.type,
          cancelable: event.cancelable,
          defaultPrevented: event.defaultPrevented,
          target: describeEventTarget(event.target),
          touches: event.touches.length,
          targetTouches: event.targetTouches.length,
          changedTouches: describeTouchList(event.changedTouches),
          associations,
          cocos: getCocosTouchDiagnostics()
        });
      };
      this.handlePointerMove = (event) => {
        const state = this.activePresses.get(event.pointerId);
        if (!state || isSyntheticEvent(event)) {
          return;
        }
        state.clientX = event.clientX;
        state.clientY = event.clientY;
        if (!state.armed && this.getMoveDistance(state) > MOVE_CANCEL_THRESHOLD_PX) {
          debugContinuousClick("pointermove:candidate-cancelled", {
            reason: "move-threshold",
            pointerId: event.pointerId,
            pointerType: event.pointerType,
            distance: this.getMoveDistance(state)
          });
          this.clearPress(event.pointerId);
          return;
        }
        if (state.armed && event.cancelable) {
          debugContinuousClick("pointermove:prevent-default", {
            pointerId: event.pointerId,
            pointerType: event.pointerType
          });
          event.preventDefault();
        }
      };
      this.handlePointerEnd = (event) => {
        if (isSyntheticEvent(event)) {
          return;
        }
        const state = this.activePresses.get(event.pointerId);
        debugContinuousClick("pointerend:received", {
          type: event.type,
          pointerId: event.pointerId,
          pointerType: event.pointerType,
          hasCandidate: Boolean(state),
          armed: state?.armed ?? false,
          cancelable: event.cancelable
        });
        if (state?.armed && event.cancelable) {
          event.preventDefault();
        }
        this.clearPress(event.pointerId);
      };
      this.handlePointerLeave = (event) => {
        if (isSyntheticEvent(event)) {
          return;
        }
        const state = this.activePresses.get(event.pointerId);
        if (!state || event.target !== state.target) {
          debugContinuousClick("pointerleave:ignored", {
            pointerId: event.pointerId,
            pointerType: event.pointerType,
            reason: !state ? "no-active-candidate" : "different-target"
          });
          return;
        }
        debugContinuousClick("pointerleave:clear", {
          pointerId: event.pointerId,
          pointerType: event.pointerType,
          armed: state.armed
        });
        this.clearPress(event.pointerId);
      };
      this.handleContextMenu = (event) => {
        if (!this.config.enabled) {
          return;
        }
        const target = resolveContinuousClickTarget(event.target);
        if (!target) {
          return;
        }
        event.preventDefault();
      };
      this.handleVisibilityChange = () => {
        if (document.visibilityState === "hidden") {
          this.clearAll();
        }
      };
      this.clearAll = () => {
        debugContinuousClick("clear-all", {
          activeCount: this.activePresses.size
        });
        for (const pointerId of Array.from(this.activePresses.keys())) {
          this.clearPress(pointerId);
        }
      };
    }
    install() {
      if (this.installed || typeof document === "undefined") {
        return;
      }
      this.installed = true;
      this.syncEnabledStyles();
      debugContinuousClick("install", {
        hasPointerEvent: typeof window.PointerEvent === "function",
        hasTouchEvent: typeof window.TouchEvent === "function",
        hasTouch: typeof window.Touch === "function",
        maxTouchPoints: window.navigator.maxTouchPoints,
        touchActionSupported: typeof CSS !== "undefined" && typeof CSS.supports === "function" ? CSS.supports("touch-action", "none") : null,
        userAgent: window.navigator.userAgent
      });
      document.addEventListener("pointerdown", this.handlePointerDown, true);
      document.addEventListener("pointermove", this.handlePointerMove, true);
      document.addEventListener("pointerup", this.handlePointerEnd, true);
      document.addEventListener("pointercancel", this.handlePointerEnd, true);
      document.addEventListener("pointerleave", this.handlePointerLeave, true);
      document.addEventListener("touchstart", this.handleTouchObserve, {
        capture: true,
        passive: true
      });
      document.addEventListener("touchmove", this.handleTouchObserve, {
        capture: true,
        passive: true
      });
      document.addEventListener("touchend", this.handleTouchObserve, {
        capture: true,
        passive: true
      });
      document.addEventListener("touchcancel", this.handleTouchObserve, {
        capture: true,
        passive: true
      });
      document.addEventListener("contextmenu", this.handleContextMenu, true);
      document.addEventListener("visibilitychange", this.handleVisibilityChange);
      window.addEventListener("blur", this.clearAll);
    }
    configure(payload) {
      this.config = normalizeConfig(payload);
      debugContinuousClick("configure", {
        enabled: this.config.enabled,
        frameInterval: this.config.frameInterval,
        delayMs: this.config.delayMs,
        payload
      });
      this.syncEnabledStyles();
      if (!this.config.enabled) {
        this.clearAll();
      }
    }
    syncEnabledStyles() {
      this.ensureStyles();
      document.documentElement.classList.toggle(
        CONTINUOUS_CLICK_ROOT_CLASS,
        this.config.enabled
      );
    }
    ensureStyles() {
      if (document.getElementById(CONTINUOUS_CLICK_STYLE_ID)) {
        return;
      }
      const style = document.createElement("style");
      style.id = CONTINUOUS_CLICK_STYLE_ID;
      style.textContent = `
html.${CONTINUOUS_CLICK_ROOT_CLASS},
html.${CONTINUOUS_CLICK_ROOT_CLASS} body {
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
}
html.${CONTINUOUS_CLICK_ROOT_CLASS} canvas {
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
    touch-action: none;
}
`;
      document.head.appendChild(style);
    }
    clearPress(pointerId) {
      const state = this.activePresses.get(pointerId);
      if (!state) {
        return;
      }
      debugContinuousClick("candidate:clear", {
        pointerId,
        pointerType: state.pointerType,
        armed: state.armed,
        hadDelayTimer: state.delayTimerId != null,
        hadFrameRequest: state.frameRequestId != null
      });
      if (state.delayTimerId != null) {
        window.clearTimeout(state.delayTimerId);
      }
      if (state.frameRequestId != null) {
        window.cancelAnimationFrame(state.frameRequestId);
      }
      this.activePresses.delete(pointerId);
    }
    getMoveDistance(state) {
      return Math.hypot(state.clientX - state.startX, state.clientY - state.startY);
    }
    associateNativeTouchIdentifiers(touches) {
      return Array.from(touches).map((touch) => {
        const match = this.findActiveTouchPress(touch.clientX, touch.clientY);
        if (match) {
          const previousTouchIdentifier = match.state.touchIdentifier;
          match.state.touchIdentifier = touch.identifier;
          return {
            identifier: touch.identifier,
            pointerId: match.state.pointerId,
            previousTouchIdentifier,
            distance: match.distance
          };
        }
        return {
          identifier: touch.identifier,
          pointerId: null
        };
      });
    }
    findActiveTouchPress(clientX, clientY) {
      let nearest = null;
      for (const state of this.activePresses.values()) {
        if (state.pointerType !== "touch") {
          continue;
        }
        const distance = Math.hypot(state.clientX - clientX, state.clientY - clientY);
        if (!nearest || distance < nearest.distance) {
          nearest = { state, distance };
        }
      }
      if (!nearest || nearest.distance > Math.max(MOVE_CANCEL_THRESHOLD_PX, 24)) {
        return null;
      }
      return nearest;
    }
    releaseNativeTouchBeforeRepeat(state) {
      if (state.pointerType !== "touch" || state.nativeTouchReleased) {
        return false;
      }
      if (this.dispatchCocosTouchEnd(state, "native-touch:release-before-repeat")) {
        state.nativeTouchReleased = true;
        return true;
      }
      if (typeof window.Touch !== "function" || typeof window.TouchEvent !== "function") {
        debugContinuousClick("native-touch:release-skipped", {
          reason: "Touch-or-TouchEvent-constructor-unavailable",
          pointerId: state.pointerId,
          touchIdentifier: state.touchIdentifier,
          cocos: getCocosTouchDiagnostics()
        });
        return false;
      }
      const identifier = this.getTouchIdentifier(state);
      debugContinuousClick("native-touch:release-before-repeat", {
        pointerId: state.pointerId,
        touchIdentifier: state.touchIdentifier,
        releaseIdentifier: identifier,
        target: describeEventTarget(state.target),
        cocosBefore: getCocosTouchDiagnostics()
      });
      try {
        const touch = this.createTouch(state.target, state, identifier);
        state.target.dispatchEvent(
          markContinuousClickEvent(
            new TouchEvent("touchend", {
              bubbles: true,
              cancelable: true,
              composed: true,
              touches: [],
              targetTouches: [],
              changedTouches: [touch]
            })
          )
        );
        state.nativeTouchReleased = true;
        debugContinuousClick("native-touch:released", {
          pointerId: state.pointerId,
          releaseIdentifier: identifier,
          cocosAfter: getCocosTouchDiagnostics()
        });
        return true;
      } catch (error) {
        debugContinuousClick("native-touch:release-error", {
          pointerId: state.pointerId,
          touchIdentifier: state.touchIdentifier,
          error: describeError(error)
        });
        return false;
      }
    }
    dispatchCocosTouchEnd(state, source) {
      const inputManager = getCocosInputManager();
      if (!inputManager?.handleTouchesEnd) {
        debugContinuousClick("cocos-touch:end-skipped", {
          source,
          reason: "cocos-input-manager-unavailable",
          pointerId: state.pointerId,
          touchIdentifier: state.touchIdentifier
        });
        return false;
      }
      const touch = this.createCocosTouch(state.target, state, this.getTouchIdentifier(state));
      if (!touch) {
        debugContinuousClick("cocos-touch:end-skipped", {
          source,
          reason: "cocos-touch-create-failed",
          pointerId: state.pointerId,
          touchIdentifier: state.touchIdentifier,
          cocos: getCocosTouchDiagnostics()
        });
        return false;
      }
      debugContinuousClick("cocos-touch:end-before", {
        source,
        pointerId: state.pointerId,
        touchIdentifier: state.touchIdentifier,
        touch: describeCocosTouch(touch),
        cocosBefore: getCocosTouchDiagnostics()
      });
      try {
        inputManager.handleTouchesEnd([touch]);
        debugContinuousClick("cocos-touch:end-after", {
          source,
          pointerId: state.pointerId,
          touchIdentifier: state.touchIdentifier,
          cocosAfter: getCocosTouchDiagnostics()
        });
        return true;
      } catch (error) {
        debugContinuousClick("cocos-touch:end-error", {
          source,
          pointerId: state.pointerId,
          touchIdentifier: state.touchIdentifier,
          error: describeError(error)
        });
        return false;
      }
    }
    scheduleNextFrame(state) {
      if (state.frameRequestId != null) {
        return;
      }
      state.frameRequestId = window.requestAnimationFrame(() => {
        state.frameRequestId = null;
        const active = this.activePresses.get(state.pointerId);
        if (!active || !active.armed || !this.config.enabled) {
          return;
        }
        active.framesSinceLastClick += 1;
        if (active.framesSinceLastClick >= this.config.frameInterval) {
          active.framesSinceLastClick = 0;
          this.dispatchSyntheticClick(active);
        }
        if (this.activePresses.has(active.pointerId)) {
          this.scheduleNextFrame(active);
        }
      });
    }
    dispatchSyntheticClick(state) {
      if (!document.contains(state.target)) {
        debugContinuousClick("dispatch:cancelled", {
          reason: "target-detached",
          pointerId: state.pointerId,
          pointerType: state.pointerType
        });
        this.clearPress(state.pointerId);
        return;
      }
      const dispatchTarget = this.getDispatchTarget(state);
      debugContinuousClick("dispatch:synthetic-click", {
        pointerId: state.pointerId,
        pointerType: state.pointerType,
        target: describeEventTarget(dispatchTarget),
        clientX: state.clientX,
        clientY: state.clientY,
        touchIdentifier: state.touchIdentifier,
        nativeTouchReleased: state.nativeTouchReleased,
        cocos: getCocosTouchDiagnostics()
      });
      if (state.pointerType === "touch") {
        this.dispatchTouchTap(dispatchTarget, state);
      }
      this.dispatchPointerTap(dispatchTarget, state);
      this.dispatchMouseTap(dispatchTarget, state);
    }
    getDispatchTarget(state) {
      const targetAtPoint = document.elementFromPoint(state.clientX, state.clientY);
      return targetAtPoint && targetAtPoint === state.target ? targetAtPoint : state.target;
    }
    dispatchPointerTap(target, state) {
      if (typeof window.PointerEvent !== "function") {
        debugContinuousClick("dispatch:pointer-tap-skipped", {
          reason: "PointerEvent-constructor-unavailable",
          pointerId: state.pointerId
        });
        return;
      }
      const common = {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: state.clientX,
        clientY: state.clientY,
        button: state.button,
        buttons: state.buttons,
        pointerId: state.pointerId,
        pointerType: state.pointerType,
        isPrimary: true
      };
      target.dispatchEvent(markContinuousClickEvent(new PointerEvent("pointerdown", common)));
      target.dispatchEvent(
        markContinuousClickEvent(
          new PointerEvent("pointerup", {
            ...common,
            buttons: 0
          })
        )
      );
    }
    dispatchMouseTap(target, state) {
      const common = {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: state.clientX,
        clientY: state.clientY,
        button: state.button,
        buttons: state.buttons,
        detail: 1
      };
      target.dispatchEvent(
        decorateMouseLikeEvent(
          markContinuousClickEvent(new MouseEvent("mousedown", common)),
          state
        )
      );
      target.dispatchEvent(
        decorateMouseLikeEvent(
          markContinuousClickEvent(
            new MouseEvent("mouseup", {
              ...common,
              buttons: 0
            })
          ),
          state
        )
      );
      target.dispatchEvent(
        decorateMouseLikeEvent(
          markContinuousClickEvent(
            new MouseEvent("click", {
              ...common,
              buttons: 0
            })
          ),
          state
        )
      );
    }
    dispatchTouchTap(target, state) {
      if (this.dispatchCocosTouchTap(target, state)) {
        return;
      }
      if (typeof window.Touch !== "function" || typeof window.TouchEvent !== "function") {
        debugContinuousClick("dispatch:touch-tap-skipped", {
          reason: "Touch-or-TouchEvent-constructor-unavailable",
          hasTouch: typeof window.Touch === "function",
          hasTouchEvent: typeof window.TouchEvent === "function",
          pointerId: state.pointerId
        });
        return;
      }
      debugContinuousClick("dispatch:touch-tap", {
        pointerId: state.pointerId,
        pointerType: state.pointerType,
        touchIdentifier: state.touchIdentifier,
        target: describeEventTarget(target),
        cocosBefore: getCocosTouchDiagnostics()
      });
      try {
        const touch = this.createTouch(target, state, this.getTouchIdentifier(state));
        target.dispatchEvent(
          markContinuousClickEvent(
            new TouchEvent("touchstart", {
              bubbles: true,
              cancelable: true,
              composed: true,
              touches: [touch],
              targetTouches: [touch],
              changedTouches: [touch]
            })
          )
        );
        target.dispatchEvent(
          markContinuousClickEvent(
            new TouchEvent("touchend", {
              bubbles: true,
              cancelable: true,
              composed: true,
              touches: [],
              targetTouches: [],
              changedTouches: [touch]
            })
          )
        );
        debugContinuousClick("dispatch:touch-tap-complete", {
          pointerId: state.pointerId,
          touchIdentifier: state.touchIdentifier,
          cocosAfter: getCocosTouchDiagnostics()
        });
      } catch (error) {
        debugContinuousClick("dispatch:touch-tap-error", {
          pointerId: state.pointerId,
          error: describeError(error)
        });
        throw error;
      }
    }
    dispatchCocosTouchTap(target, state) {
      const inputManager = getCocosInputManager();
      if (!inputManager?.handleTouchesBegin || !inputManager.handleTouchesEnd) {
        debugContinuousClick("dispatch:cocos-touch-tap-skipped", {
          reason: "cocos-input-manager-unavailable",
          pointerId: state.pointerId,
          touchIdentifier: state.touchIdentifier
        });
        return false;
      }
      const touch = this.createCocosTouch(target, state, this.getTouchIdentifier(state));
      if (!touch) {
        debugContinuousClick("dispatch:cocos-touch-tap-skipped", {
          reason: "cocos-touch-create-failed",
          pointerId: state.pointerId,
          touchIdentifier: state.touchIdentifier,
          cocos: getCocosTouchDiagnostics()
        });
        return false;
      }
      debugContinuousClick("dispatch:cocos-touch-tap", {
        pointerId: state.pointerId,
        pointerType: state.pointerType,
        touchIdentifier: state.touchIdentifier,
        touch: describeCocosTouch(touch),
        target: describeEventTarget(target),
        cocosBefore: getCocosTouchDiagnostics()
      });
      try {
        inputManager.handleTouchesBegin([touch]);
        inputManager.handleTouchesEnd([touch]);
        debugContinuousClick("dispatch:cocos-touch-tap-complete", {
          pointerId: state.pointerId,
          touchIdentifier: state.touchIdentifier,
          cocosAfter: getCocosTouchDiagnostics()
        });
        return true;
      } catch (error) {
        debugContinuousClick("dispatch:cocos-touch-tap-error", {
          pointerId: state.pointerId,
          touchIdentifier: state.touchIdentifier,
          error: describeError(error)
        });
        return false;
      }
    }
    getTouchIdentifier(state) {
      return state.touchIdentifier ?? state.pointerId;
    }
    createCocosTouch(target, state, identifier) {
      const inputManager = getCocosInputManager();
      const rect = inputManager?._canvasBoundingRect ?? target.getBoundingClientRect();
      try {
        inputManager?._updateCanvasBoundingRect?.();
      } catch {
      }
      const pageX = state.clientX + window.scrollX;
      const pageY = state.clientY + window.scrollY;
      try {
        const touch = inputManager?.getTouchByXY?.(pageX, pageY, rect);
        if (touch) {
          const x = touch.getLocationX?.() ?? touch._point?.x ?? 0;
          const y = touch.getLocationY?.() ?? touch._point?.y ?? 0;
          touch.setTouchInfo?.(identifier, x, y);
          touch._setPrevPoint?.(x, y);
          return touch;
        }
      } catch (error) {
        debugContinuousClick("cocos-touch:create-via-input-manager-error", {
          pointerId: state.pointerId,
          touchIdentifier: state.touchIdentifier,
          error: describeError(error)
        });
      }
      const cocos = window.cc;
      const CocosTouchCtor = cocos?.Touch;
      if (!CocosTouchCtor) {
        return null;
      }
      try {
        const point = cocos?.view?.convertToLocationInView?.(pageX, pageY, rect) ?? { x: state.clientX, y: state.clientY };
        const touch = new CocosTouchCtor(point.x, point.y, identifier);
        touch._setPrevPoint?.(point.x, point.y);
        return touch;
      } catch (error) {
        debugContinuousClick("cocos-touch:create-error", {
          pointerId: state.pointerId,
          touchIdentifier: state.touchIdentifier,
          error: describeError(error)
        });
        return null;
      }
    }
    createTouch(target, state, identifier) {
      return new Touch({
        identifier,
        target,
        clientX: state.clientX,
        clientY: state.clientY,
        pageX: state.clientX + window.scrollX,
        pageY: state.clientY + window.scrollY,
        screenX: state.clientX,
        screenY: state.clientY,
        radiusX: 1,
        radiusY: 1,
        rotationAngle: 0,
        force: 1
      });
    }
  }
  const controller = new ContinuousClickController();
  let bridgeInstalled = false;
  const handleControlMessage = (event) => {
    const data = event.data;
    if (!data || data.source !== HOST_WINDOW_MESSAGE_SOURCE || data.type !== "continuous_click_control") {
      return;
    }
    const paneId = getEmbedPaneId();
    const gameRoleId = getEmbedGameRoleId();
    const eventGameRoleId = data.game_role_id ?? data.role_id;
    if (paneId && data.pane_id && data.pane_id !== paneId) {
      return;
    }
    if (gameRoleId && eventGameRoleId && eventGameRoleId !== gameRoleId) {
      return;
    }
    const payload = data.payload && typeof data.payload === "object" ? data.payload : null;
    if (payload?.action !== "configure_continuous_click") {
      return;
    }
    controller.configure(payload);
  };
  const installContinuousClickBridge = () => {
    controller.install();
    if (bridgeInstalled || typeof window === "undefined") {
      return;
    }
    bridgeInstalled = true;
    window.addEventListener("message", handleControlMessage);
  };
  const ModuleStore = {
    _modules: /* @__PURE__ */ new Map(),
    set(name, module) {
      this._modules.set(name, module);
      Logger.log(`模块 ${name} 已存储`);
    },
    has(name) {
      return this._modules.has(name);
    },
    getAll() {
      return Object.fromEntries(this._modules);
    }
  };
  let __internalRequire;
  const HookManager = {
    processModule(requireFunc, moduleName, handler2) {
      try {
        const module = requireFunc(moduleName);
        if (!module) {
          Logger.warn(`模块 ${moduleName} 为空`);
          return false;
        }
        if (module.__hooked) {
          Logger.log(`模块 ${moduleName} 已处理，跳过`);
          return true;
        }
        ModuleStore.set(moduleName, module);
        if (handler2) {
          const success = handler2(module);
          if (success) Logger.log(`模块 ${moduleName} Hook成功`);
          else Logger.warn(`模块 ${moduleName} Hook失败`);
        } else {
          Logger.log(`模块 ${moduleName} 无需Hook，仅存储`);
        }
        Object.defineProperty(module, "__hooked", {
          value: true,
          writable: false,
          configurable: false,
          enumerable: false
        });
        return true;
      } catch (e) {
        Logger.error(`处理模块 ${moduleName} 失败:`, e);
        return false;
      }
    },
    initialize(handlers2) {
      const self = this;
      Object.defineProperty(window, "__require", {
        configurable: true,
        set(requireFunc) {
          Logger.log("__require 设置完成");
          Object.entries(handlers2 || {}).forEach(([moduleName, handler2]) => {
            self.processModule(requireFunc, moduleName, handler2);
          });
          __internalRequire = requireFunc;
        },
        get() {
          return __internalRequire;
        }
      });
      Logger.log("Hook管理器初始化完成", (/* @__PURE__ */ new Date()).toLocaleString());
    }
  };
  function handler$4(mod) {
    const AutoClickDialog = mod?.AutoClickDialog;
    if (!AutoClickDialog?.prototype) return false;
    const proto = AutoClickDialog.prototype;
    const originalRefresh = proto._refresh;
    proto._refresh = function() {
      if (typeof originalRefresh === "function") {
        originalRefresh.call(this);
      }
      const view = this.ui;
      if (!view) return;
      const ROLE2 = window.ROLE;
      const Configs = window.__require("Configs");
      const { AutoConf, ModuleType, ResourceType } = Configs;
      const autoConfList = AutoConf.list || [];
      const ModuleManager = window.__require("ModuleManager");
      const LanguageExt = window.__require("LanguageExt");
      const GET_CONTENT = LanguageExt.GET_CONTENT;
      const tipsMod = window.__require("TipsManager");
      const { TipsManager, SHOW_TIP } = tipsMod;
      const uiIndex = window.__require("index-ui");
      const SHOW_PROXY = uiIndex.SHOW_PROXY || uiIndex.SHOW_DIALOG_DEFERRED || uiIndex.SHOW_PROXY_OVER;
      const { SHOW_SIMPLE_DIALOG, WindowCloseState } = uiIndex;
      const NormalDialog = window.__require("NormalDialog").NormalDialog;
      const consts = window.__require("consts");
      const { ModuleNameItem, ModuleNameCallback } = consts;
      const ItemUseDialog = window.__require("ItemUseDialog").ItemUseDialog;
      const torchNames = this._torchNames || ["torch0", "torch1", "torch2"];
      const lordModule = ModuleManager.GET_MODULE(ModuleType.LORD);
      for (let index = 0; index < torchNames.length; index++) {
        const conf = autoConfList[index];
        if (!conf) continue;
        const itemId = conf.id;
        const torchUI = view.getChild(torchNames[index]);
        if (!torchUI || !torchUI.m_btnUse) continue;
        const itemCount = typeof ROLE2.getItemQuantity === "function" ? ROLE2.getItemQuantity(itemId) : 0;
        const hasNoItem = !itemCount;
        if (typeof torchUI.m_btnUse.clearClick === "function") {
          torchUI.m_btnUse.clearClick();
        }
        torchUI.m_btnUse.onClick(async (event) => {
          event?.stopPropagation?.();
          if (hasNoItem) {
            SHOW_TIP(GET_CONTENT("10073"));
            return;
          }
          const currentType = ROLE2.autoClickType || 0;
          const autoAttack = !!lordModule.autoAttack;
          let confirmed = true;
          if (autoAttack && currentType !== 0 && currentType !== itemId && SHOW_SIMPLE_DIALOG && NormalDialog && WindowCloseState && LanguageExt && typeof LanguageExt.getResourceName === "function") {
            const oldItemName = LanguageExt.getResourceName(
              ResourceType.ITEM,
              currentType
            );
            const newItemName = LanguageExt.getResourceName(
              ResourceType.ITEM,
              itemId
            );
            confirmed = await new Promise((resolve) => {
              SHOW_SIMPLE_DIALOG(NormalDialog, {
                content: GET_CONTENT("10070", newItemName, oldItemName),
                hook: (state) => {
                  resolve(state === WindowCloseState.Yes);
                }
              });
            });
          }
          if (!confirmed) return;
          let desired = 1;
          if (SHOW_PROXY && ItemUseDialog && ModuleNameItem && ModuleNameCallback) {
            desired = await new Promise((resolve) => {
              SHOW_PROXY(ItemUseDialog, {
                [ModuleNameItem]: itemId,
                [ModuleNameCallback]: (_item, count) => resolve(count || 1)
              });
            });
          }
          if (!isFinite(desired) || desired <= 0) desired = 1;
          desired = Math.floor(desired);
          if (desired > itemCount) desired = itemCount;
          if (!desired) return;
          const batchRes = await lordModule.useTorchItemWithQuantity(
            itemId,
            desired
          );
          if (!batchRes) {
            return;
          }
          const successTimes = desired;
          const autoTime = conf.autoTime || 0;
          const totalSeconds = autoTime * successTimes;
          const addMinutes = Math.floor(totalSeconds / 60);
          if (addMinutes > 0 && TipsManager && TipsManager.instance && typeof TipsManager.instance.showSmallTip === "function") {
            const tipText = "+" + addMinutes + GET_CONTENT("C2_DateUtil_CONST14");
            TipsManager.instance.showSmallTip(tipText, torchUI.m_btnUse);
          }
          if (view.m_addtime && !view.m_addtime.playing) {
            view.m_addtime.play();
          }
          const levelBattleModule = ModuleManager.GET_MODULE(ModuleType.LEVEL_BATTLE);
          levelBattleModule.resetLevelBattle();
        });
      }
    };
    Logger.log("[AutoClickDialogHook] _refresh patched");
    return true;
  }
  function handler$3(mod) {
    const LordModule = mod?.LordModule;
    if (!LordModule?.prototype) return false;
    const proto = LordModule.prototype;
    if (typeof proto.useTorchItemWithQuantity !== "function") {
      proto.useTorchItemWithQuantity = function(itemId, quantity) {
        return new Promise((resolve) => {
          const dataIndex = window.__require("data-index") || {};
          const ItemService = dataIndex.ItemService;
          if (!ItemService) {
            resolve(null);
            return;
          }
          let q = Number(quantity);
          if (!isFinite(q) || q <= 0) q = 1;
          q = Math.floor(q);
          ItemService.consume({
            itemId,
            quantity: q
          }).then((res) => {
            if (!res || res.code) {
              resolve(null);
            } else {
              resolve(res);
            }
          }).catch(() => {
            resolve(null);
          });
        });
      };
    }
    Logger.log("[LordModuleHook] useTorchItemWithQuantity attached");
    return true;
  }
  function handler$2(mod) {
    const BoxModule = mod?.BoxModule;
    if (!BoxModule?.prototype) return false;
    const proto = BoxModule.prototype;
    const originalSendOpenBox = proto.sendOpenBox;
    proto.getClaimableBoxPointRewards = function() {
      const Configs = window.__require("Configs");
      const BoxStageConf = Configs?.BoxStageConf;
      const list = BoxStageConf?.list || [];
      if (!list.length) return {};
      let remainPoint = this.boxRenderPoint || 0;
      if (remainPoint <= 0) return {};
      let globalIndex = ROLE.boxPointLastReward || 0;
      const stageTotal = list.length;
      const stageCounts = new Array(stageTotal).fill(0);
      let totalCycleLimit = 0;
      for (let i = 0; i < stageTotal; i++) {
        totalCycleLimit += list[i].limit;
      }
      if (totalCycleLimit <= 0) return {};
      const startIndex = globalIndex % stageTotal;
      const orderIndices = [];
      for (let i = 0; i < stageTotal; i++) {
        const idx = (startIndex + i) % stageTotal;
        orderIndices.push(idx);
      }
      const fullCycles = Math.floor(remainPoint / totalCycleLimit);
      if (fullCycles > 0) {
        for (const idx of orderIndices) {
          stageCounts[idx] += fullCycles;
        }
        remainPoint -= fullCycles * totalCycleLimit;
        globalIndex += fullCycles * stageTotal;
      }
      const remainderStartIndex = globalIndex % stageTotal;
      for (let i = 0; i < stageTotal; i++) {
        const idx = (remainderStartIndex + i) % stageTotal;
        const conf = list[idx];
        if (remainPoint < conf.limit) break;
        stageCounts[idx] += 1;
        remainPoint -= conf.limit;
      }
      const byDescription = {};
      for (let idx = 0; idx < stageTotal; idx++) {
        const count = stageCounts[idx];
        if (!count) continue;
        const conf = list[idx];
        const key = conf.description;
        byDescription[key] = (byDescription[key] || 0) + count;
      }
      return byDescription;
    };
    proto.sendOpenBox = function(itemId, number) {
      try {
        Logger.log("[BoxModule] sendOpenBox split", { itemId, number });
        return new Promise(async (resolve) => {
          try {
            const dataIndex = window.__require("data-index");
            const ItemService = dataIndex?.ItemService;
            const DateUtil = window.__require("DateUtil")?.default;
            const Configs = window.__require("Configs");
            const ItemConf = Configs?.ItemConf;
            if (!ItemService) {
              Logger.warn(
                "[BoxModule] deps missing, fallback to original sendOpenBox"
              );
              const rewards = await originalSendOpenBox.call(
                this,
                itemId,
                number
              );
              resolve(rewards);
              return;
            }
            const allRewards = [];
            let lastCD = 0;
            let itemConf = void 0;
            try {
              itemConf = ItemConf?.getById?.(itemId);
            } catch {
            }
            let ownedLeft = typeof ROLE?.getItemQuantity === "function" ? ROLE.getItemQuantity(itemId) : number;
            let remaining = number > ownedLeft ? ownedLeft : number;
            while (remaining > 0) {
              let step = 10;
              if (typeof this.getOpenBoxNum === "function" && itemConf) {
                const allowed = this.getOpenBoxNum(
                  itemConf,
                  ownedLeft
                );
                if (allowed && allowed > 0) step = allowed;
              }
              const cur = step;
              const resp = await ItemService.openBox({
                itemId,
                number: cur
              });
              if (resp && resp.code) {
                try {
                  const ModuleManager = window.__require("ModuleManager");
                  const Configs2 = window.__require("Configs");
                  const guideModule = ModuleManager?.GET_MODULE(
                    Configs2?.ModuleType.GUIDE
                  );
                  guideModule?.guideDefer?.reject?.();
                } catch {
                }
                resolve(void 0);
                return;
              }
              try {
                const data = resp?.getData ? resp.getData() : resp?.data || resp;
                lastCD = data?.openCDTime || 0;
                const reward = data && data.reward || [];
                if (Array.isArray(reward))
                  allRewards.push(...reward);
              } catch {
              }
              remaining -= cur;
              ownedLeft -= cur;
            }
            try {
              if (DateUtil && typeof lastCD === "number") {
                this.nextOpenBoxTime = DateUtil.serverTime + 1e3 * lastCD;
              }
            } catch {
            }
            resolve(allRewards);
          } catch (e) {
            Logger.warn("[BoxModule] sendOpenBox split error:", e);
            resolve(void 0);
          }
        });
      } catch (e) {
        Logger.warn("[BoxModule] sendOpenBox hook error:", e);
        return originalSendOpenBox.call(this, itemId, number);
      }
    };
    return true;
  }
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
  const CHEST_KEYS = ["木质宝箱", "青铜宝箱", "黄金宝箱", "铂金宝箱", "钻石宝箱"];
  function getChestPoints(name) {
    switch (name) {
      case "木质宝箱":
        return 1;
      case "青铜宝箱":
        return 10;
      case "黄金宝箱":
        return 20;
      case "铂金宝箱":
        return 50;
      default:
        return 0;
    }
  }
  function addChestCounts(a, b) {
    const result = {};
    const keys = /* @__PURE__ */ new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
    for (const key of keys) {
      const v = (a?.[key] || 0) + (b?.[key] || 0);
      if (v) result[key] = v;
    }
    return result;
  }
  function calculateTotalPoints(chests) {
    if (!chests) return 0;
    let total = 0;
    for (const key of Object.keys(chests)) {
      const num = chests[key] || 0;
      if (!num) continue;
      total += getChestPoints(key) * num;
    }
    return total;
  }
  function simulateConsumableFromChests(allChests, excludedNames = []) {
    const Configs = window.__require("Configs");
    const BoxStageConf = Configs?.BoxStageConf;
    const ItemConf = Configs?.ItemConf;
    const LanguageExt = window.__require("LanguageExt");
    const GET_CONTENT = LanguageExt?.GET_CONTENT || ((k) => k);
    const list = BoxStageConf?.list || [];
    if (!list.length || !ItemConf) {
      return {
        consumablePoints: calculateTotalPoints(allChests),
        remainingExcluded: {}
      };
    }
    const excluded = new Set(excludedNames);
    const remainingExcluded = {};
    const descToChestName = {};
    for (const conf of list) {
      const desc = conf?.description;
      if (!desc || descToChestName[desc]) continue;
      const chestName = GET_CONTENT(desc);
      descToChestName[desc] = chestName;
    }
    const stageTotal = list.length;
    const totalCycleLimit = list.reduce((sum, conf) => {
      const limit = Number(conf?.limit) || 0;
      return sum + limit;
    }, 0);
    let currentConvertible = {};
    for (const [name, count] of Object.entries(allChests || {})) {
      const pts = getChestPoints(name);
      if (pts > 0 && !excluded.has(name)) {
        currentConvertible[name] = (currentConvertible[name] || 0) + count;
      } else {
        remainingExcluded[name] = (remainingExcluded[name] || 0) + count;
      }
    }
    let consumablePoints = 0;
    const ROLE2 = window.ROLE || {};
    let globalIndex = Number(ROLE2.boxPointLastReward) || 0;
    while (true) {
      let pointsThisRound = 0;
      for (const [name, count] of Object.entries(currentConvertible)) {
        const pts = getChestPoints(name);
        if (pts <= 0) continue;
        pointsThisRound += pts * (count || 0);
      }
      if (!pointsThisRound) break;
      consumablePoints += pointsThisRound;
      let remainPoints = pointsThisRound;
      const rewardByDesc = {};
      if (totalCycleLimit > 0 && remainPoints > 0) {
        const startIndex = globalIndex % stageTotal;
        const orderIndices = [];
        for (let i = 0; i < stageTotal; i++) {
          const idx = (startIndex + i) % stageTotal;
          orderIndices.push(idx);
        }
        if (remainPoints >= totalCycleLimit) {
          const fullCycles = Math.floor(remainPoints / totalCycleLimit);
          remainPoints -= fullCycles * totalCycleLimit;
          for (const idx of orderIndices) {
            const desc = list[idx]?.description;
            if (!desc) continue;
            rewardByDesc[desc] = (rewardByDesc[desc] || 0) + fullCycles;
          }
          globalIndex += fullCycles * stageTotal;
        }
        const remainderStartIndex = globalIndex % stageTotal;
        for (let i = 0; i < stageTotal; i++) {
          const idx = (remainderStartIndex + i) % stageTotal;
          const conf = list[idx];
          const need = Number(conf?.limit) || 0;
          if (!need || remainPoints < need) break;
          remainPoints -= need;
          const desc = conf?.description;
          if (!desc) continue;
          rewardByDesc[desc] = (rewardByDesc[desc] || 0) + 1;
          globalIndex += 1;
        }
      }
      const nextConvertible = {};
      for (const [desc, times] of Object.entries(rewardByDesc)) {
        if (!times) continue;
        const chestName = descToChestName[desc];
        if (!chestName) continue;
        const pts = getChestPoints(chestName);
        if (pts > 0 && !excluded.has(chestName)) {
          nextConvertible[chestName] = (nextConvertible[chestName] || 0) + times;
        } else {
          remainingExcluded[chestName] = (remainingExcluded[chestName] || 0) + times;
        }
      }
      currentConvertible = nextConvertible;
    }
    return { consumablePoints, remainingExcluded };
  }
  function formatQuantity(value) {
    if (!isFinite(value)) return "0";
    if (value >= 1e8) {
      const v = value / 1e8;
      return v.toFixed(2).replace(/\.?0+$/, "") + "亿";
    }
    if (value >= 1e5) {
      const v = value / 1e4;
      return v.toFixed(2).replace(/\.?0+$/, "") + "万";
    }
    return String(Math.round(value));
  }
  function generateAnalysisMessage(result) {
    const lines = [];
    lines.push("===== 宝箱分析结果 =====");
    lines.push("");
    lines.push("【宝箱信息】");
    for (const key of CHEST_KEYS) {
      const current = result?.["当前宝箱"]?.[key];
      const pending = result?.["待领取宝箱"]?.[key];
      let currentStr;
      if (current == null) {
        currentStr = "识别失败";
      } else {
        currentStr = `${current}个`;
        if (key === "钻石宝箱") {
          currentStr += `≈${formatQuantity(current * 352)}金砖`;
        }
      }
      const pendingStr = !pending ? "" : `（待领取${pending}个）`;
      lines.push(`${key}：${currentStr}${pendingStr}`);
    }
    lines.push("");
    lines.push("【积分情况】");
    lines.push(`原始积分: ${result?.["原始积分"] ?? 0} 分`);
    lines.push(
      `消耗积分: ${result?.["可消耗积分"] ?? 0} 分（不计算活动奖励宝箱）`
    );
    lines.push("");
    lines.push("【活动情况】");
    lines.push(`总轮数: ${(result?.["完成轮数"] ?? 0).toFixed(2)} 轮`);
    lines.push(
      `不开木质: ${(result?.["不开木质完成轮数"] ?? 0).toFixed(2)} 轮`
    );
    lines.push(
      `不开铂金: ${(result?.["不开铂金完成轮数"] ?? 0).toFixed(2)} 轮`
    );
    lines.push(
      `不开木质和铂金: ${(result?.["不开木质和铂金完成轮数"] ?? 0).toFixed(
        2
      )} 轮`
    );
    lines.push("");
    lines.push("【囤鱼情况】");
    const overflowRounds = result?.["囤鱼溢出轮数"] ?? 0;
    if (overflowRounds > 0) {
      const maxScore = result?.["囤鱼积分上限"];
      lines.push(
        `囤鱼溢出轮数: ${overflowRounds.toFixed(
          2
        )} 轮（超过 ${maxScore} 分部分）`
      );
    } else {
      lines.push("没有囤鱼溢出部分，继续努力吧！");
    }
    lines.push("");
    lines.push("=== 分析完毕，祝好运！===");
    return lines.join("\n");
  }
  function buildChestAnalysisFromGame(panel, GET_CONTENT) {
    if (!panel) return null;
    const chestCounts = {};
    for (const key of CHEST_KEYS) {
      chestCounts[key] = 0;
    }
    const boxList = panel.boxList || [];
    for (const conf of boxList) {
      const nameKey = conf?.name;
      if (!nameKey) continue;
      const displayName = GET_CONTENT(nameKey);
      if (!CHEST_KEYS.includes(displayName)) continue;
      const id = conf?.id;
      if (!id) continue;
      const quantity = window.ROLE.getItemQuantity(id) || 0;
      chestCounts[displayName] = (chestCounts[displayName] || 0) + quantity;
    }
    const ModuleManager = window.__require("ModuleManager");
    const Configs = window.__require("Configs");
    const boxModule = ModuleManager.GET_MODULE(Configs.ModuleType.BOX);
    boxModule.boxRenderPoint || 0;
    const descCounts = typeof boxModule.getClaimableBoxPointRewards === "function" ? boxModule.getClaimableBoxPointRewards() : {};
    const pendingChests = {};
    for (const [desc, times] of Object.entries(descCounts)) {
      if (!times) continue;
      const chestName = GET_CONTENT(desc);
      if (!CHEST_KEYS.includes(chestName)) continue;
      pendingChests[chestName] = (pendingChests[chestName] || 0) + times;
    }
    const SCORE_PER_ROUND = 3340;
    const MAX_SCORE = 28e3;
    const chests = chestCounts;
    const totalChests = addChestCounts(chests, pendingChests);
    const originalPoints = calculateTotalPoints(totalChests);
    const { consumablePoints } = simulateConsumableFromChests(totalChests);
    const completeRounds = (originalPoints - 100) / SCORE_PER_ROUND;
    const noWoodPoints = calculateTotalPoints(
      Object.fromEntries(
        Object.entries(chests).filter(([k]) => k !== "木质宝箱")
      )
    );
    const noWoodRounds = (noWoodPoints - 100) / SCORE_PER_ROUND;
    const noPlatinumPoints = calculateTotalPoints(
      Object.fromEntries(
        Object.entries(chests).filter(([k]) => k !== "铂金宝箱")
      )
    );
    const noPlatinumRounds = (noPlatinumPoints - 100) / SCORE_PER_ROUND;
    const noWoodPlatinumPoints = calculateTotalPoints(
      Object.fromEntries(
        Object.entries(chests).filter(
          ([k]) => k !== "木质宝箱" && k !== "铂金宝箱"
        )
      )
    );
    const noWoodPlatinumRounds = (noWoodPlatinumPoints - 100) / SCORE_PER_ROUND;
    const overflowRounds = Math.max(
      (originalPoints - MAX_SCORE - 100) / SCORE_PER_ROUND,
      0
    );
    const result = {
      当前宝箱: chests,
      待领取宝箱: pendingChests,
      原始积分: originalPoints,
      可消耗积分: consumablePoints,
      完成轮数: completeRounds,
      不开木质完成轮数: noWoodRounds,
      不开铂金完成轮数: noPlatinumRounds,
      不开木质和铂金完成轮数: noWoodPlatinumRounds,
      囤鱼溢出轮数: overflowRounds,
      囤鱼积分上限: MAX_SCORE
    };
    return generateAnalysisMessage(result);
  }
  function handler$1(mod) {
    const BoxPanel = mod.BoxPanel;
    if (!BoxPanel || !BoxPanel.prototype) return false;
    const proto = BoxPanel.prototype;
    const originalOnAwake = proto.onAwake;
    const originalOnShow = proto.onShow;
    const originalOnHide = proto.onHide;
    proto.onAwake = function() {
      if (typeof originalOnAwake === "function") {
        originalOnAwake.call(this);
      }
      const panel = this;
      const ui = panel.ui;
      const quesHelp = ui.m_quesHelp;
      const baseBtn = quesHelp.m_btnQues;
      const g = window.fgui;
      let btn = quesHelp.m_btnQuesExtra;
      if (!btn) {
        btn = g.UIPackage.createObject("ui_common", "BtnInfo2").asButton;
        quesHelp.addChild(btn);
        quesHelp.m_btnQuesExtra = btn;
      }
      const margin = 10;
      const bx = baseBtn.x;
      const by = baseBtn.y;
      const bw = baseBtn.width;
      const px = bx + bw + margin;
      const py = by;
      if (typeof btn.setXY === "function") btn.setXY(px, py);
      else {
        btn.x = px;
        btn.y = py;
      }
    };
    proto.onShow = function(...args) {
      let result;
      if (typeof originalOnShow === "function") {
        result = originalOnShow.apply(this, args);
      }
      const panel = this;
      const ui = panel.ui;
      const quesHelp = ui?.m_quesHelp;
      const baseBtn = quesHelp?.m_btnQues;
      const btn = quesHelp?.m_btnQuesExtra;
      if (!ui || !quesHelp || !baseBtn || !btn) {
        return result;
      }
      const LanguageExt = window.__require("LanguageExt") || {};
      const GET_CONTENT = LanguageExt.GET_CONTENT || ((k) => k);
      const uiIndex = window.__require("index-ui") || {};
      const SHOW_PROXY_OVER = uiIndex.SHOW_PROXY_OVER || uiIndex.SHOW_PROXY || uiIndex.SHOW_DIALOG_DEFERRED;
      const helpMod = window.__require("HelpTextDialog") || {};
      const HelpTextDialog = helpMod.HelpTextDialog;
      if (!SHOW_PROXY_OVER || !HelpTextDialog) {
        return result;
      }
      if (typeof btn.clearClick === "function") {
        btn.clearClick();
      }
      btn.onClick(() => {
        const payload = {};
        const OP_OBJ = HelpTextDialog.OP_OBJ || "op_obj";
        const OP_CONTENT = HelpTextDialog.OP_CONTENT || "op_content";
        const OP_IS_REVERSE = HelpTextDialog.OP_IS_REVERSE || "op_is_reverse";
        payload[OP_OBJ] = btn;
        const analysisText = buildChestAnalysisFromGame(panel, GET_CONTENT) || "宝箱分析失败";
        payload[OP_CONTENT] = analysisText;
        payload[OP_IS_REVERSE] = false;
        SHOW_PROXY_OVER(HelpTextDialog, payload);
      });
      return result;
    };
    proto.onHide = function(...args) {
      let result;
      if (typeof originalOnHide === "function") {
        result = originalOnHide.apply(this, args);
      }
      try {
        const panel = this;
        const ui = panel.ui;
        const quesHelp = ui?.m_quesHelp;
        const btn = quesHelp?.m_btnQuesExtra;
        if (btn && typeof btn.clearClick === "function") {
          btn.clearClick();
        }
      } catch {
      }
      return result;
    };
    proto._onClaimBoxPointReward = async function() {
      const Configs = window.__require("Configs");
      const { BoxStageConf, ConstantConf, ModuleType } = Configs;
      const ModuleManager = window.__require("ModuleManager");
      const LanguageExt = window.__require("LanguageExt");
      const GET_CONTENT = LanguageExt?.GET_CONTENT || ((k) => k);
      const tipsMod = window.__require("TipsManager");
      const { SHOW_TIP } = tipsMod || {};
      const uiIndex = window.__require("index-ui");
      const { SHOW_SIMPLE_DIALOG, WindowCloseState } = uiIndex || {};
      const normalMod = window.__require("NormalDialog");
      const NormalDialog = normalMod?.NormalDialog;
      const ROLE2 = window.ROLE || {};
      const nextReward = BoxStageConf.getById(ROLE2.boxPointLastReward + 1) || BoxStageConf.getById(1);
      const boxModule = ModuleManager.GET_MODULE(ModuleType.BOX);
      const requirePoint = nextReward.limit;
      if (boxModule.boxRenderPoint < requirePoint) {
        SHOW_TIP(
          String.format(
            GET_CONTENT("C2_BoxPanel_CONST5"),
            GET_CONTENT(nextReward.description)
          )
        );
        return;
      }
      const batchType = boxModule.batchClaimBoxPointReward;
      if (batchType === 1) {
        boxModule.sendBatchClaimBoxPointReward();
      } else if (batchType === 0) {
        boxModule.sendClaimBoxPointReward();
      } else {
        SHOW_SIMPLE_DIALOG(NormalDialog, {
          content: GET_CONTENT("C2_BoxPanel_CONST3"),
          [NormalDialog.OP_SHOW_ASK_AGAIN]: true,
          hook: (result, dialog) => {
            const rememberChoice = dialog.model.get(NormalDialog.OP_Selected) || false;
            if (result === WindowCloseState.Yes) {
              boxModule.sendBatchClaimBoxPointReward();
              if (rememberChoice) {
                boxModule.batchClaimBoxPointReward = 1;
              }
            } else if (result === WindowCloseState.No) {
              boxModule.sendClaimBoxPointReward();
              if (rememberChoice) {
                boxModule.batchClaimBoxPointReward = 0;
              }
            }
            dialog.model.set("hook", null);
          }
        });
      }
    };
    proto._onOpenBox = async function() {
      const boxList = this.boxList || [];
      const currentIndex = this._currentIndex || 0;
      if (currentIndex < 0 || currentIndex >= boxList.length) {
        return;
      }
      const ModuleManager = window.__require("ModuleManager");
      const Configs = window.__require("Configs");
      const uiIndex = window.__require("index-ui");
      const SHOW_PROXY = uiIndex.SHOW_PROXY;
      const SHOW_DIALOG_DEFERRED = uiIndex.SHOW_DIALOG_DEFERRED;
      const consts = window.__require("consts");
      const ModuleNameItem = consts.ModuleNameItem;
      const ModuleNameCallback = consts.ModuleNameCallback;
      const ItemUseDialog = window.__require("ItemUseDialog").ItemUseDialog;
      const BoxRewardsDialog = window.__require("BoxRewardsDialog").BoxRewardsDialog;
      const boxModule = ModuleManager.GET_MODULE(Configs.ModuleType.BOX);
      const boxConf = boxList[currentIndex];
      const itemId = boxConf.id;
      const quantity = window.ROLE.getItemQuantity(itemId);
      if (!quantity) {
        const guideModule = ModuleManager.GET_MODULE(
          Configs.ModuleType.GUIDE
        );
        guideModule.guideDefer.reject();
        return;
      }
      this._removeCoinAnim();
      const stepCandidate = boxModule.getOpenBoxNum(boxConf, quantity);
      let normalized = quantity;
      if (normalized !== stepCandidate) {
        normalized = await new Promise((resolve) => {
          SHOW_PROXY(ItemUseDialog, {
            [ModuleNameItem]: itemId,
            [ModuleNameCallback]: (_item, count) => resolve(count || 1)
          });
        });
        normalized = Math.ceil(normalized / stepCandidate) * stepCandidate;
        if (normalized > quantity) normalized = quantity;
      }
      let rewards = await boxModule.sendOpenBox(itemId, normalized);
      if (rewards) {
        rewards = mergeRewards(rewards);
        await SHOW_DIALOG_DEFERRED(BoxRewardsDialog, {
          itemId,
          num: normalized,
          rewards
        });
      }
      this._refresh();
      this._refreshGetPointAnim();
    };
    return true;
  }
  function handler(mod) {
    const BoxRewardsDialog = mod?.BoxRewardsDialog;
    if (!BoxRewardsDialog?.prototype) return false;
    const proto = BoxRewardsDialog.prototype;
    proto._onClickTen;
    proto._playEffects;
    proto._onClickTen = async function(e) {
      try {
        if (this._boxLock) return;
        e?.stopPropagation?.();
        const uiIndex = window.__require("index-ui") || {};
        const SHOW_PROXY = uiIndex.SHOW_PROXY;
        const consts = window.__require("consts") || {};
        const ModuleNameItem = consts.ModuleNameItem;
        const ModuleNameCallback = consts.ModuleNameCallback;
        const ItemUseDialog = window.__require("ItemUseDialog")?.ItemUseDialog;
        const ModuleManager = window.__require("ModuleManager");
        const Configs = window.__require("Configs");
        const itemId = this._itemId;
        const chosen = await new Promise((resolve) => {
          try {
            SHOW_PROXY(ItemUseDialog, { [ModuleNameItem]: itemId, [ModuleNameCallback]: (_item, count) => resolve(count || 1) });
          } catch (err) {
            Logger.warn("[BoxRewardsDialog] SHOW ItemUseDialog 失败:", err);
            resolve(1);
          }
        });
        let normalized = chosen || 1;
        try {
          const ItemConf = Configs?.ItemConf;
          const boxModule2 = ModuleManager?.GET_MODULE(Configs?.ModuleType?.BOX);
          const itemConf = ItemConf?.getById?.(itemId);
          const quantity = ROLE?.getItemQuantity ? ROLE.getItemQuantity(itemId) : 0;
          let stepCandidate = 10;
          try {
            stepCandidate = boxModule2.getOpenBoxNum(itemConf, quantity);
          } catch {
          }
          const step = quantity >= stepCandidate ? stepCandidate : quantity;
          if (quantity <= step) normalized = quantity;
          else if (normalized >= quantity) normalized = quantity;
          else {
            const floored = Math.floor(normalized / step) * step;
            normalized = Math.max(step, Math.min(floored, quantity));
          }
        } catch {
        }
        const boxModule = ModuleManager.GET_MODULE(Configs.ModuleType.BOX);
        const v = this.ui;
        const model = this.model;
        const result = await boxModule.sendOpenBox(itemId, normalized);
        if (result) {
          this._boxLock = true;
          this._skipRewards = false;
          v.m_clostText.visible = false;
          v.m_isTen.selectedPage = "false";
          v.m_isCenter.selectedPage = "false";
          model.set("rewards", result);
          this._mergeRewards(result);
          const rewards = model.get("rewards") ?? [];
          this._showEffectCompleted = false;
          v.m_rewards.numItems = rewards.length;
          v.m_rewards.scrollToView(0);
          await this._playEffects(rewards);
          return;
        } else if (result !== void 0) {
          this.close();
          return;
        }
        return;
      } catch (e2) {
        Logger.warn("[BoxRewardsDialog] _onClickTen hook error:", e2);
        return;
      }
    };
    proto._playEffects = async function(list) {
      const PromiseUtil = window.__require("PromiseUtil").default;
      window.__require("index-ui");
      window.__require("Configs");
      await PromiseUtil.wait(0.25, this.ui.node);
      const view = this.ui;
      view.onceClick(this._skipRewardAnim, this);
      view.m_rewards.touchable = false;
      for (let i = 0; i < list.length; i++) {
        if (!this.entity.enabled) return;
        list[i];
        const childIndex = view.m_rewards.itemIndexToChildIndex(i);
        if (childIndex > view.m_rewards.numChildren - 1) continue;
        const cell = view.m_rewards.getChildAt(childIndex);
        if (!cell) return;
        cell.visible = true;
        const col = view.m_rewards.columnCount;
        if (!this._skipRewards) {
          this._waitPlayEffect(cell);
          await PromiseUtil.wait(0.02, view.node);
        }
        if (!this.entity.enabled) return;
        if (2 * col < i) view.m_rewards.scrollToView(i - col, true, true);
        else view.m_rewards.scrollToView(0, false, true);
      }
      this._effectEnd();
    };
    return true;
  }
  const pass = (_mod) => true;
  const handlers = {
    AutoClickDialog: handler$4,
    LordModule: handler$3,
    BoxModule: handler$2,
    BoxPanel: handler$1,
    BoxRewardsDialog: handler,
    ModuleManager: pass,
    Configs: pass,
    LanguageExt: pass,
    TipsManager: pass,
    "index-ui": pass,
    NormalDialog: pass,
    consts: pass,
    ItemUseDialog: pass,
    DateUtil: pass,
    PromiseUtil: pass,
    HelpTextDialog: pass
  };
  const INITIALIZED_FLAG = "__XYZW_CLICK_BOX_USERSCRIPT_INITIALIZED__";
  if (window[INITIALIZED_FLAG]) {
    try {
      console.warn("[XYZW ClickBox] already initialized, skipped");
    } catch {
    }
  } else {
    Object.defineProperty(window, INITIALIZED_FLAG, {
      value: true,
      configurable: true
    });
    installContinuousClickBridge();
    HookManager.initialize(handlers);
    Logger.log("[XYZW ClickBox] userscript initialized");
  }
})();

//# sourceURL=连点物品增强.js