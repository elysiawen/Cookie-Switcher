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
  const from = failed ? '#dc2626' : '#2563eb';
  const to = failed ? '#b91c1c' : '#1d4ed8';
  const glyph = failed ? '!' : '✓';

  const host = document.createElement('div');
  host.id = hostId;
  host.style.cssText =
    'all: initial; position: fixed; top: 0; left: 0; right: 0; z-index: 2147483647;';

  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      .bar {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 14px;
        color: #fff;
        background: linear-gradient(135deg, ${from}, ${to});
        box-shadow: 0 6px 20px rgba(16, 24, 40, 0.2);
        font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui,
          "PingFang SC", "Microsoft YaHei", sans-serif;
        transform: translateY(-100%);
        animation: cps-notice-in 0.2s ease-out forwards;
      }
      .bar.out { animation: cps-notice-out 0.2s ease-in forwards; }
      .badge {
        flex: 0 0 auto;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        display: grid;
        place-items: center;
        background: rgba(255, 255, 255, 0.22);
        font-size: 12px;
        font-weight: 700;
      }
      .text {
        flex: 1;
        min-width: 0;
        font-weight: 550;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .close {
        flex: 0 0 auto;
        width: 22px;
        height: 22px;
        padding: 0;
        border: 0;
        border-radius: 6px;
        background: none;
        color: #fff;
        font: inherit;
        font-size: 15px;
        line-height: 1;
        opacity: 0.8;
        cursor: pointer;
      }
      .close:hover { opacity: 1; background: rgba(255, 255, 255, 0.16); }
      @keyframes cps-notice-in { to { transform: none; } }
      @keyframes cps-notice-out { to { transform: translateY(-100%); opacity: 0; } }
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
