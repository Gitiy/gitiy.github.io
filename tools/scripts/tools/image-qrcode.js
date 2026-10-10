import {
  toolPage, el, button, select, note, grid, fieldset, toggle,
  toast, fileZone, rangeInput, colorInput, textInput,
  copyWithFeedback,
} from '../ui.js';
import { loadQrcode, loadJsQR } from '../lib/scripts.js';
import { download, stamp } from '../lib/files.js';

const LEVELS = [['L', 'L —— 约 7% 可恢复（容量最大）'], ['M', 'M —— 约 15%（默认）'], ['Q', 'Q —— 约 25%'], ['H', 'H —— 约 30%（最耐污损）']];

const TYPES = [
  ['text', '文本 / 网址'],
  ['wifi', 'WiFi 连接'],
  ['vcard', '名片（vCard）'],
  ['sms', '短信'],
  ['tel', '电话'],
  ['mail', '邮件'],
];

const esc = (s) => String(s).replace(/([\\;,":])/g, '\\$1');

export const tool = {
  init(app) {
    const page = toolPage({
      title: '二维码',
      icon: '🔳',
      desc: '生成二维码（文本、网址、WiFi、名片、短信、电话、邮件）或识别图片里的二维码。全部本地计算，内容不会外发。',
    });

    const modeSel = select({
      label: '模式', value: 'gen',
      options: [['gen', '生成二维码'], ['read', '识别图片里的二维码']],
      onChange: sync,
    });

    /* ---------------- 生成 ---------------- */
    const typeSel = select({ label: '内容类型', value: 'text', options: TYPES, onChange: sync });

    const fText = el('textarea', { class: 'input mono', rows: 3, placeholder: '要编码的文本或网址', 'aria-label': '内容' });
    // el() 给的是裸元素（没有 .root），包一层才能和 textInput 那些控件一样显隐
    const fTextWrap = el('div', { class: 'field-row' },
      el('label', { class: 'field' },
        el('span', { class: 'field-label', text: '文本 / 网址' }),
        fText,
      ),
    );
    const fSsid = textInput({ label: 'WiFi 名称（SSID）', value: '' });
    const fPass = textInput({ label: 'WiFi 密码', value: '' });
    const fWifiType = select({ label: '加密方式', value: 'WPA', options: [['WPA', 'WPA / WPA2 / WPA3'], ['WEP', 'WEP'], ['nopass', '不加密']] });
    const fName = textInput({ label: '姓名', value: '' });
    const fOrg = textInput({ label: '公司 / 职位', value: '' });
    const fTel = textInput({ label: '电话', value: '' });
    const fEmail = textInput({ label: '邮箱', value: '' });
    const fSmsTo = textInput({ label: '短信接收号码', value: '' });
    const fSmsBody = textInput({ label: '短信内容', value: '' });
    const fTelNum = textInput({ label: '电话号码', value: '' });
    const fMailTo = textInput({ label: '收件人邮箱', value: '' });
    const fMailSubject = textInput({ label: '邮件主题', value: '' });
    const fMailBody = textInput({ label: '邮件正文', value: '' });

    const levelSel = select({ label: '容错级别', value: 'M', options: LEVELS, onChange: render });
    const sizeRange = rangeInput({ label: '输出尺寸', value: 512, min: 128, max: 2048, step: 32, format: (v) => v + ' px', onChange: render });
    const marginRange = rangeInput({ label: '白边（模块数）', value: 4, min: 0, max: 12, format: (v) => v + ' 模块', onChange: render });
    const fgColor = colorInput({ label: '前景色', value: '#0f172a', onChange: render });
    const bgColor = colorInput({ label: '背景色', value: '#ffffff', onChange: render });

    const canvas = el('canvas', { class: 'qr-canvas' });
    const qrInfo = el('p', { class: 'hint', dataset: { role: 'qr-info' } });
    const encoded = el('textarea', { class: 'input mono', rows: 3, readonly: true, 'aria-label': '实际编码内容' });

    /* ---------------- 识别 ---------------- */
    const readCanvas = el('canvas', { class: 'qr-read-canvas hidden' });
    const readOut = el('textarea', { class: 'input mono', rows: 6, readonly: true, 'aria-label': '识别结果' });
    const readStat = note('');

    const genBox = el('div', {});
    const readBox = el('div', { class: 'hidden' });

    genBox.append(
      fieldset('内容', typeSel,
        fTextWrap, grid(fSsid, fPass), fWifiType,
        grid(fName, fOrg), grid(fTel, fEmail),
        grid(fSmsTo, fSmsBody), fTelNum,
        grid(fMailTo, fMailSubject), fMailBody,
      ),
      fieldset('外观', grid(levelSel, sizeRange), grid(marginRange), grid(fgColor, bgColor)),
      el('div', { class: 'card' },
        el('p', { class: 'field-hint', text: '预览' }),
        canvas, qrInfo,
        el('p', { class: 'field-hint', text: '实际编码的内容（扫码后读到的就是它）' }),
        encoded,
      ),
    );

    readBox.append(
      el('div', { class: 'card' },
        fileZone({
          title: '拖入含二维码的图片',
          hint: '支持 PNG / JPG / WebP，会尝试在整张图里定位二维码',
          icon: '🖼️', multiple: false, accept: 'image/*',
          onFiles: ([f]) => decodeImage(f),
        }).root,
        readCanvas,
        el('p', { class: 'field-hint', text: '识别结果' }),
        readOut, readStat,
      ),
    );

    page.add(modeSel.root, genBox, readBox);
    page.setActions(
      button('下载 PNG', () => downloadPng(), { primary: true }),
      button('下载 SVG', () => downloadSvg()),
      button('复制内容', () => copyWithFeedback(encoded.value || readOut.value, '已复制')),
    );
    app.main.append(page.root);

    /* ---------------- 逻辑 ---------------- */

    const FIELDS = {
      text: [fTextWrap],
      wifi: [fSsid, fPass, fWifiType],
      vcard: [fName, fOrg, fTel, fEmail],
      sms: [fSmsTo, fSmsBody],
      tel: [fTelNum],
      mail: [fMailTo, fMailSubject, fMailBody],
    };

    function sync() {
      const gen = modeSel.get() === 'gen';
      genBox.classList.toggle('hidden', !gen);
      readBox.classList.toggle('hidden', gen);
      if (!gen) return;
      const t = typeSel.get();
      for (const [id, list] of Object.entries(FIELDS)) {
        for (const c of list) (c.root || c).classList.toggle('hidden', id !== t);
      }
      render();
    }

    /** 按内容类型拼出实际要编码的字符串 */
    function payload() {
      const t = typeSel.get();
      switch (t) {
        case 'wifi': {
          // 标准格式以 ;; 结尾；不加密时不写 P 字段
          const t = fWifiType.get();
          const ssid = esc(fSsid.get());
          return t === 'nopass'
            ? `WIFI:T:nopass;S:${ssid};;`
            : `WIFI:T:${t};S:${ssid};P:${esc(fPass.get())};;`;
        }
        case 'vcard': {
          const lines = ['BEGIN:VCARD', 'VERSION:3.0'];
          if (fName.get()) { lines.push(`FN:${fName.get()}`); lines.push(`N:${fName.get()};;;;`); }
          if (fOrg.get()) lines.push(`ORG:${fOrg.get()}`);
          if (fTel.get()) lines.push(`TEL;TYPE=CELL:${fTel.get()}`);
          if (fEmail.get()) lines.push(`EMAIL:${fEmail.get()}`);
          lines.push('END:VCARD');
          return lines.join('\n');
        }
        case 'sms':
          return `SMSTO:${fSmsTo.get()}:${fSmsBody.get()}`;
        case 'tel':
          return `tel:${fTelNum.get()}`;
        case 'mail': {
          const p = [];
          if (fMailSubject.get()) p.push('subject=' + encodeURIComponent(fMailSubject.get()));
          if (fMailBody.get()) p.push('body=' + encodeURIComponent(fMailBody.get()));
          return `mailto:${fMailTo.get()}${p.length ? '?' + p.join('&') : ''}`;
        }
        default:
          return fText.value;
      }
    }

    let qrInstance = null;

    async function render() {
      if (modeSel.get() !== 'gen') return;
      const text = payload();
      encoded.value = text;

      const ctx = canvas.getContext('2d');
      if (!text.trim()) {
        canvas.width = canvas.height = 320;
        ctx.fillStyle = bgColor.get();
        ctx.fillRect(0, 0, 320, 320);
        qrInfo.textContent = '填好内容后这里会显示二维码';
        qrInfo.className = 'hint';
        qrInstance = null;
        return;
      }

      try {
        const qrcode = await loadQrcode();
        // typeNumber 0 = 按内容自动选版本
        const qr = qrcode(0, levelSel.get());
        // 第二个参数是数据模式（Byte / Kanji / Numeric / Alphanumeric），
        // 不是编码名 —— 传 'UTF-8' 会直接抛错。编码由上面换过的 stringToBytes 决定。
        qr.addData(text, 'Byte');
        qr.make();
        qrInstance = qr;

        const count = qr.getModuleCount();
        const margin = Math.round(marginRange.get());
        const total = count + margin * 2;
        const target = Math.round(sizeRange.get());
        // 取整数倍，保证每个模块都是整像素，不会出现模糊的边缘
        const scale = Math.max(1, Math.round(target / total));
        const px = total * scale;
        canvas.width = px;
        canvas.height = px;

        ctx.fillStyle = bgColor.get();
        ctx.fillRect(0, 0, px, px);
        ctx.fillStyle = fgColor.get();
        for (let r = 0; r < count; r++) {
          for (let c = 0; c < count; c++) {
            if (qr.isDark(r, c)) {
              ctx.fillRect((c + margin) * scale, (r + margin) * scale, scale, scale);
            }
          }
        }

        qrInfo.textContent = `版本 ${qr.getModuleCount() >= 21 ? Math.round((count - 17) / 4) : '?'} · ${count}×${count} 模块 · 容错 ${levelSel.get()} · 输出 ${px}×${px} 像素`;
        qrInfo.className = 'hint ok';
      } catch (err) {
        qrInstance = null;
        qrInfo.textContent = '生成失败：' + err.message + '（内容太长时试着降低容错级别，或缩短内容）';
        qrInfo.className = 'hint error';
      }
    }

    function downloadPng() {
      if (!qrInstance) { toast('先生成二维码', 'error'); return; }
      // 用 blob URL 而不是 data: URL —— 内容大时 data: URL 会被浏览器拒绝
      canvas.toBlob((blob) => {
        if (!blob) { toast('导出失败', 'error'); return; }
        download(blob, `二维码_${stamp()}.png`);
        toast('已导出 PNG', 'ok');
      }, 'image/png');
    }

    /** 矢量 SVG：放大到任意尺寸都清晰，适合印刷 */
    function downloadSvg() {
      if (!qrInstance) { toast('先生成二维码', 'error'); return; }
      const qr = qrInstance;
      const count = qr.getModuleCount();
      const margin = Math.round(marginRange.get());
      const total = count + margin * 2;
      let path = '';
      for (let r = 0; r < count; r++) {
        for (let c = 0; c < count; c++) {
          if (qr.isDark(r, c)) path += `M${c + margin} ${r + margin}h1v1h-1z`;
        }
      }
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="512" height="512" shape-rendering="crispEdges">
<rect width="${total}" height="${total}" fill="${bgColor.get()}"/>
<path d="${path}" fill="${fgColor.get()}"/>
</svg>`;
      const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `二维码_${stamp()}.svg`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 30000);
      toast('已导出 SVG', 'ok');
    }

    async function decodeImage(file) {
      readStat.textContent = '正在识别…';
      readStat.className = 'hint';
      readOut.value = '';
      try {
        const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
        // 大图缩到 1600px 以内，jsQR 在过大图上很慢
        const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
        const w = Math.round(bmp.width * k);
        const h = Math.round(bmp.height * k);
        readCanvas.width = w;
        readCanvas.height = h;
        readCanvas.classList.remove('hidden');
        const ctx = readCanvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(bmp, 0, 0, w, h);
        bmp.close?.();

        const jsQR = await loadJsQR();
        const img = ctx.getImageData(0, 0, w, h, { colorSpace: 'srgb' });
        const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });

        if (!code) {
          readStat.textContent = '没识别到二维码。可以试试：裁掉多余背景只留二维码、提高图片清晰度、或换一张图。';
          readStat.className = 'hint error';
          return;
        }

        readOut.value = code.data;
        // 把定位点画出来，让用户确认识别的是哪一块
        ctx.strokeStyle = '#e11d48';
        ctx.lineWidth = Math.max(2, w / 200);
        ctx.beginPath();
        const loc = code.location;
        ctx.moveTo(loc.topLeftCorner.x, loc.topLeftCorner.y);
        ctx.lineTo(loc.topRightCorner.x, loc.topRightCorner.y);
        ctx.lineTo(loc.bottomRightCorner.x, loc.bottomRightCorner.y);
        ctx.lineTo(loc.bottomLeftCorner.x, loc.bottomLeftCorner.y);
        ctx.closePath();
        ctx.stroke();

        readStat.textContent = `识别成功 · 版本 ${code.version} · 内容 ${code.data.length} 字符（图中红框是定位到的位置）`;
        readStat.className = 'hint ok';
        toast('识别成功', 'ok');
      } catch (err) {
        readStat.textContent = '识别失败：' + err.message;
        readStat.className = 'hint error';
      }
    }

    // 内容变化就重画
    let debounce = 0;
    // fText 是裸 textarea（不是控件对象），所以统一用 node() 取真实元素
    const nodeOf = (c) => c.node || c;
    for (const c of [fText, fSsid, fPass, fName, fOrg, fTel, fEmail, fSmsTo, fSmsBody, fTelNum, fMailTo, fMailSubject, fMailBody]) {
      nodeOf(c).addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(render, 250); });
    }
    nodeOf(fWifiType).addEventListener('change', render);

    sync();
    return () => { clearTimeout(debounce); };
  },
};
