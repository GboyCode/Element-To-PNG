/**
 * 内容脚本职责：
 * 1) 接收 popup 发起的“开始选择元素”指令
 * 2) 在页面内高亮 hover 元素，支持单击单选或按住拖拽连选相邻元素
 * 3) 请求后台截图 + 裁剪
 * 4) 将 PNG 写入系统剪贴板
 */

const SELECTOR_STATE = {
    enabled: false,
    hoverEl: null,
    maskEl: null,
    tipEl: null,
    cleanupFns: [],
    isPickingDone: false,
    isDragging: false,
    selectedElements: new Set(),
    dragMode: "add", // "add" 表示当前拖拽是在增选，"remove" 表示当前拖拽是在减选
    originalUserSelect: undefined
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "START_PICK_ELEMENT") {
        startElementPicking()
            .then(() => {
                sendResponse({ ok: true, message: "请在页面中单击或拖拽连选元素" });
            })
            .catch((error) => {
                sendResponse({ ok: false, message: error?.message || "启动选择器失败" });
            });
        return true;
    }

    if (message?.type === "PING_CONTENT_SCRIPT") {
        sendResponse({ ok: true });
        return false;
    }

    return false;
});

/**
 * 启动元素选择模式
 */
async function startElementPicking() {
    if (SELECTOR_STATE.enabled) {
        return;
    }

    SELECTOR_STATE.enabled = true;
    SELECTOR_STATE.isPickingDone = false;
    SELECTOR_STATE.isDragging = false;
    SELECTOR_STATE.dragMode = "add";
    SELECTOR_STATE.selectedElements.clear();

    // 临时禁用页面的文本选择，避免拖拽时选中文字
    SELECTOR_STATE.originalUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";

    installOverlay();
    bindPickerEvents();
}

/**
 * 安装高亮框与提示文案
 */
function installOverlay() {
    const mask = document.createElement("div");
    mask.style.position = "fixed";
    mask.style.left = "0";
    mask.style.top = "0";
    mask.style.width = "0";
    mask.style.height = "0";
    mask.style.border = "2px solid #5a5a4a"; /* olive-600 */
    mask.style.background = "rgba(90, 90, 74, 0.12)"; /* olive-600 with 12% opacity */
    mask.style.zIndex = "2147483646";
    mask.style.pointerEvents = "none";
    mask.style.boxSizing = "border-box";
    mask.style.transition = "all 80ms linear";

    const tip = document.createElement("div");
    tip.textContent = "选择模式：单击 或 拖拽连选相邻元素，对已选元素拖拽可取消选择，松开截图，按 Esc 取消";
    tip.style.position = "fixed";
    tip.style.left = "16px";
    tip.style.bottom = "16px";
    tip.style.padding = "8px 12px";
    tip.style.background = "rgba(11, 11, 9, 0.85)"; /* olive-950 with 85% opacity */
    tip.style.color = "#f3f3f0"; /* olive-100 */
    tip.style.fontSize = "13px";
    tip.style.lineHeight = "1.5";
    tip.style.borderRadius = "8px";
    tip.style.zIndex = "2147483647";
    tip.style.pointerEvents = "none";
    tip.style.fontFamily = '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
    tip.style.boxShadow = "0 4px 12px rgba(0, 0, 0, 0.15)";
    tip.style.backdropFilter = "blur(4px)";

    document.documentElement.style.cursor = "crosshair";
    document.body.appendChild(mask);
    document.body.appendChild(tip);

    SELECTOR_STATE.maskEl = mask;
    SELECTOR_STATE.tipEl = tip;
}

/**
 * 绑定选择过程中的鼠标与键盘事件
 */
function bindPickerEvents() {
    const onMouseMove = (event) => {
        if (!SELECTOR_STATE.enabled || SELECTOR_STATE.isPickingDone) {
            return;
        }

        const target = getValidTarget(event.clientX, event.clientY);
        if (!target) return;

        if (SELECTOR_STATE.isDragging) {
            // 拖拽连选/取消连选模式
            if (SELECTOR_STATE.dragMode === "add") {
                SELECTOR_STATE.selectedElements.add(target);
            } else if (SELECTOR_STATE.dragMode === "remove") {
                SELECTOR_STATE.selectedElements.delete(target);
            }
            const rect = getCombinedRect(SELECTOR_STATE.selectedElements);
            renderMaskByRect(rect);
        } else {
            // 悬浮预览模式
            SELECTOR_STATE.hoverEl = target;
            renderMaskByRect(target.getBoundingClientRect());
        }
    };

    const onMouseDown = (event) => {
        if (!SELECTOR_STATE.enabled || SELECTOR_STATE.isPickingDone) return;
        if (event.button !== 0) return; // 仅响应左键

        event.preventDefault();
        event.stopPropagation();

        const target = getValidTarget(event.clientX, event.clientY);
        if (target) {
            SELECTOR_STATE.isDragging = true;
            // 判断当前点击的元素是否已经被选中
            if (SELECTOR_STATE.selectedElements.has(target)) {
                // 如果已经选中，则进入减选模式，移除当前元素
                SELECTOR_STATE.dragMode = "remove";
                SELECTOR_STATE.selectedElements.delete(target);
                updateTip("正在取消选择，松开确认截图...");
            } else {
                // 如果未选中，则进入增选模式，添加当前元素
                SELECTOR_STATE.dragMode = "add";
                SELECTOR_STATE.selectedElements.add(target);
                updateTip("正在连选，松开确认截图...");
            }
            renderMaskByRect(getCombinedRect(SELECTOR_STATE.selectedElements));
        }
    };

    const onMouseUp = async (event) => {
        if (!SELECTOR_STATE.enabled || SELECTOR_STATE.isPickingDone) return;
        if (event.button !== 0 || !SELECTOR_STATE.isDragging) return;

        event.preventDefault();
        event.stopPropagation();

        SELECTOR_STATE.isDragging = false;
        SELECTOR_STATE.dragMode = "add";

        const finalRect = getCombinedRect(SELECTOR_STATE.selectedElements);
        if (!finalRect) {
            // 如果最后没有选中的区域（比如减选清空了所有），则退回悬浮预览状态
            SELECTOR_STATE.isPickingDone = false;
            updateTip("未选中任何区域，请重新选择");
            return;
        }

        SELECTOR_STATE.isPickingDone = true;

        try {
            updateTip("正在截图并写入剪贴板...");
            await copyRectAsPng(finalRect);
            updateTip("复制成功：PNG 已写入剪贴板");
        } catch (error) {
            const msg = error?.message || "复制失败";
            updateTip(`失败：${msg}`);
            throw error;
        } finally {
            // 给用户 600ms 反馈时间，再退出选择模式
            setTimeout(() => stopElementPicking(), 600);
        }
    };

    const onClick = (event) => {
        // 拦截点击事件，防止拖拽松开后触发页面原生 click 导致跳转或误操作
        if (SELECTOR_STATE.enabled || SELECTOR_STATE.isPickingDone) {
            event.preventDefault();
            event.stopPropagation();
        }
    };

    const onKeyDown = (event) => {
        if (!SELECTOR_STATE.enabled) {
            return;
        }
        if (event.key === "Escape") {
            updateTip("已取消选择");
            setTimeout(() => stopElementPicking(), 200);
        }
    };

    document.addEventListener("mousemove", onMouseMove, true);
    document.addEventListener("mousedown", onMouseDown, true);
    document.addEventListener("mouseup", onMouseUp, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKeyDown, true);

    SELECTOR_STATE.cleanupFns.push(() => document.removeEventListener("mousemove", onMouseMove, true));
    SELECTOR_STATE.cleanupFns.push(() => document.removeEventListener("mousedown", onMouseDown, true));
    SELECTOR_STATE.cleanupFns.push(() => document.removeEventListener("mouseup", onMouseUp, true));
    SELECTOR_STATE.cleanupFns.push(() => document.removeEventListener("click", onClick, true));
    SELECTOR_STATE.cleanupFns.push(() => document.removeEventListener("keydown", onKeyDown, true));
}

/**
 * 结束选择模式，清理所有副作用
 */
function stopElementPicking() {
    SELECTOR_STATE.enabled = false;
    SELECTOR_STATE.hoverEl = null;
    SELECTOR_STATE.isDragging = false;
    SELECTOR_STATE.selectedElements.clear();

    // 恢复页面的文本选择状态
    if (SELECTOR_STATE.originalUserSelect !== undefined) {
        document.body.style.userSelect = SELECTOR_STATE.originalUserSelect;
        SELECTOR_STATE.originalUserSelect = undefined;
    }

    for (const cleanup of SELECTOR_STATE.cleanupFns) {
        cleanup();
    }
    SELECTOR_STATE.cleanupFns = [];

    if (SELECTOR_STATE.maskEl) {
        SELECTOR_STATE.maskEl.remove();
        SELECTOR_STATE.maskEl = null;
    }
    if (SELECTOR_STATE.tipEl) {
        SELECTOR_STATE.tipEl.remove();
        SELECTOR_STATE.tipEl = null;
    }

    document.documentElement.style.cursor = "";
}

/**
 * 根据坐标取目标元素，自动忽略我们注入的覆盖层
 * @param {number} clientX
 * @param {number} clientY
 * @returns {Element|null}
 */
function getValidTarget(clientX, clientY) {
    const oldMaskDisplay = SELECTOR_STATE.maskEl?.style.display;
    const oldTipDisplay = SELECTOR_STATE.tipEl?.style.display;

    // 临时隐藏覆盖层，确保 elementFromPoint 取到真实页面元素
    if (SELECTOR_STATE.maskEl) {
        SELECTOR_STATE.maskEl.style.display = "none";
    }
    if (SELECTOR_STATE.tipEl) {
        SELECTOR_STATE.tipEl.style.display = "none";
    }

    const element = document.elementFromPoint(clientX, clientY);

    if (SELECTOR_STATE.maskEl) {
        if (!SELECTOR_STATE.isPickingDone) {
            SELECTOR_STATE.maskEl.style.display = oldMaskDisplay || "";
        }
    }
    if (SELECTOR_STATE.tipEl) {
        SELECTOR_STATE.tipEl.style.display = oldTipDisplay || "";
    }

    if (!element || element === document.documentElement || element === document.body) {
        return null;
    }
    return element;
}

/**
 * 计算多个元素的联合包围盒
 * @param {Set<Element>} elementsSet
 * @returns {{left: number, top: number, width: number, height: number}|null}
 */
function getCombinedRect(elementsSet) {
    if (!elementsSet || elementsSet.size === 0) return null;

    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;

    for (const el of elementsSet) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        minX = Math.min(minX, rect.left);
        minY = Math.min(minY, rect.top);
        maxX = Math.max(maxX, rect.right);
        maxY = Math.max(maxY, rect.bottom);
    }

    if (minX === Infinity) return null;

    return {
        left: minX,
        top: minY,
        width: maxX - minX,
        height: maxY - minY
    };
}

/**
 * 根据矩形区域渲染高亮框
 * @param {{left: number, top: number, width: number, height: number}|null} rect
 */
function renderMaskByRect(rect) {
    if (!rect || !SELECTOR_STATE.maskEl) {
        return;
    }
    SELECTOR_STATE.maskEl.style.left = `${rect.left}px`;
    SELECTOR_STATE.maskEl.style.top = `${rect.top}px`;
    SELECTOR_STATE.maskEl.style.width = `${rect.width}px`;
    SELECTOR_STATE.maskEl.style.height = `${rect.height}px`;
}

/**
 * 更新底部提示文案
 * @param {string} text
 */
function updateTip(text) {
    if (SELECTOR_STATE.tipEl) {
        SELECTOR_STATE.tipEl.textContent = text;
    }
}

/**
 * 复制目标区域为 PNG
 * @param {{left: number, top: number, width: number, height: number}} rect
 */
async function copyRectAsPng(rect) {
    // 限制必须在可视区域内且存在面积，避免截图裁剪失败
    if (rect.width < 1 || rect.height < 1) {
        throw new Error("目标区域尺寸过小，无法复制");
    }

    const payload = {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
        devicePixelRatio: window.devicePixelRatio || 1
    };
    
    /**
     * 关键修复：
     * 在截图前临时隐藏我们注入的高亮遮罩和提示层，并等待至少一帧完成页面重绘，
     * 确保 captureVisibleTab 截到的是“原始页面”，不会把蓝色框和提示层一起拍进去。
     */
    const response = await withOverlayHiddenForCapture(async () => {
        return chrome.runtime.sendMessage({
            type: "CAPTURE_AND_CROP",
            payload
        });
    });

    if (!response?.ok || !response.dataUrl) {
        throw new Error(response?.error || "后台截图失败");
    }

    const pngBlob = await dataUrlToBlob(response.dataUrl);

    // ClipboardItem 是现代浏览器写图片到系统剪贴板的标准方式
    await navigator.clipboard.write([
        new ClipboardItem({
            "image/png": pngBlob
        })
    ]);
}

/**
 * 在执行截图逻辑时临时隐藏插件覆盖层，执行完成后自动恢复
 * @template T
 * @param {() => Promise<T>} task 需要在“覆盖层隐藏状态”下执行的异步任务
 * @returns {Promise<T>}
 */
async function withOverlayHiddenForCapture(task) {
    const oldMaskDisplay = SELECTOR_STATE.maskEl?.style.display;
    const oldTipDisplay = SELECTOR_STATE.tipEl?.style.display;

    try {
        if (SELECTOR_STATE.maskEl) {
            SELECTOR_STATE.maskEl.style.display = "none";
        }
        if (SELECTOR_STATE.tipEl) {
            SELECTOR_STATE.tipEl.style.display = "none";
        }

        // 等待两帧：第一帧让样式变更提交，第二帧确保可视层已完成重绘，再触发截图
        await waitForNextFrame();
        await waitForNextFrame();

        return await task();
    } finally {
        // 无论截图成功或失败，都必须恢复覆盖层（如果流程未结束），避免选择模式“看不见但仍在运行”
        // 优化：如果点击后流程已锁定完成（isPickingDone），则不再恢复蓝色高亮框，只恢复提示条显示结果
        if (SELECTOR_STATE.maskEl) {
            if (!SELECTOR_STATE.isPickingDone) {
                SELECTOR_STATE.maskEl.style.display = oldMaskDisplay || "";
            }
        }
        if (SELECTOR_STATE.tipEl) {
            SELECTOR_STATE.tipEl.style.display = oldTipDisplay || "";
        }
    }
}

/**
 * DataURL 转 Blob
 * @param {string} dataUrl
 * @returns {Promise<Blob>}
 */
async function dataUrlToBlob(dataUrl) {
    const res = await fetch(dataUrl);
    return res.blob();
}

/**
 * 等待浏览器下一次动画帧
 * 说明：用于让 DOM 可见性修改真正生效，再执行依赖“屏幕内容”的操作（如截图）
 * @returns {Promise<void>}
 */
function waitForNextFrame() {
    return new Promise((resolve) => {
        requestAnimationFrame(() => resolve());
    });
}