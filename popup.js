const startBtn = document.getElementById("startBtn");
const statusEl = document.getElementById("status");

startBtn.addEventListener("click", async () => {
    setStatus("正在注入选择器...", "default");
    startBtn.disabled = true;

    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) {
            throw new Error("未找到当前活动标签页");
        }

        // 先探测内容脚本是否已存在，若不存在则动态注入（兼容某些页面首次加载的场景）
        let pingOk = false;
        try {
            const ping = await chrome.tabs.sendMessage(tab.id, { type: "PING_CONTENT_SCRIPT" });
            pingOk = Boolean(ping?.ok);
        } catch (_err) {
            pingOk = false;
        }

        if (!pingOk) {
            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ["content.js"]
            });
        }

        const result = await chrome.tabs.sendMessage(tab.id, { type: "START_PICK_ELEMENT" });
        if (!result?.ok) {
            throw new Error(result?.message || "无法启动元素选择模式");
        }

        setStatus("已启动：请回到页面点击目标元素", "success");
    } catch (error) {
        setStatus(`失败：${error?.message || "未知错误"}`, "error");
    } finally {
        startBtn.disabled = false;
    }
});

/**
 * 更新弹窗状态
 * @param {string} text 文案
 * @param {"default"|"error"|"success"} type 类型
 */
function setStatus(text, type) {
    statusEl.textContent = text;
    statusEl.classList.remove("error", "success");

    if (type === "error") {
        statusEl.classList.add("error");
    }
    if (type === "success") {
        statusEl.classList.add("success");
    }
}
