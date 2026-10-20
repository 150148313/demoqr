// ==UserScript==
// @name         合成整理
// @namespace    https://xyzw.local/userscripts/merge-arrange
// @version      0.1.0
// @description  增强合成玩法的自动合成和整理能力。
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
  function handler(mod) {
    const MergePlayTilesContainer = mod?.MergePlayTilesContainer;
    if (!MergePlayTilesContainer?.prototype) return false;
    const proto = MergePlayTilesContainer.prototype;
    const original_tryApplyItemDrop = proto._tryApplyItemDrop;
    proto._autoMergeAll = async function() {
      const ds = this.dataSource;
      if (!ds) return;
      const tilesUI = this.ui.m_tiles;
      let foundMerge = true;
      while (foundMerge) {
        foundMerge = false;
        const itemIndexMap = /* @__PURE__ */ new Map();
        ds.tiles.forEach((tile, index) => {
          if (!tile) return;
          if (tile.gridType !== 2) return;
          if (!tile.canMove || !tile.canMerge) return;
          const itemConf = tile.asItemConf;
          if (!itemConf || itemConf.nextLevelMergeItemId === 0) return;
          const list = itemIndexMap.get(tile.gridItemId) ?? [];
          itemIndexMap.set(tile.gridItemId, list);
          list.push(index);
        });
        for (const [_itemId, indices] of itemIndexMap) {
          if (indices.length < 2) continue;
          const fromIndex = indices[0];
          const toIndex = indices[1];
          const fromPos = ds.arrayIndexToPosition(fromIndex);
          const toPos = ds.arrayIndexToPosition(toIndex);
          if (!ds.canMergeItems(fromPos, toPos)) continue;
          foundMerge = true;
          ds.mergeItems(fromPos, toPos);
          const targetUI = tilesUI.getChildAt(toIndex);
          if (targetUI) {
            if (typeof this._resetMoveItem === "function") {
              this._resetMoveItem(targetUI.m_item);
            }
            if (typeof this.setItemIcon === "function") {
              this.setItemIcon(targetUI.m_item, ds.tiles[toIndex]);
            }
            targetUI.m_itemMerged?.play?.();
          }
          const fromUI = tilesUI.getChildAt(fromIndex);
          if (fromUI && typeof this.clearItemIcon === "function") {
            this.clearItemIcon(fromUI.m_item);
          }
          try {
            await ds.sendMergeItems(fromPos, toPos);
          } catch (e) {
            Logger.warn("[MergePlayTilesContainer] autoMerge sendMergeItems failed:", e);
          }
          await new Promise((resolve) => setTimeout(resolve, 150));
          break;
        }
      }
      await this._organizeByCategory();
    };
    proto._getItemTypeId = function(tile) {
      if (!tile || tile.gridType !== 2) return -1;
      const itemConf = tile.asItemConf;
      if (!itemConf) return -1;
      return itemConf.groupId ?? -1;
    };
    proto._organizeByCategory = async function() {
      const ds = this.dataSource;
      if (!ds) {
        Logger.log("[Organize] dataSource is null, skip");
        return;
      }
      const tilesUI = this.ui.m_tiles;
      const column = ds.column;
      const row = ds.row;
      Logger.log(`[Organize] Start organizing, board size: ${column}x${row}`);
      const collectItems = () => {
        const result = /* @__PURE__ */ new Map();
        ds.tiles.forEach((tile, index) => {
          if (!tile) return;
          if (tile.gridType !== 2) return;
          if (!tile.canMove) return;
          const itemConf = tile.asItemConf;
          if (!itemConf) return;
          result.set(index, {
            typeId: this._getItemTypeId(tile),
            level: itemConf.mergeItemId
          });
        });
        return result;
      };
      const printBoard = (title, getCell) => {
        Logger.log(`[Organize] ${title}:`);
        let header = "     ";
        for (let c = 0; c < column; c++) {
          header += `  C${c}  `;
        }
        Logger.log(header);
        for (let r = 0; r < row; r++) {
          let line = `R${r}  |`;
          for (let c = 0; c < column; c++) {
            const index = r * column + c;
            const cell = getCell(index);
            line += ` ${cell.padStart(3)} |`;
          }
          Logger.log(line);
        }
      };
      const printCurrentBoard = () => {
        const items = collectItems();
        printBoard("Current Board", (index) => {
          const info = items.get(index);
          if (info) {
            return `${info.typeId}-${info.level}`;
          }
          const tile = ds.tiles[index];
          if (tile) {
            if (tile.gridType === 1) return "BOX";
            return "???";
          }
          return "   ";
        });
      };
      const printTargetBoard = (targetLayout2) => {
        printBoard("Target Layout", (index) => {
          const info = targetLayout2.get(index);
          if (info) {
            return `${info.typeId}-${info.level}`;
          }
          return "   ";
        });
      };
      const calculateTargetLayout = () => {
        const items = collectItems();
        Logger.log(`[Organize] Collected ${items.size} movable items`);
        if (items.size === 0) return /* @__PURE__ */ new Map();
        items.forEach((info, index) => {
          const pos = ds.arrayIndexToPosition(index);
          Logger.log(`[Organize]   Item at index=${index} (${pos.gridX},${pos.gridY}): groupId=${info.typeId}, level=${info.level}`);
        });
        const typeGroups = /* @__PURE__ */ new Map();
        items.forEach((info, index) => {
          const group = typeGroups.get(info.typeId) ?? [];
          typeGroups.set(info.typeId, group);
          group.push({ index, info });
        });
        typeGroups.forEach((group) => {
          group.sort((a, b) => b.info.level - a.info.level);
        });
        Logger.log(`[Organize] Found ${typeGroups.size} type groups`);
        typeGroups.forEach((group, typeId) => {
          const levels = group.map((g) => g.info.level).join(",");
          Logger.log(`[Organize]   Group ${typeId}: ${group.length} items, levels=[${levels}]`);
        });
        const sortedTypes = Array.from(typeGroups.entries()).sort((a, b) => b[1].length - a[1].length);
        const availableSlots = [];
        for (let r = 0; r < row; r++) {
          for (let c = 0; c < column; c++) {
            const index = r * column + c;
            const tile = ds.tiles[index];
            if (!tile || tile.gridType === 2 && tile.canMove) {
              availableSlots.push(index);
            }
          }
        }
        Logger.log(`[Organize] Available slots (${availableSlots.length}): ${availableSlots.join(",")}`);
        const targetLayout2 = /* @__PURE__ */ new Map();
        let slotIdx = 0;
        for (const [typeId, group] of sortedTypes) {
          Logger.log(`[Organize] Assigning group ${typeId} (${group.length} items)`);
          for (const item of group) {
            if (slotIdx >= availableSlots.length) break;
            const targetIndex = availableSlots[slotIdx];
            targetLayout2.set(targetIndex, item.info);
            const targetPos = ds.arrayIndexToPosition(targetIndex);
            Logger.log(`[Organize]   level=${item.info.level} -> targetIndex=${targetIndex} (${targetPos.gridX},${targetPos.gridY})`);
            slotIdx++;
          }
        }
        return targetLayout2;
      };
      const findItemAt = (typeId, level) => {
        for (let i = 0; i < ds.tiles.length; i++) {
          const tile = ds.tiles[i];
          if (!tile || tile.gridType !== 2 || !tile.canMove) continue;
          const itemConf = tile.asItemConf;
          if (!itemConf) continue;
          if (this._getItemTypeId(tile) === typeId && itemConf.mergeItemId === level) {
            return i;
          }
        }
        return -1;
      };
      const moveItem = async (fromIndex, toIndex) => {
        if (fromIndex === toIndex) {
          Logger.log(`[Organize] moveItem: fromIndex=${fromIndex} == toIndex, skip`);
          return true;
        }
        const fromPos = ds.arrayIndexToPosition(fromIndex);
        const toPos = ds.arrayIndexToPosition(toIndex);
        const targetTile = ds.tiles[toIndex];
        const fromUI = tilesUI.getChildAt(fromIndex);
        const targetUI = tilesUI.getChildAt(toIndex);
        Logger.log(`[Organize] moveItem: ${fromIndex}(${fromPos.gridX},${fromPos.gridY}) -> ${toIndex}(${toPos.gridX},${toPos.gridY}), targetTile=${targetTile ? "exists" : "empty"}`);
        try {
          if (!targetTile) {
            if (!ds.canPutItem(fromPos, toPos)) {
              Logger.warn(`[Organize] canPutItem returned false`);
              return false;
            }
            const fromGlobal = fromUI.m_item.localToGlobal(0, 0);
            ds.putItem(fromPos, toPos);
            this.clearItemIcon?.(fromUI.m_item);
            this._resetMoveItem?.(fromUI.m_item);
            this._moveItem?.(fromGlobal, targetUI.m_item, ds.tiles[toIndex]);
            await ds.sendPutItem(fromPos, toPos);
            Logger.log(`[Organize] PUT success`);
            return true;
          } else if (targetTile.canMove) {
            if (!ds.canMoveItem(fromPos, toPos)) {
              Logger.warn(`[Organize] canMoveItem returned false`);
              return false;
            }
            const fromGlobal = fromUI.m_item.localToGlobal(0, 0);
            const toGlobal = targetUI.m_item.localToGlobal(0, 0);
            this.clearItemIcon?.(fromUI.m_item);
            this.clearItemIcon?.(targetUI.m_item);
            this._resetMoveItem?.(fromUI.m_item);
            this._resetMoveItem?.(targetUI.m_item);
            const swappedPos = ds.moveItems(fromPos, toPos);
            const swappedIndex = ds.positionToArrayIndex(swappedPos);
            const swappedUI = tilesUI.getChildAt(swappedIndex);
            Logger.log(`[Organize] SWAP: swappedPos=(${swappedPos.gridX},${swappedPos.gridY}), swappedIndex=${swappedIndex}`);
            this._moveItem?.(fromGlobal, targetUI.m_item, ds.tiles[toIndex]);
            this._moveItem?.(toGlobal, swappedUI.m_item, ds.tiles[swappedIndex]);
            await ds.sendMoveItem(fromPos, toPos, swappedPos);
            Logger.log(`[Organize] SWAP success`);
            return true;
          } else {
            Logger.warn(`[Organize] targetTile exists but canMove=false`);
          }
        } catch (e) {
          Logger.warn("[MergePlayTilesContainer] moveItem failed:", e);
        }
        return false;
      };
      const targetLayout = calculateTargetLayout();
      if (targetLayout.size === 0) {
        Logger.log("[Organize] targetLayout is empty, nothing to organize");
        return;
      }
      printCurrentBoard();
      printTargetBoard(targetLayout);
      Logger.log(`[Organize] Target layout has ${targetLayout.size} positions`);
      const sortedTargets = Array.from(targetLayout.entries()).sort((a, b) => a[0] - b[0]);
      let moveCount = 0;
      let skipCount = 0;
      for (const [targetIndex, targetInfo] of sortedTargets) {
        const currentTile = ds.tiles[targetIndex];
        const targetPos = ds.arrayIndexToPosition(targetIndex);
        if (currentTile && currentTile.gridType === 2) {
          const currentConf = currentTile.asItemConf;
          if (currentConf && this._getItemTypeId(currentTile) === targetInfo.typeId && currentConf.mergeItemId === targetInfo.level) {
            Logger.log(`[Organize] targetIndex=${targetIndex}(${targetPos.gridX},${targetPos.gridY}): already correct, skip`);
            skipCount++;
            continue;
          }
        }
        const sourceIndex = findItemAt(targetInfo.typeId, targetInfo.level);
        if (sourceIndex < 0) {
          Logger.warn(`[Organize] targetIndex=${targetIndex}: item (type=${targetInfo.typeId}, level=${targetInfo.level}) not found!`);
          continue;
        }
        if (sourceIndex === targetIndex) {
          Logger.log(`[Organize] targetIndex=${targetIndex}: sourceIndex == targetIndex, skip`);
          skipCount++;
          continue;
        }
        const sourcePos = ds.arrayIndexToPosition(sourceIndex);
        Logger.log(`[Organize] Processing targetIndex=${targetIndex}(${targetPos.gridX},${targetPos.gridY}): need item (type=${targetInfo.typeId}, level=${targetInfo.level}), found at sourceIndex=${sourceIndex}(${sourcePos.gridX},${sourcePos.gridY})`);
        const success = await moveItem(sourceIndex, targetIndex);
        if (success) {
          moveCount++;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
      printBoard("Final Board", (index) => {
        const tile = ds.tiles[index];
        if (tile && tile.gridType === 2 && tile.canMove) {
          const itemConf = tile.asItemConf;
          if (itemConf) {
            return `${itemConf.groupId}-${itemConf.mergeItemId}`;
          }
        }
        if (tile) {
          if (tile.gridType === 1) return "BOX";
          return "???";
        }
        return "   ";
      });
      Logger.log(`[Organize] Complete: ${moveCount} moves, ${skipCount} skipped`);
    };
    proto._tryApplyItemDrop = function(fromPos, toPos) {
      const ds = this.dataSource;
      if (!ds) return false;
      const result = original_tryApplyItemDrop.call(this, fromPos, toPos);
      if (result) {
        setTimeout(() => {
          this._autoMergeAll().catch((e) => {
            Logger.warn("[MergePlayTilesContainer] autoMergeAll failed:", e);
          });
        }, 300);
      }
      return result;
    };
    Logger.log("[MergePlayTilesContainer] Auto-merge and organize hook installed");
    return true;
  }
  installUserscriptFeature({
    key: "merge-arrange",
    name: "合成整理",
    handlers: {
      MergePlayTilesContainer: handler
    }
  });
})();

//# sourceURL=怪异塔合成整理.jsॡ