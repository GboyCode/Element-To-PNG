/**
 * 后台脚本职责：
 * 1) 接收内容脚本发送的截图裁剪请求
 * 2) 调用 captureVisibleTab 截取可视区域
 * 3) 在后台使用 OffscreenCanvas 裁剪目标元素区域
 * 4) 返回裁剪后的 PNG DataURL 给内容脚本写入剪贴板
 */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== "CAPTURE_AND_CROP") {
        return false;
    }

    // 使用 IIFE 包裹异步逻辑，保持 onMessage 的结构清晰
    (async () => {
        try {
            const tab = sender.tab;
            if (!tab?.windowId) {
                throw new Error("未获取到有效的标签页窗口信息");
            }

            const clip = normalizeClipRect(message.payload);
            if (!clip) {
                throw new Error("裁剪区域参数无效");
            }

            // 截取当前可视区域，返回 base64 dataURL
            const screenshotUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
                format: "png"
            });

            // 进行截图裁剪并输出 PNG dataURL
            const croppedDataUrl = await cropDataUrlImage(screenshotUrl, clip);
            sendResponse({
                ok: true,
                dataUrl: croppedDataUrl
            });
        } catch (error) {
            sendResponse({
                ok: false,
                error: error?.message || "截图失败"
            });
        }
    })();

    // 返回 true 表示将异步调用 sendResponse
    return true;
});

/**
 * 规范化裁剪参数，防止非法输入导致裁剪失败
 * @param {object} payload 内容脚本传入的裁剪参数
 * @returns {{x:number, y:number, width:number, height:number, devicePixelRatio:number}|null}
 */
function normalizeClipRect(payload) {
    if (!payload) {
        return null;
    }

    const x = Number(payload.x);
    const y = Number(payload.y);
    const width = Number(payload.width);
    const height = Number(payload.height);
    const devicePixelRatio = Math.max(1, Number(payload.devicePixelRatio) || 1);

    if ([x, y, width, height].some(Number.isNaN)) {
        return null;
    }
    if (width <= 0 || height <= 0) {
        return null;
    }

    return { x, y, width, height, devicePixelRatio };
}

/**
 * 裁剪截图中的目标区域
 * @param {string} screenshotUrl 整页可视区域截图 dataURL
 * @param {{x:number, y:number, width:number, height:number, devicePixelRatio:number}} clip CSS 像素裁剪区
 * @returns {Promise<string>} 裁剪后的 PNG dataURL
 */
async function cropDataUrlImage(screenshotUrl, clip) {
    const imageBlob = await (await fetch(screenshotUrl)).blob();
    const bitmap = await createImageBitmap(imageBlob);

    const scale = clip.devicePixelRatio;
    const sx = Math.max(0, Math.floor(clip.x * scale));
    const sy = Math.max(0, Math.floor(clip.y * scale));
    const sw = Math.max(1, Math.floor(clip.width * scale));
    const sh = Math.max(1, Math.floor(clip.height * scale));

    // 保证裁剪框不越界；若超边界则向内收缩
    const safeSw = Math.min(sw, bitmap.width - sx);
    const safeSh = Math.min(sh, bitmap.height - sy);

    if (safeSw <= 0 || safeSh <= 0) {
        throw new Error("目标元素不在当前可视区域内，请先滚动到可见位置");
    }

    const canvas = new OffscreenCanvas(safeSw, safeSh);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
        throw new Error("无法创建画布上下文");
    }

    ctx.drawImage(bitmap, sx, sy, safeSw, safeSh, 0, 0, safeSw, safeSh);
    const resultBlob = await canvas.convertToBlob({ type: "image/png" });
    const resultDataUrl = await blobToDataUrl(resultBlob);

    return resultDataUrl;
}

/**
 * Blob 转 DataURL，便于通过 runtime message 传回内容脚本
 * @param {Blob} blob 图片 Blob
 * @returns {Promise<string>}
 */
function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("图片编码失败"));
        reader.readAsDataURL(blob);
    });
}
