/**
 * 页面悬浮窗（content script，独立打包为 IIFE）。
 * 只在设置开启时由后台注册/注入；关闭时会自行卸载，不残留任何节点。
 * UI 全部放在 Shadow DOM 里，避免宿主页面的样式互相污染。
 */

import { isQuickAccessAllowed } from '@/shared/access';
import { createT, resolveLocale, type LocalePreference, type TFunc } from '@/shared/i18n';
import { PANEL_RECHECK, type ApiResult, type Request } from '@/shared/messages';
import {
  PANEL_POS_KEY as POS_KEY,
  type PanelCorner,
  type PanelState,
  type Profile,
  type QuickAccessScope,
  type SwitchResult,
} from '@/shared/types';

const HOST_ID = 'cps-panel-root';
const SETTINGS_KEY = 'cps:settings';

const MARGIN = 16;
const GAP = 10;

/** 标准尺寸，实际尺寸 = 基准 × 缩放系数（用户可在设置里用滑块调 50%~150%） */
const BASE_SIZE = 40;
const BASE_CARD = 238;

let size = BASE_SIZE;
let cardWidth = BASE_CARD;
let iconSize = 18;

function applyScale(percent: number | undefined): void {
  const value = typeof percent === 'number' && Number.isFinite(percent) ? percent : 100;
  const factor = Math.min(1.5, Math.max(0.5, value / 100));
  size = Math.round(BASE_SIZE * factor);
  cardWidth = Math.round(BASE_CARD * factor);
  iconSize = Math.round(18 * factor);
}

function buildStyle(): string {
  const listMax = Math.round(208 * (size / BASE_SIZE));
  const avatar = Math.round(22 * (size / BASE_SIZE));

  return `
:host { all: initial; }
.wrap {
  position: fixed;
  width: ${size}px;
  height: ${size}px;
  z-index: 2147483000;
  font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, "PingFang SC",
    "Microsoft YaHei", sans-serif;
  color: #1f2433;
  text-align: left;
  direction: ltr;
}
.launcher {
  position: relative;
  width: ${size}px;
  height: ${size}px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: #fff;
  cursor: grab;
  background: linear-gradient(135deg, #3b82f6, #1d4ed8);
  box-shadow: 0 8px 18px rgba(37, 99, 235, 0.3), 0 2px 5px rgba(16, 24, 40, 0.16);
  transition: transform 0.15s ease, box-shadow 0.15s ease;
  touch-action: none;
}
.launcher:hover { transform: translateY(-1px); box-shadow: 0 11px 24px rgba(37, 99, 235, 0.36); }
.launcher:active { cursor: grabbing; }
.launcher svg { display: block; pointer-events: none; width: ${iconSize}px; height: ${iconSize}px; }
.count {
  position: absolute;
  top: -3px;
  right: -3px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: #111827;
  color: #fff;
  font-size: 10px;
  font-weight: 600;
  line-height: 16px;
  text-align: center;
  box-shadow: 0 0 0 2px #fff;
}
.count[hidden] { display: none; }
.card {
  position: absolute;
  width: ${cardWidth}px;
  background: #fff;
  border: 1px solid rgba(16, 24, 40, 0.08);
  border-radius: 12px;
  box-shadow: 0 14px 34px rgba(16, 24, 40, 0.2);
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
  gap: 6px;
  padding: 8px 8px 8px 11px;
  border-bottom: 1px solid #f0f1f5;
}
.head-text { flex: 1; min-width: 0; }
.site {
  display: block;
  font-size: 12px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.close {
  flex: 0 0 auto;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: none;
  color: #8a90a2;
  font-size: 15px;
  line-height: 18px;
  cursor: pointer;
}
.close:hover { background: #f3f4f8; color: #1f2433; }
.list { max-height: ${listMax}px; overflow-y: auto; padding: 5px; }
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 7px;
  border: 0;
  border-radius: 8px;
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
  width: ${avatar}px;
  height: ${avatar}px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 10.5px;
  font-weight: 600;
}
.row-text { flex: 1; min-width: 0; }
.name {
  display: block;
  font-size: 12px;
  font-weight: 550;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.meta { display: block; font-size: 10px; color: #8a90a2; }
.spinner {
  flex: 0 0 auto;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 2px solid #d8dee9;
  border-top-color: #2563eb;
  animation: cps-spin 0.7s linear infinite;
}
@keyframes cps-spin { to { transform: rotate(360deg); } }
.empty { padding: 16px 10px; font-size: 11.5px; color: #8a90a2; text-align: center; }
.foot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px 6px 11px;
  border-top: 1px solid #f0f1f5;
  background: #fafafd;
}
.status {
  flex: 1;
  min-width: 0;
  font-size: 10.5px;
  color: #8a90a2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.manage {
  flex: 0 0 auto;
  padding: 2px 6px;
  border: 0;
  border-radius: 6px;
  background: none;
  color: #2563eb;
  font: inherit;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}
.manage:hover { background: #eaf2ff; }
`;
}

const ICON = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
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
let countEl: HTMLElement | null = null;
let manageBtn: HTMLButtonElement | null = null;

let t: TFunc = createT('zh-CN');
let localePref: LocalePreference = 'auto';
let scalePref = 100;
let cornerPref: PanelCorner = 'bottom-right';
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
  quickAccessScope?: QuickAccessScope;
  quickAccessSites?: string[];
  panelScale?: number;
  panelCorner?: PanelCorner;
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
  const maxLeft = Math.max(MARGIN, window.innerWidth - size - MARGIN);
  const maxTop = Math.max(MARGIN, window.innerHeight - size - MARGIN);
  return {
    left: Math.min(Math.max(MARGIN, left), maxLeft),
    top: Math.min(Math.max(MARGIN, top), maxTop),
  };
}

/** 根据设置里选择的角落算出停靠坐标 */
function positionForCorner(corner: PanelCorner): { left: number; top: number } {
  const right = window.innerWidth - size - MARGIN;
  const bottom = window.innerHeight - size - MARGIN;
  return {
    left: corner === 'top-left' || corner === 'bottom-left' ? MARGIN : right,
    top: corner === 'top-left' || corner === 'top-right' ? MARGIN : bottom,
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
  const alignRight = position.left + size / 2 > window.innerWidth / 2;
  const above = position.top + size / 2 > window.innerHeight / 2;
  card.style.left = alignRight ? 'auto' : '0px';
  card.style.right = alignRight ? '0px' : 'auto';
  card.style.top = above ? 'auto' : `${size + GAP}px`;
  card.style.bottom = above ? `${size + GAP}px` : 'auto';
}

function setStatus(text: string): void {
  if (statusEl) statusEl.textContent = text;
}

function renderHeader(): void {
  if (siteEl) siteEl.textContent = data?.hostname ?? '';
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

  const writeBack = result.data.writeBack;
  setStatus(
    writeBack
      ? t('panel.writeBackDone', { name: writeBack.name })
      : t('panel.switched', { name: result.data.profileName }),
  );
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
    <style>${buildStyle()}</style>
    <div class="wrap">
      <button class="launcher" type="button">${ICON}<span class="count" hidden>0</span></button>
      <div class="card" hidden>
        <div class="head">
          <div class="head-text"><span class="site"></span></div>
          <button class="close" type="button">×</button>
        </div>
        <div class="list"></div>
        <div class="foot">
          <span class="status"></span>
          <button class="manage" type="button"></button>
        </div>
      </div>
    </div>`;

  wrap = shadow.querySelector('.wrap');
  launcher = shadow.querySelector('.launcher');
  card = shadow.querySelector('.card');
  listEl = shadow.querySelector('.list');
  statusEl = shadow.querySelector('.status');
  siteEl = shadow.querySelector('.site');
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
  countEl = null;
  manageBtn = null;
  data = null;
  busyId = null;
}

async function bootstrap(): Promise<void> {
  if (document.getElementById(HOST_ID)) return;

  const settings = await readSettings();
  if (!settings.floatingPanelEnabled) return;
  // 站点范围由设置决定，被排除的站点完全不渲染
  if (!isQuickAccessAllowed(location.hostname, settings)) return;

  await applyLocale();
  scalePref = settings.panelScale ?? 100;
  applyScale(scalePref);
  cornerPref = settings.panelCorner ?? 'bottom-right';

  const result = await request<PanelState>({ type: 'GET_PANEL_STATE' });
  if (!result.ok) return;

  // 「全部网站」只对已有身份的站点显示，没有身份就不出悬浮窗
  if ((settings.quickAccessScope ?? 'all') === 'all' && result.data.profiles.length === 0) return;

  data = result.data;
  mount();
  if (!host) return;

  position = positionForCorner(cornerPref);
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

/** 身份数据变化后重新判断：该出现就出现，该消失就消失 */
async function recheck(): Promise<void> {
  const settings = await readSettings();
  const allowed =
    settings.floatingPanelEnabled === true &&
    isQuickAccessAllowed(location.hostname, settings);

  destroy();
  if (!allowed) return;
  await bootstrap();
}

chrome.runtime.onMessage.addListener((message: { type?: string } | undefined) => {
  if (message?.type === PANEL_RECHECK) void recheck();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;

  // 位置被重置（切换角落 / 恢复默认）时，已挂载的面板立即归位
  if (changes[POS_KEY] && host) {
    const stored = changes[POS_KEY].newValue as { left?: number; top?: number } | undefined;
    if (typeof stored?.left === 'number' && typeof stored?.top === 'number') {
      position = { left: stored.left, top: stored.top };
    } else {
      position = positionForCorner(cornerPref);
    }
    applyPosition();
  }

  const next = changes[SETTINGS_KEY]?.newValue as PanelSettings | undefined;
  if (!next) return;

  if (next.floatingPanelEnabled === false) {
    destroy();
    return;
  }
  // 站点范围变化：被排除的立即卸载，刚被放行的立即挂载
  if (!isQuickAccessAllowed(location.hostname, next)) {
    destroy();
    return;
  }
  if (next.floatingPanelEnabled === true && !host) {
    void bootstrap();
    return;
  }
  // 设置每次都整份写回，只有真正影响外观的项变了才重绘，避免面板被意外收起
  if (next.locale !== undefined && next.locale !== localePref) {
    destroy();
    void bootstrap();
    return;
  }
  if (next.panelScale !== undefined && next.panelScale !== scalePref) {
    destroy();
    void bootstrap();
    return;
  }
  // 位置设置变化：无需重绘，直接停靠到新角落
  if (next.panelCorner !== undefined && next.panelCorner !== cornerPref) {
    cornerPref = next.panelCorner;
    position = positionForCorner(cornerPref);
    applyPosition();
  }
});

void bootstrap();
