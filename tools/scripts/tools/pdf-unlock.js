import { toolPage, fileZone, el, button, textInput, toggle, note, toast, fieldset } from '../ui.js';
import { download, baseName, fmtBytes } from '../lib/files.js';
import { inspectPdf, unlockPdf } from '../lib/pdf-unlock.js';

/**
 * PDF 去除密码（参考 PDF24 的 unlock-pdf）。
 *
 * 边界和 PDF24 一致：只处理**已知密码**的文件，不做破解、不猜密码。
 * 解密在 PDF 语法层完成，导出的是保留文字层/矢量/图片的原始结构，
 * 不是逐页截图重排 —— 这点对后续还要编辑、检索、复制的文档很重要。
 */
export const tool = {
  init(app) {
    let src = null;

    const page = toolPage({
      title: 'PDF 去除密码',
      icon: '🔓',
      desc: '输入已知密码，导出一份不再需要密码、也不带打印/复制限制的 PDF。内容原样保留，全程在浏览器本地完成。',
    });

    const info = note('还没有选择文件');
    const dz = fileZone({
      accept: '.pdf,application/pdf',
      multiple: false,
      icon: '📄',
      title: '拖入加密的 PDF，或点击选择',
      hint: '会先读出加密方式与权限，文件不会上传',
      onFiles: (files) => load(files[0]),
    });

    const metaLine = el('p', { class: 'hint' });
    const permRow = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px', margin: '10px 0' } });
    const advice = el('p', { class: 'hint' });
    const box = el('div', { class: 'card', style: { padding: '12px 14px', marginTop: '12px' } },
      metaLine, permRow, advice);
    box.style.display = 'none';

    const pwd = textInput({
      label: '文件密码',
      placeholder: '打开密码或所有者密码',
      hint: '如果打开文件时不需要输密码，这里留空即可',
    });
    pwd.node.type = 'password';
    pwd.node.autocomplete = 'off';
    pwd.node.spellcheck = false;
    pwd.node.addEventListener('keydown', (e) => { if (e.key === 'Enter') unlock(); });

    const showPwd = toggle({
      label: '显示密码', value: false,
      onChange: (v) => { pwd.node.type = v ? 'text' : 'password'; },
    });

    const btnGo = button('解锁并下载', unlock, { primary: true });
    btnGo.disabled = true;

    page.add(
      dz,
      info,
      box,
      fieldset('解锁设置', pwd, showPwd),
      note('本工具只处理你有权访问的文档，不会尝试破解或猜解密码；忘记密码时无法恢复。所有计算都在浏览器里进行，文件不会离开你的设备。'),
    );
    page.setActions(btnGo, button('清空', reset, { small: true }));
    app.main.appendChild(page.root);

    /* ---------------- 逻辑 ---------------- */

    function reset() {
      src = null;
      pwd.set('');
      info.textContent = '还没有选择文件';
      info.className = 'hint';
      box.style.display = 'none';
      btnGo.disabled = true;
    }

    async function load(file) {
      if (!file) return;
      reset();
      info.textContent = '正在检查加密信息…';
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const meta = await inspectPdf(bytes, { probeEmpty: true });

        if (!meta.encrypted) {
          info.textContent = `${file.name} · ${fmtBytes(bytes.length)} · 没有加密，不需要解锁。`;
          info.className = 'hint';
          return;
        }

        src = { name: file.name, bytes };
        info.textContent = `${file.name} · ${fmtBytes(bytes.length)}`;
        metaLine.textContent = `加密方式：${meta.algorithm}　（V${meta.version} / R${meta.revision}）`;

        permRow.replaceChildren();
        for (const p of meta.permissions) {
          permRow.append(el('span', {
            text: `${p.allowed ? '✓' : '✕'} ${p.label}`,
            title: p.allowed ? '当前允许' : '当前被禁止',
            style: {
              padding: '2px 8px', borderRadius: '10px', fontSize: '12px',
              border: '1px solid currentColor', opacity: p.allowed ? '0.75' : '0.5',
              textDecoration: p.allowed ? 'none' : 'line-through',
            },
          }));
        }

        advice.textContent = meta.needsPassword === false
          ? '这个文件没有打开密码，只有打印/复制等权限限制。密码留空，直接点「解锁并下载」即可。'
          : '请输入打开密码（或所有者密码），解锁后会得到一份完全不受保护的副本。';
        box.style.display = '';
        btnGo.disabled = false;
        if (meta.needsPassword === true) pwd.node.focus();
      } catch (err) {
        info.textContent = `读取失败：${err.message}`;
        info.className = 'hint';
        toast('读取失败：' + err.message, 'error');
      }
    }

    async function unlock() {
      if (!src) return;
      btnGo.disabled = true;
      const label = btnGo.textContent;
      btnGo.textContent = '解密中…';
      try {
        const { bytes, info: out } = await unlockPdf(src.bytes, pwd.get());
        const name = `${baseName(src.name)}_已解锁.pdf`;
        download(new Blob([bytes], { type: 'application/pdf' }), name);
        advice.textContent = `已移除 ${out.algorithm} 保护，${out.objectCount} 个文档对象原样保留（文字层、图片、书签都在）。`;
        toast(`已导出 → ${name}`, 'ok');
      } catch (err) {
        toast(err.message || '解锁失败', 'error');
      } finally {
        btnGo.textContent = label;
        btnGo.disabled = !src;
      }
    }

    return () => { src = null; };
  },
};
