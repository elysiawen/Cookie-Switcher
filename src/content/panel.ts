/**
 * 页面悬浮窗（content script，独立打包为 IIFE）。
 * 只在设置开启时由后台注册/注入；关闭时会自行卸载，不残留任何节点。
 * UI 全部放在 Shadow DOM 里，避免宿主页面的样式互相污染。
 */

import { createT, resolveLocale, type LocalePreference, type TFunc } from '@/shared/i18n';
import { type ApiResult, type Request } from '@/shared/messages';
import type { PanelState, Profile, SwitchResult } from '@/shared/types';

const HOST_ID = 'cps-panel-root';
const POS_KEY = 'cps:panel-pos';
const SETTINGS_KEY = 'cps:settings';

const SIZE = 46;
const MARGIN = 18;
const GAP = 12;

const STYLE = `
:host { all: initial; }
.wrap {
  position: fixed;
  width: ${SIZE}px;
  height: ${SIZE}px;
  z-index: 2147483000;
  font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, "PingFang SC",
    "Microsoft YaHei", sans-serif;
  color: #1f2433;
  text-align: left;
  direction: ltr;
}
.launcher {
  position: relative;
  width: ${SIZE}px;
  height: ${SIZE}px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: #fff;
  cursor: grab;
  background: linear-gradient(135deg, #3b82f6, #1d4ed8);
  box-shadow: 0 10px 24px rgba(37, 99, 235, 0.32), 0 2px 6px rgba(16, 24, 40, 0.18);
  transition: transform 0.15s ease, box-shadow 0.15s ease;
  touch-action: none;
}
.launcher:hover { transform: translateY(-1px); box-shadow: 0 14px 30px rgba(37, 99, 235, 0.38); }
.launcher:active { cursor: grabbing; }
.launcher svg { display: block; pointer-events: none; }
.count {
  position: absolute;
  top: -4px;
  right: -4px;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: #111827;
  color: #fff;
  font-size: 10.5px;
  font-weight: 600;
  line-height: 18px;
  text-align: center;
  box-shadow: 0 0 0 2px #fff;
}
.count[hidden] { display: none; }
.card {
  position: absolute;
  width: 264px;
  background: #fff;
  border: 1px solid rgba(16, 24, 40, 0.08);
  border-radius: 14px;
  box-shadow: 0 18px 44px rgba(16, 24, 40, 0.22);
  overflow: hidden;
  animation: cps-pop 0.14s ease-out;
}
.card[hidden] { display: none; }
@keyframes cps-pop {
  from { opacity: 0; transform: translateY(4px) scale(0.98); }
  to { opacity: 1; transform: none; }
}
.head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 10px 10px 13px;
  border-bottom: 1px solid #f0f1f5;
}
.head-text { flex: 1; min-width: 0; }
.site {
  display: block;
  font-size: 12.5px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sub { display: block; font-size: 10.5px; color: #8a90a2; }
.close {
  flex: 0 0 auto;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: 7px;
  background: none;
  color: #8a90a2;
  font-size: 16px;
  line-height: 20px;
  cursor: pointer;
}
.close:hover { background: #f3f4f8; color: #1f2433; }
.list { max-height: 238px; overflow-y: auto; padding: 6px; }
.row {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 7px 8px;
  border: 0;
  border-radius: 9px;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.row:hover:not(:disabled) { background: #f4f8fe; }
.row:disabled { cursor: default; opacity: 0.62; }
.avatar {
  flex: 0 0 auto;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 11px;
  font-weight: 600;
}
.row-text { flex: 1; min-width: 0; }
.name {
  display: block;
  font-size: 12.5px;
  font-weight: 550;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.meta { display: block; font-size: 10.5px; color: #8a90a2; }
.spinner {
  flex: 0 0 auto;
  width: 13px;
  height: 13px;
  border-radius: 50%;
  border: 2px solid #d8dee9;
  border-top-color: #2563eb;
  animation: cps-spin 0.7s linear infinite;
}
@keyframes cps-spin { to { transform: rotate(360deg); } }
.empty { padding: 18px 12px; font-size: 12px; color: #8a90a2; text-align: center; }
.foot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px 7px 13px;
  border-top: 1px solid #f0f1f5;
  background: #fafafd;
}
.status {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  color: #8a90a2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.manage {
  flex: 0 0 auto;
  padding: 3px 7px;
  border: 0;
  border-radius: 6px;
  background: none;
  color: #2563eb;
  font: inherit;
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
}
.manage:hover { background: #eaf2ff; }
`;

const ICON = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
  stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M4 8h14M15 5l3 3-3 3" />
  <path d="M20 16H6M9 13l-3 3 3 3" />
</svg>`;

let host: HTMLElement | null = null;
let wrap: HTMLElement | null = null;
let launcher: HTMLButtonElement | null = null;
let card: HTMLElement | null = null;
let listEl: HTMLElement | null = null;
let statusEl: HTMLElement | null = null;
let siteEl: HTMLElement | null = null;
let subEl: HTMLElement | null = null;
let countEl: HTMLElement | null = null;
let manageBtn: HTMLButtonElement | null = null;

let t: TFunc = createT('zh-CN');
let localePref: LocalePreference = 'auto';
let data: PanelState | null = null;
let busyId: string | null = null;
let loading = false;
let open = false;
let dragged = false;
let position = { left: 0, top: 0 };

let drag: {
  pointerId: number;
  startX: number;
  startY: number;
  originLeft: number;
  originTop: number;
  moved: boolean;
} | null = null;

function hueOf(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) % 360;
  return hash;
}

async function request<T>(message: Request): Promise<ApiResult<T>> {
  try {
    const result = (await chrome.runtime.sendMessage(message)) as ApiResult<T> | undefined;
    return result ?? { ok: false, error: 'no-response' };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

interface PanelSettings {
  floatingPanelEnabled?: boolean;
  locale?: LocalePreference;
}

async function readSettings(): Promise<PanelSettings> {
  try {
    const raw = await chrome.storage.local.get(SETTINGS_KEY);
    return (raw[SETTINGS_KEY] as PanelSettings | undefined) ?? {};
  } catch {
    return {};
  }
}

async function applyLocale(): Promise<void> {
  const settings = await readSettings();
  localePref = settings.locale ?? 'auto';
  t = createT(resolveLocale(localePref));
}

function clampPosition(left: number, top: number): { left: number; top: number } {
  const maxLeft = Math.max(MARGIN, window.innerWidth - SIZE - MARGIN);
  const maxTop = Math.max(MARGIN, window.innerHeight - SIZE - MARGIN);
  return {
    left: Math.min(Math.max(MARGIN, left), maxLeft),
    top: Math.min(Math.max(MARGIN, top), maxTop),
  };
}

function applyPosition(): void {
  if (!wrap) return;
  position = clampPosition(position.left, position.top);
  wrap.style.left = `${Math.round(position.left)}px`;
  wrap.style.top = `${Math.round(position.top)}px`;
  placeCard();
}

/** 卡片始终贴在悬浮按钮内侧，避免超出可视区域 */
function placeCard(): void {
  if (!card) return;
  const alignRight = position.left + SIZE / 2 > window.innerWidth / 2;
  const above = position.top + SIZE / 2 > window.innerHeight / 2;
  card.style.left = alignRight ? 'auto' : '0px';
  card.style.right = alignRight ? '0px' : 'auto';
  card.style.top = above ? 'auto' : `${SIZE + GAP}px`;
  card.style.bottom = above ? `${SIZE + GAP}px` : 'auto';
}

function setStatus(text: string): void {
  if (statusEl) statusEl.textContent = text;
}

function renderHeader(): void {
  if (siteEl) siteEl.textContent = data?.hostname ?? '';
  if (subEl) subEl.textContent = data?.site ?? '';
  if (countEl) {
    const count = data?.profiles.length ?? 0;
    countEl.textContent = String(count);
    countEl.hidden = count === 0;
  }
  if (launcher) launcher.title = t('panel.launcher');
}

function renderRows(): void {
  if (!listEl) return;
  listEl.textContent = '';

  if (loading) {
    const hint = document.createElement('div');
    hint.className = 'empty';
    hint.textContent = t('panel.loading');
    listEl.appendChild(hint);
    return;
  }

  const profiles = data?.profiles ?? [];
  if (profiles.length === 0) {
    const hint = document.createElement('div');
    hint.className = 'empty';
    hint.textContent = t('panel.empty');
    listEl.appendChild(hint);
    return;
  }

  for (const profile of profiles) {
    listEl.appendChild(buildRow(profile));
  }
}

function buildRow(profile: Profile): HTMLButtonElement {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'row';
  row.disabled = busyId !== null || !data?.hostname;

  const hue = hueOf(profile.name || '?');
  const avatar = document.createElement('span');
  avatar.className = 'avatar';
  avatar.style.background = `hsl(${hue} 76% 95%)`;
  avatar.style.color = `hsl(${hue} 52% 38%)`;
  avatar.textContent = profile.name.trim().slice(0, 1).toUpperCase() || '?';

  const text = document.createElement('span');
  text.className = 'row-text';
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = profile.name;
  const meta = document.createElement('span');
  meta.className = 'meta';
  meta.textContent = t('panel.meta', { count: profile.cookies.length });
  text.append(name, meta);

  row.append(avatar, text);

  if (busyId === profile.id) {
    const spinner = document.createElement('span');
    spinner.className = 'spinner';
    row.appendChild(spinner);
  }

  row.addEventListener('click', () => {
    void switchTo(profile);
  });
  return row;
}

async function refreshList(): Promise<void> {
  loading = true;
  renderRows();
  const result = await request<PanelState>({ type: 'GET_PANEL_STATE' });
  loading = false;
  if (!result.ok) {
    // 锁定或后台不可用时直接收起面板，不展示过期列表
    destroy();
    return;
  }
  data = result.data;
  renderHeader();
  renderRows();
  placeCard();
}

async function switchTo(profile: Profile): Promise<void> {
  if (busyId) return;
  busyId = profile.id;
  setStatus(t('panel.switching'));
  renderRows();

  const result = await request<SwitchResult>({ type: 'SWITCH_PROFILE', id: profile.id });
  busyId = null;

  if (!result.ok) {
    setStatus(t('panel.failed', { error: result.error }));
    renderRows();
    return;
  }

  setStatus(t('panel.switched', { name: result.data.profileName }));
  renderRows();
}

function openCard(): void {
  if (!card) return;
  open = true;
  card.hidden = false;
  placeCard();
  setStatus('');
  void refreshList();
}

function closeCard(): void {
  open = false;
  if (card) card.hidden = true;
}

function toggleCard(): void {
  if (open) closeCard();
  else openCard();
}

function onDocumentPointerDown(event: Event): void {
  if (!open || !host) return;
  if (event.composedPath().includes(host)) return;
  closeCard();
}

async function persistPosition(): Promise<void> {
  try {
    await chrome.storage.local.set({ [POS_KEY]: position });
  } catch {
    // 位置只是体验优化，失败无需打扰用户
  }
}

function bindDrag(): void {
  if (!launcher) return;

  launcher.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originLeft: position.left,
      originTop: position.top,
      moved: false,
    };
    launcher?.setPointerCapture(event.pointerId);
  });

  launcher.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    position = { left: drag.originLeft + dx, top: drag.originTop + dy };
    applyPosition();
  });

  const finish = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const moved = drag.moved;
    drag = null;
    if (!moved) return;
    // 拖动结束后的 click 不应触发展开
    dragged = true;
    window.setTimeout(() => {
      dragged = false;
    }, 0);
    void persistPosition();
  };

  launcher.addEventListener('pointerup', finish);
  launcher.addEventListener('pointercancel', finish);

  launcher.addEventListener('click', () => {
    if (dragged) {
      dragged = false;
      return;
    }
    toggleCard();
  });
}

function mount(): void {
  if (document.getElementById(HOST_ID)) return;

  host = document.createElement('div');
  host.id = HOST_ID;

  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>${STYLE}</style>
    <div class="wrap">
      <button class="launcher" type="button">${ICON}<span class="count" hidden>0</span></button>
      <div class="card" hidden>
        <div class="head">
          <div class="head-text"><span class="site"></span><span class="sub"></span></div>
          <button class="close" type="button">×</button>
        </div>
        <div class="list"></div>
        <div class="foot"><span class="status"></span><button class="manage" type="button"></button></div>
      </div>
    </div>`;

  wrap = shadow.querySelector('.wrap');
  launcher = shadow.querySelector('.launcher');
  card = shadow.querySelector('.card');
  listEl = shadow.querySelector('.list');
  statusEl = shadow.querySelector('.status');
  siteEl = shadow.querySelector('.site');
  subEl = shadow.querySelector('.sub');
  countEl = shadow.querySelector('.count');
  manageBtn = shadow.querySelector('.manage');

  const closeBtn = shadow.querySelector('.close');
  closeBtn?.addEventListener('click', closeCard);
  manageBtn?.addEventListener('click', () => {
    void request({ type: 'OPEN_OPTIONS' });
  });

  bindDrag();
  document.documentElement.appendChild(host);
  document.addEventListener('pointerdown', onDocumentPointerDown, true);
  window.addEventListener('resize', applyPosition, { passive: true });
}

function destroy(): void {
  closeCard();
  document.removeEventListener('pointerdown', onDocumentPointerDown, true);
  window.removeEventListener('resize', applyPosition);
  host?.remove();
  host = null;
  wrap = null;
  launcher = null;
  card = null;
  listEl = null;
  statusEl = null;
  siteEl = null;
  subEl = null;
  countEl = null;
  manageBtn = null;
  data = null;
  busyId = null;
}

async function bootstrap(): Promise<void> {
  if (document.getElementById(HOST_ID)) return;

  const settings = await readSettings();
  if (!settings.floatingPanelEnabled) return;

  await applyLocale();
  const result = await request<PanelState>({ type: 'GET_PANEL_STATE' });
  if (!result.ok) return;

  data = result.data;
  mount();
  if (!host) return;

  position = clampPosition(window.innerWidth - SIZE - MARGIN, window.innerHeight - SIZE - MARGIN);
  try {
    const stored = (await chrome.storage.local.get(POS_KEY))[POS_KEY] as
      | { left?: number; top?: number }
      | undefined;
    if (typeof stored?.left === 'number' && typeof stored?.top === 'number') {
      position = { left: stored.left, top: stored.top };
    }
  } catch {
    // 读不到位置就用默认位置
  }

  applyPosition();
  renderHeader();
  if (manageBtn) manageBtn.textContent = t('panel.manage');
  renderRows();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  const next = changes[SETTINGS_KEY]?.newValue as PanelSettings | undefined;
  if (!next) return;

  if (next.floatingPanelEnabled === false) {
    destroy();
    return;
  }
  if (next.floatingPanelEnabled === true && !host) {
    void bootstrap();
    return;
  }
  // 设置每次都整份写回，只有语言真的变了才重绘，避免面板被意外收起
  if (next.locale !== undefined && next.locale !== localePref) {
    destroy();
    void bootstrap();
  }
});

void bootstrap();
