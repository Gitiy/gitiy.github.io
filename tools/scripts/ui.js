/** 共享的小工具：复制到剪贴板、轻量提示 */

/**
 * 复制文本到剪贴板。
 * 优先用异步剪贴板 API —— document.execCommand('copy') 已废弃，
 * 且在不支持的环境里会返回 false 却不抛错，调用方很容易"静默失败"。
 */
export async function copyText(text) {
    if (!text) return false;

    if (navigator.clipboard && window.isSecureContext) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch {
            /* 被拒绝或无权限时落到下面的降级路径 */
        }
    }

    try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0';
        document.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, text.length);
        const ok = document.execCommand('copy');
        ta.remove();
        return ok;
    } catch {
        return false;
    }
}

let toastTimer = null;

/** 轻量提示，2.2 秒后自动消失；带 role="status" 以便读屏软件播报 */
export function toast(message, kind = 'info') {
    let el = document.getElementById('toast');
    if (!el) {
        el = document.createElement('div');
        el.id = 'toast';
        el.setAttribute('role', 'status');
        el.setAttribute('aria-live', 'polite');
        document.body.appendChild(el);
    }
    el.textContent = message;
    el.className = 'toast show ' + kind;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = 'toast'; }, 2200);
}

/** 复制并给出可见反馈 */
export async function copyWithFeedback(text, label = '已复制') {
    if (!text) {
        toast('没有可复制的内容', 'error');
        return false;
    }
    const ok = await copyText(text);
    toast(ok ? label : '复制失败，请手动选择文本复制', ok ? 'ok' : 'error');
    return ok;
}

/** 写入一行状态文本（可选元素） */
export function setStatus(el, text, kind = 'info') {
    if (!el) return;
    el.textContent = text;
    el.className = 'hint' + (kind === 'info' ? '' : ' ' + kind);
}
