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
    const noPwdNote = el('p', {
      class: 'hint',
      text: '✓ 打开这个文件本来就不需要密码，只是被限制了打印/复制。不用填任何东西，点下面的按钮就能移除全部保护。',
    });
    noPwdNote.style.display = 'none';

    const btnGo = button('解锁并下载', unlock, { primary: true });
    btnGo.disabled = true;

    page.add(
      dz,
      info,
      box,
      fieldset('解锁设置', pwd, showPwd, noPwdNote),
      note('有打开密码 → 填入密码；没有打开密码、只是限制打印/复制 → 留空一键移除；忘记或不知道打开密码 → 无法处理（这是加密本身的限制，本工具不提供破解猜测）。文件全程只在浏览器本地计算，不会上传。'),
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
      btnGo.textContent = '解锁并下载';
      pwd.root.style.display = '';
      showPwd.root.style.display = '';
      noPwdNote.style.display = 'none';
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
        const noPwd = meta.needsPassword === false;
        info.textContent = `${file.name} · ${fmtBytes(bytes.length)}`;
        metaLine.textContent = `加密方式：${meta.algorithm}　（V${meta.version} / R${meta.revision}）${noPwd ? '　· 无需密码' : ''}`;

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

        advice.textContent = noPwd
          ? '✓ 这个文件打开时不需要密码，只是被限制了打印/复制。不用填任何东西，点下面的按钮就能移除全部保护。'
          : '请输入打开密码（或所有者密码），解锁后会得到一份完全不受保护的副本。';
        box.style.display = '';
        btnGo.disabled = false;
        btnGo.textContent = noPwd ? '直接移除保护' : '解锁并下载';
        pwd.root.style.display = noPwd ? 'none' : '';
        showPwd.root.style.display = noPwd ? 'none' : '';
        noPwdNote.style.display = noPwd ? '' : 'none';
        if (!noPwd) pwd.node.focus();
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
