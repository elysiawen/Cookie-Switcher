/**
 * 切换结果横幅：直接注入到目标页面顶部，因此弹窗、右键菜单、悬浮窗
 * 三条入口都能用同一套提示，且不依赖悬浮窗是否开启。
 */

export type NoticeKind = 'ok' | 'error';

export interface PageNotice {
  kind: NoticeKind;
  text: string;
}

const NOTICE_HOST_ID = 'cps-page-notice';

export async function showPageNotice(
  tabId: number | undefined,
  notice: PageNotice,
): Promise<void> {
  if (typeof tabId !== 'number') return;
  await chrome.scripting
    .executeScript({
      target: { tabId },
      func: renderNotice,
      args: [NOTICE_HOST_ID, notice.kind, notice.text],
    })
    .catch(() => undefined);
}

/**
 * 该函数会被序列化后注入页面执行，必须完全自包含：
 * 不能引用模块作用域里的任何变量，参数一律通过 args 传入。
 */
function renderNotice(hostId: string, kind: string, text: string): void {
  const previous = document.getElementById(hostId);
  if (previous) previous.remove();

  const failed = kind === 'error';
  const stroke = failed ? '#dc2626' : '#2563eb';
  const glyph = failed ? '!' : '✓';

  const host = document.createElement('div');
  host.id = hostId;
  // 顶部居中的小浮窗，不再占用整条横幅
  host.style.cssText =
    'all: initial; position: fixed; top: 14px; left: 50%; transform: translateX(-50%);' +
    ' z-index: 2147483647;';

  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      .bar {
        display: flex;
        align-items: center;
        gap: 8px;
        max-width: min(460px, calc(100vw - 32px));
        padding: 9px 10px 9px 12px;
        border-radius: 12px;
        border: 1.5px solid ${stroke};
        /* 半透明底 + 高模糊背景，做出磨砂玻璃观感 */
        background: rgba(255, 255, 255, 0.58);
        -webkit-backdrop-filter: blur(22px) saturate(170%);
        backdrop-filter: blur(22px) saturate(170%);
        box-shadow:
          0 12px 32px rgba(16, 24, 40, 0.16),
          0 2px 6px rgba(16, 24, 40, 0.06),
          inset 0 1px 0 rgba(255, 255, 255, 0.6);
        color: #14161a;
        font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui,
          "PingFang SC", "Microsoft YaHei", sans-serif;
        opacity: 0;
        transform: translateY(-8px);
        animation: cps-notice-in 0.18s ease-out forwards;
      }
      /* 不支持 backdrop-filter 时退化为接近实心的白底 */
      @supports not (backdrop-filter: blur(1px)) {
        .bar { background: rgba(255, 255, 255, 0.94); }
      }
      .bar.out { animation: cps-notice-out 0.16s ease-in forwards; }
      .badge {
        flex: 0 0 auto;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        display: grid;
        place-items: center;
        background: ${stroke};
        color: #fff;
        font-size: 11.5px;
        font-weight: 700;
      }
      .text {
        flex: 1;
        min-width: 0;
        font-weight: 550;
      }
      .close {
        flex: 0 0 auto;
        width: 20px;
        height: 20px;
        padding: 0;
        border: 0;
        border-radius: 5px;
        background: none;
        color: #5c6472;
        font: inherit;
        font-size: 14px;
        line-height: 1;
        opacity: 0.75;
        cursor: pointer;
      }
      .close:hover { opacity: 1; background: rgba(37, 99, 235, 0.12); }
      @keyframes cps-notice-in { to { opacity: 1; transform: none; } }
      @keyframes cps-notice-out { to { opacity: 0; transform: translateY(-8px); } }
    </style>
    <div class="bar" role="status">
      <span class="badge">${glyph}</span>
      <span class="text"></span>
      <button class="close" type="button" aria-label="close">×</button>
    </div>`;

  const bar = shadow.querySelector('.bar');
  const label = shadow.querySelector('.text');
  const close = shadow.querySelector('.close');
  if (label) label.textContent = text;

  const dismiss = () => {
    if (!bar) return;
    bar.classList.add('out');
    window.setTimeout(() => host.remove(), 220);
  };

  close?.addEventListener('click', dismiss);
  document.documentElement.appendChild(host);
  window.setTimeout(dismiss, failed ? 9000 : 6000);
}
