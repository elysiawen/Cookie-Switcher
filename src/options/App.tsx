import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  detectBrowserLocale,
  formatDateTime,
  formatTime,
  LOCALE_LABELS,
  SUPPORTED_LOCALES,
  type LocalePreference,
} from '@/shared/i18n';
import { useI18n } from '@/shared/i18n/provider';
import { Confirm } from '@/shared/Confirm';
import { parseSiteRules } from '@/shared/access';
import { reorderProfiles } from '@/shared/domain';
import { LOCKED_ERROR, sendMessage } from '@/shared/messages';
import {
  DEFAULT_SETTINGS,
  MAX_HISTORY_LIMIT,
  type ExportBundle,
  type HistorySnapshot,
  type LockState,
  type PanelCorner,
  type Profile,
  type QuickAccessScope,
  type SaveResult,
  type Settings,
} from '@/shared/types';

type Toast = { kind: 'ok' | 'err' | 'info'; text: string } | null;

const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

/** 历史快照的来源 → 可翻译文案 */
const HISTORY_REASON_KEY = {
  writeBack: 'options.historyReasonWriteBack',
  overwrite: 'options.historyReasonOverwrite',
  restore: 'options.historyReasonRestore',
} as const;

interface ImportItem {
  name: string;
  site: string;
  cookies: number;
  hasStorage: boolean;
}

interface PendingImport {
  fileName: string;
  /** 文件里原始的 profile 数组，导入时按勾选结果筛选后重新序列化 */
  raw: unknown[];
  items: ImportItem[];
}

function Switch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      className={checked ? 'switch on' : 'switch'}
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
    >
      <span className="knob" />
    </button>
  );
}

function LockScreen({ onUnlocked }: { onUnlocked: () => void }) {
  const { t } = useI18n();
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [resetArmed, setResetArmed] = useState(false);

  const submit = async () => {
    if (!password || busy) return;
    setBusy(true);
    const result = await sendMessage<LockState>({ type: 'UNLOCK', password });
    setBusy(false);
    if (!result.ok) {
      setMessage(result.error);
      return;
    }
    onUnlocked();
  };

  const reset = async () => {
    setBusy(true);
    const result = await sendMessage<LockState>({ type: 'RESET_LOCK' });
    setBusy(false);
    if (!result.ok) {
      setMessage(result.error);
      return;
    }
    onUnlocked();
  };

  return (
    <div className="lock-page">
      <div className="lock-card">
        <div className="lock-icon">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path
              fill="currentColor"
              d="M12 2a5 5 0 0 0-5 5v2H6.5A1.5 1.5 0 0 0 5 10.5v9A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-9A1.5 1.5 0 0 0 17.5 9H17V7a5 5 0 0 0-5-5Zm3.5 7h-7V7a3.5 3.5 0 1 1 7 0v2Zm-3.5 4a1.6 1.6 0 0 1 .9 2.92V18a.9.9 0 0 1-1.8 0v-2.08A1.6 1.6 0 0 1 12 13Z"
            />
          </svg>
        </div>
        <h1>{t('lock.locked')}</h1>
        <p className="lock-desc">{t('lock.desc')}</p>
        <input
          className="lock-input"
          type="password"
          autoFocus
          placeholder={t('lock.placeholder')}
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            setMessage('');
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void submit();
          }}
        />
        {message && <p className="lock-error">{message}</p>}
        <button
          type="button"
          className="btn primary lock-btn"
          disabled={!password || busy}
          onClick={() => void submit()}
        >
          {busy ? t('lock.verifying') : t('lock.unlock')}
        </button>
        {resetArmed ? (
          <div className="lock-reset">
            <p>{t('lock.resetWarn')}</p>
            <div className="lock-reset-actions">
              <button type="button" className="btn" onClick={() => setResetArmed(false)}>
                {t('common.cancel')}
              </button>
              <button type="button" className="btn danger" onClick={() => void reset()}>
                {t('lock.resetConfirm')}
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="lock-forgot" onClick={() => setResetArmed(true)}>
            {t('lock.forgot')}
          </button>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const { t } = useI18n();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [lock, setLock] = useState<LockState | null>(null);
  const [query, setQuery] = useState('');
  const [toast, setToast] = useState<Toast>(null);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [overwriteId, setOverwriteId] = useState<string | null>(null);
  const [overwriteStorage, setOverwriteStorage] = useState(true);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearSite, setClearSite] = useState<string | null>(null);
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const [importSelected, setImportSelected] = useState<boolean[]>([]);
  const [busy, setBusy] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [siteDraft, setSiteDraft] = useState('');
  const [scaleDraft, setScaleDraft] = useState(100);
  const [dragId, setDragId] = useState<string | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [history, setHistory] = useState<HistorySnapshot[]>([]);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const dragRef = useRef<{
    id: string;
    pointerId: number;
    startY: number;
    moved: boolean;
    /** 拖动所在的分组表格，排序只在这个分组内进行 */
    container: HTMLElement | null;
  } | null>(null);
  const dragOrderRef = useRef<string[]>([]);
  const scaleTimer = useRef<number | null>(null);
  const [tab, setTab] = useState<'profiles' | 'settings'>(
    () => (window.location.hash === '#profiles' ? 'profiles' : 'settings'),
  );
  const fileRef = useRef<HTMLInputElement>(null);

  const switchTab = (next: 'profiles' | 'settings') => {
    setTab(next);
    window.location.hash = next === 'profiles' ? 'profiles' : '';
  };

  const refreshLock = useCallback(async () => {
    const result = await sendMessage<LockState>({ type: 'GET_LOCK_STATE' });
    if (result.ok) setLock(result.data);
  }, []);

  const refresh = useCallback(async () => {
    const [list, settingsResult] = await Promise.all([
      sendMessage<Profile[]>({ type: 'GET_ALL_PROFILES' }),
      sendMessage<Settings>({ type: 'GET_SETTINGS' }),
    ]);
    if (list.ok) setProfiles(list.data);
    else if (list.error === LOCKED_ERROR) {
      setProfiles([]);
      await refreshLock();
    }
    if (settingsResult.ok) setSettings(settingsResult.data);
  }, [refreshLock]);

  useEffect(() => {
    void (async () => {
      await refreshLock();
      await refresh();
    })();
  }, [refresh, refreshLock]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const sitesText = (settings.quickAccessSites ?? []).join('\n');
  useEffect(() => {
    setSiteDraft(sitesText);
  }, [sitesText]);

  useEffect(() => {
    setScaleDraft(settings.panelScale);
  }, [settings.panelScale]);

  // 拖动滑块时先本地预览，停手后再落盘，避免每移动一格就发一条消息
  useEffect(
    () => () => {
      if (scaleTimer.current !== null) window.clearTimeout(scaleTimer.current);
    },
    [],
  );

  const groups = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const filtered = keyword
      ? profiles.filter(
          (item) =>
            item.name.toLowerCase().includes(keyword) || item.site.toLowerCase().includes(keyword),
        )
      : profiles;
    const map = new Map<string, Profile[]>();
    for (const profile of filtered) {
      const bucket = map.get(profile.site);
      if (bucket) bucket.push(profile);
      else map.set(profile.site, [profile]);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [profiles, query]);

  const totalCookies = useMemo(
    () => profiles.reduce((sum, item) => sum + item.cookies.length, 0),
    [profiles],
  );

  const deleteTarget = profiles.find((item) => item.id === confirmId) ?? null;
  const overwriteTarget = profiles.find((item) => item.id === overwriteId) ?? null;
  const historyTarget = profiles.find((item) => item.id === historyId) ?? null;
  const importCount = importSelected.filter(Boolean).length;
  const allImportSelected = importSelected.length > 0 && importCount === importSelected.length;

  const toggleImportItem = (index: number) => {
    setImportSelected((prev) => prev.map((value, i) => (i === index ? !value : value)));
  };

  const toggleImportAll = () => {
    setImportSelected((prev) => prev.map(() => !allImportSelected));
  };

  /** 按住行首把手拖动，即可调整同一站点分组内身份的顺序 */
  const gripHandlers = (profile: Profile) => ({
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = {
        id: profile.id,
        pointerId: event.pointerId,
        startY: event.clientY,
        moved: false,
        container: event.currentTarget.closest('.table'),
      };
    },
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      const container = drag?.container;
      if (!drag || !container || event.pointerId !== drag.pointerId) return;
      if (!drag.moved) {
        if (Math.abs(event.clientY - drag.startY) < 3) return;
        drag.moved = true;
        setDragId(drag.id);
      }
      event.preventDefault();

      const ids = [...container.querySelectorAll<HTMLElement>('.trow')]
        .map((row) => row.dataset.id)
        .filter((id): id is string => id !== undefined);
      // 指针越过某行的中线，就把被拖动的行放到它前面
      let beforeId: string | null = null;
      for (const id of ids) {
        if (id === drag.id) continue;
        const row = container.querySelector<HTMLElement>(`.trow[data-id="${id}"]`);
        if (!row) continue;
        const rect = row.getBoundingClientRect();
        if (event.clientY < rect.top + rect.height / 2) {
          beforeId = id;
          break;
        }
      }

      const without = ids.filter((id) => id !== drag.id);
      const at = beforeId ? without.indexOf(beforeId) : without.length;
      const next = [...without];
      next.splice(at < 0 ? without.length : at, 0, drag.id);
      dragOrderRef.current = next;
      setProfiles((prev) => reorderProfiles(prev, next));
    },
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      dragRef.current = null;
      setDragId(null);
      const ids = dragOrderRef.current;
      if (!drag.moved || !drag.container || ids.length < 2) return;
      void sendMessage<{ order: string[] }>({ type: 'REORDER_PROFILES', ids }).then((result) => {
        if (!result.ok) setToast({ kind: 'err', text: result.error });
      });
    },
  });

  const handleRename = async () => {
    if (!editing) return;
    const next = editing.name.trim();
    if (!next) {
      setEditing(null);
      return;
    }
    const result = await sendMessage<Profile>({
      type: 'RENAME_PROFILE',
      id: editing.id,
      name: next,
    });
    setEditing(null);
    if (!result.ok) {
      setToast({ kind: 'err', text: result.error });
      return;
    }
    setToast({ kind: 'ok', text: t('options.renamed') });
    await refresh();
  };

  const handleClearSite = async (site: string) => {
    const ids = profiles.filter((item) => item.site === site).map((item) => item.id);
    setClearSite(null);
    if (ids.length === 0) return;

    const result = await sendMessage<{ deleted: number }>({ type: 'DELETE_PROFILES', ids });
    if (!result.ok) {
      setToast({ kind: 'err', text: result.error });
      return;
    }
    setToast({ kind: 'ok', text: t('options.siteCleared', { count: result.data.deleted }) });
    await refresh();
  };

  const handleDelete = async (id: string) => {
    const result = await sendMessage<{ id: string }>({ type: 'DELETE_PROFILE', id });
    setConfirmId(null);
    if (!result.ok) {
      setToast({ kind: 'err', text: result.error });
      return;
    }
    setToast({ kind: 'ok', text: t('options.deleted') });
    await refresh();
  };

  const handleOverwrite = async (id: string) => {
    setOverwriteId(null);
    const result = await sendMessage<SaveResult>({
      type: 'OVERWRITE_PROFILE',
      id,
      includeStorage: overwriteStorage,
    });
    if (!result.ok) {
      setToast({ kind: 'err', text: result.error });
      return;
    }
    // Cookie 已覆盖；若 localStorage 未能刷新（如站点未打开），把原因如实告知
    if (result.data.errors.length > 0) {
      setToast({ kind: 'err', text: result.data.errors[0] });
    } else {
      setToast({ kind: 'ok', text: t('options.overwritten', { name: result.data.profile?.name ?? '' }) });
    }
    await refresh();
  };

  const openHistory = async (id: string) => {
    setHistoryId(id);
    setHistory([]);
    const result = await sendMessage<HistorySnapshot[]>({ type: 'GET_PROFILE_HISTORY', id });
    if (!result.ok) {
      setToast({ kind: 'err', text: result.error });
      return;
    }
    setHistory(result.data);
  };

  const handleRestore = async (id: string, snapshotId: string) => {
    if (restoringId) return;
    setRestoringId(snapshotId);
    const result = await sendMessage<{ name: string }>({
      type: 'RESTORE_HISTORY',
      id,
      snapshotId,
    });
    setRestoringId(null);
    if (!result.ok) {
      setToast({ kind: 'err', text: result.error });
      return;
    }
    setToast({ kind: 'ok', text: t('options.historyRestored', { name: result.data.name }) });
    await refresh();
    // 还原本身也会留档，列表要重新取一次
    const next = await sendMessage<HistorySnapshot[]>({ type: 'GET_PROFILE_HISTORY', id });
    if (next.ok) setHistory(next.data);
  };

  const handleExport = async () => {
    const result = await sendMessage<ExportBundle>({ type: 'EXPORT_DATA' });
    if (!result.ok) {
      setToast({ kind: 'err', text: result.error });
      return;
    }
    const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    anchor.href = url;
    anchor.download = `cookie-profiles-${stamp}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setToast({ kind: 'ok', text: t('options.exported', { count: result.data.profiles.length }) });
  };

  const handleFile = async (file: File) => {
    if (file.size > MAX_IMPORT_BYTES) {
      setToast({ kind: 'err', text: t('err.importTooLarge') });
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    const text = await file.text();
    try {
      const parsed = JSON.parse(text) as { profiles?: unknown } | unknown[];
      const list = Array.isArray(parsed) ? parsed : parsed?.profiles;
      if (!Array.isArray(list)) throw new Error('missing');
      const items = list.map((entry): ImportItem => {
        const raw = (entry ?? {}) as Record<string, unknown>;
        const site = typeof raw.site === 'string' ? raw.site : '';
        return {
          name: typeof raw.name === 'string' && raw.name ? raw.name : site,
          site,
          cookies: Array.isArray(raw.cookies) ? raw.cookies.length : 0,
          hasStorage: raw.storage != null,
        };
      });
      setPendingImport({ fileName: file.name, raw: list, items });
      setImportSelected(list.map(() => true));
    } catch {
      setToast({ kind: 'err', text: t('options.importInvalid') });
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  const runImport = async (mode: 'merge' | 'replace') => {
    if (!pendingImport || busy) return;
    const selected = pendingImport.raw.filter((_, index) => importSelected[index]);
    if (selected.length === 0) return;
    setBusy(true);
    const result = await sendMessage<{ imported: number; total: number }>({
      type: 'IMPORT_DATA',
      payload: JSON.stringify({ profiles: selected }),
      mode,
    });
    setBusy(false);
    if (!result.ok) {
      setToast({ kind: 'err', text: result.error });
      return;
    }
    setPendingImport(null);
    setImportSelected([]);
    setToast({
      kind: 'ok',
      text: t('options.importDone', {
        imported: result.data.imported,
        total: result.data.total,
      }),
    });
    await refresh();
  };

  const runClear = async () => {
    setBusy(true);
    const result = await sendMessage<{ cleared: number }>({ type: 'CLEAR_ALL' });
    setBusy(false);
    setConfirmClear(false);
    if (!result.ok) {
      setToast({ kind: 'err', text: result.error });
      return;
    }
    setToast({ kind: 'ok', text: t('options.cleared', { count: result.data.cleared }) });
    await refresh();
  };

  const updateSettings = async (patch: Partial<Settings>) => {
    const result = await sendMessage<Settings>({ type: 'UPDATE_SETTINGS', patch });
    if (result.ok) setSettings(result.data);
  };

  const previewScale = (value: number) => {
    setScaleDraft(value);
    if (scaleTimer.current !== null) window.clearTimeout(scaleTimer.current);
    scaleTimer.current = window.setTimeout(() => {
      scaleTimer.current = null;
      void updateSettings({ panelScale: value });
    }, 220);
  };

  const resetPanelPosition = async () => {
    const result = await sendMessage<Settings>({
      type: 'UPDATE_SETTINGS',
      patch: { panelCorner: DEFAULT_SETTINGS.panelCorner },
    });
    if (!result.ok) {
      setToast({ kind: 'err', text: result.error });
      return;
    }
    setSettings(result.data);
    setToast({ kind: 'ok', text: t('options.panelPositionResetDone') });
  };

  const saveSiteList = async () => {
    const list = parseSiteRules(siteDraft);
    const result = await sendMessage<Settings>({
      type: 'UPDATE_SETTINGS',
      patch: { quickAccessSites: list },
    });
    if (!result.ok) {
      setToast({ kind: 'err', text: result.error });
      return;
    }
    setSettings(result.data);
    setToast({ kind: 'ok', text: t('options.sitesSaved') });
  };

  const toggleEncryption = async (next: boolean) => {
    const result = await sendMessage<Settings>({
      type: 'UPDATE_SETTINGS',
      patch: { encryptStorage: next },
    });
    if (!result.ok) {
      setToast({ kind: 'err', text: result.error });
      return;
    }
    setSettings(result.data);
    await refresh();
    setToast({
      kind: next ? 'ok' : 'info',
      text: next ? t('options.cryptoEnabledToast') : t('options.cryptoDisabledToast'),
    });
  };

  const handleSetPassword = async () => {
    if (!passwordInput || passwordBusy) return;
    setPasswordBusy(true);
    const result = await sendMessage<LockState>({ type: 'SET_PASSWORD', password: passwordInput });
    setPasswordBusy(false);
    if (!result.ok) {
      setToast({ kind: 'err', text: result.error });
      return;
    }
    setLock(result.data);
    setPasswordInput('');
    setToast({ kind: 'ok', text: t('options.passwordEnabledToast') });
  };

  const handleRemovePassword = async () => {
    if (!passwordInput || passwordBusy) return;
    setPasswordBusy(true);
    const result = await sendMessage<LockState>({
      type: 'REMOVE_PASSWORD',
      password: passwordInput,
    });
    setPasswordBusy(false);
    if (!result.ok) {
      setToast({ kind: 'err', text: result.error });
      return;
    }
    setLock(result.data);
    setPasswordInput('');
    setToast({ kind: 'ok', text: t('options.passwordDisabledToast') });
  };

  const handleLockNow = async () => {
    const result = await sendMessage<LockState>({ type: 'LOCK_NOW' });
    if (!result.ok) return;
    setProfiles([]);
    setLock(result.data);
  };

  if (lock?.enabled && !lock.unlocked) {
    return (
      <LockScreen
        onUnlocked={() => {
          void (async () => {
            await refreshLock();
            await refresh();
          })();
        }}
      />
    );
  }

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">
          <span className="logo">
            <img src="./icons/icon128.png" width="40" height="40" alt="" />
          </span>
          <div>
            <h1>Cookie Switcher</h1>
            <p>{t('options.stats', { profiles: profiles.length, cookies: totalCookies })}</p>
          </div>
        </div>
        <nav className="tabs">
          <button
            type="button"
            className={tab === 'settings' ? 'tab on' : 'tab'}
            onClick={() => switchTab('settings')}
          >
            {t('options.tabSettings')}
          </button>
          <button
            type="button"
            className={tab === 'profiles' ? 'tab on' : 'tab'}
            onClick={() => switchTab('profiles')}
          >
            {t('options.tabProfiles')}
            <span className="tab-badge">{profiles.length}</span>
          </button>
        </nav>
      </header>

      {tab === 'profiles' ? (
        <section className="panel">
          <div className="panel-head">
            <label className="search-box">
              <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
                <path
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  d="M10.75 4a6.75 6.75 0 1 0 0 13.5 6.75 6.75 0 0 0 0-13.5Zm4.8 11.55L20 20"
                />
              </svg>
              <input
                className="search-input"
                placeholder={t('options.search')}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <div className="panel-actions">
              <button type="button" className="btn" onClick={() => void handleExport()}>
                {t('options.export')}
              </button>
              <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
                {t('options.import')}
              </button>
              <button
                type="button"
                className="btn danger"
                onClick={() => setConfirmClear(true)}
                disabled={profiles.length === 0}
              >
                {t('options.clear')}
              </button>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleFile(file);
              }}
            />
          </div>
          <div className="panel-body">
        {groups.length === 0 ? (
          <div className="empty">
            <p className="empty-title">
              {profiles.length === 0 ? t('options.emptyTitle') : t('options.noMatchTitle')}
            </p>
            <p className="empty-desc">
              {profiles.length === 0 ? t('options.emptyDesc') : t('options.noMatchDesc')}
            </p>
          </div>
        ) : (
          groups.map(([site, list]) => (
            <section className="group" key={site}>
              <div className="group-head">
                <span className="group-site">{site}</span>
                <span className="group-count">{list.length}</span>
                <button
                  type="button"
                  className="mini ghost group-clear"
                  title={t('options.clearSiteTitle', { site })}
                  onClick={() => setClearSite(site)}
                >
                  {t('options.clear')}
                </button>
              </div>
              <div className="table">
                <div className="thead">
                  <span />
                  <span>{t('options.colName')}</span>
                  <span>{t('options.colScope')}</span>
                  <span>{t('options.colCookie')}</span>
                  <span>{t('options.colStorage')}</span>
                  <span>{t('options.colUpdated')}</span>
                  <span />
                </div>
                {list.map((profile) => (
                  <div
                    className={dragId === profile.id ? 'trow dragging' : 'trow'}
                    key={profile.id}
                    data-id={profile.id}
                  >
                    <span
                      className="grip"
                      title={t('options.dragHint')}
                      {...gripHandlers(profile)}
                    >
                      <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true">
                        <circle cx="9" cy="6" r="1.8" />
                        <circle cx="15" cy="6" r="1.8" />
                        <circle cx="9" cy="12" r="1.8" />
                        <circle cx="15" cy="12" r="1.8" />
                        <circle cx="9" cy="18" r="1.8" />
                        <circle cx="15" cy="18" r="1.8" />
                      </svg>
                    </span>
                    <span className="cell name">
                      {editing?.id === profile.id ? (
                        <input
                          className="rename"
                          autoFocus
                          value={editing.name}
                          onChange={(event) =>
                            setEditing({ id: profile.id, name: event.target.value })
                          }
                          onBlur={() => void handleRename()}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') void handleRename();
                            if (event.key === 'Escape') setEditing(null);
                          }}
                        />
                      ) : (
                        <button
                          type="button"
                          className="name-btn"
                          title={t('options.renameHint')}
                          onClick={() => setEditing({ id: profile.id, name: profile.name })}
                        >
                          {profile.name}
                        </button>
                      )}
                    </span>
                    <span className="cell" data-label={t('options.colScope')}>
                      <span className="pill">
                        {profile.scope === 'exact'
                          ? t('options.scopeExact')
                          : t('options.scopeSubdomains')}
                      </span>
                    </span>
                    <span className="cell mono" data-label={t('options.colCookie')}>
                      {profile.cookies.length}
                    </span>
                    <span className="cell">
                      {profile.storage ? (
                        <span className="pill accent">
                          LS {Object.keys(profile.storage.localStorage).length}
                        </span>
                      ) : (
                        <span className="dim">—</span>
                      )}
                    </span>
                    <span className="cell dim" data-label={t('options.colUpdated')}>
                      {formatTime(profile.updatedAt, t)}
                    </span>
                    <span className="cell actions">
                      {profile.history && profile.history.length > 0 && (
                        <button
                          type="button"
                          className="mini ghost"
                          title={t('options.historyHint')}
                          onClick={() => void openHistory(profile.id)}
                        >
                          {t('options.history')}
                        </button>
                      )}
                      <button
                        type="button"
                        className="mini ghost"
                        title={t('options.overwriteHint')}
                        onClick={() => {
                          setOverwriteStorage(true);
                          setOverwriteId(profile.id);
                        }}
                      >
                        {t('options.overwrite')}
                      </button>
                      <button
                        type="button"
                        className="mini ghost"
                        onClick={() => setConfirmId(profile.id)}
                      >
                        {t('common.delete')}
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ))
        )}
          </div>
        </section>
      ) : (
        <div className="settings-stack">
      <section className="settings">
        <h2>{t('options.switchSettings')}</h2>
        <div className="setting">
          <div>
            <p className="setting-title">{t('options.reloadAfterSwitch')}</p>
            <p className="setting-desc">{t('options.reloadAfterSwitchDesc')}</p>
          </div>
          <Switch
            checked={settings.reloadAfterSwitch}
            onChange={(next) => void updateSettings({ reloadAfterSwitch: next })}
          />
        </div>
        <div className="setting">
          <div>
            <p className="setting-title">{t('options.reloadAllTabs')}</p>
            <p className="setting-desc">{t('options.reloadAllTabsDesc')}</p>
          </div>
          <Switch
            checked={settings.reloadAllSiteTabs}
            onChange={(next) => void updateSettings({ reloadAllSiteTabs: next })}
          />
        </div>
        <div className="setting">
          <div>
            <p className="setting-title">{t('options.writeBack')}</p>
            <p className="setting-desc">{t('options.writeBackDesc')}</p>
          </div>
          <Switch
            checked={settings.writeBackOnSwitch}
            onChange={(next) => void updateSettings({ writeBackOnSwitch: next })}
          />
        </div>
        <div className="setting">
          <div>
            <p className="setting-title">{t('options.historyEnabled')}</p>
            <p className="setting-desc">{t('options.historyEnabledDesc')}</p>
          </div>
          <Switch
            checked={settings.historyEnabled}
            onChange={(next) => void updateSettings({ historyEnabled: next })}
          />
        </div>
        <div className="setting">
          <div>
            <p className="setting-title">{t('options.historyLimit')}</p>
            <p className="setting-desc">
              {t('options.historyLimitDesc', { max: MAX_HISTORY_LIMIT })}
            </p>
          </div>
          <select
            className="select"
            value={settings.historyLimit}
            aria-label={t('options.historyLimit')}
            onChange={(event) => void updateSettings({ historyLimit: Number(event.target.value) })}
          >
            {Array.from({ length: MAX_HISTORY_LIMIT }, (_, index) => index + 1).map((count) => (
              <option key={count} value={count}>
                {count}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="settings">
        <h2>{t('options.quickAccess')}</h2>
        <div className="setting">
          <div>
            <p className="setting-title">{t('options.contextMenu')}</p>
            <p className="setting-desc">{t('options.contextMenuDesc')}</p>
          </div>
          <Switch
            checked={settings.contextMenuEnabled}
            onChange={(next) => void updateSettings({ contextMenuEnabled: next })}
          />
        </div>
        <div className="setting">
          <div>
            <p className="setting-title">{t('options.floatingPanel')}</p>
            <p className="setting-desc">{t('options.floatingPanelDesc')}</p>
          </div>
          <Switch
            checked={settings.floatingPanelEnabled}
            onChange={(next) => void updateSettings({ floatingPanelEnabled: next })}
          />
        </div>
        <div className="setting">
          <div>
            <p className="setting-title">{t('options.panelScale')}</p>
            <p className="setting-desc">{t('options.panelScaleDesc')}</p>
          </div>
          <div className="range-wrap">
            <input
              className="range"
              type="range"
              min={50}
              max={150}
              step={2}
              value={scaleDraft}
              aria-label={t('options.panelScale')}
              onChange={(event) => previewScale(Number(event.target.value))}
            />
            <span className="range-value">{scaleDraft}%</span>
          </div>
        </div>
        <div className="setting">
          <div>
            <p className="setting-title">{t('options.panelPosition')}</p>
            <p className="setting-desc">{t('options.panelPositionDesc')}</p>
          </div>
          <div className="pos-controls">
            <select
              className="select"
              value={settings.panelCorner}
              onChange={(event) =>
                void updateSettings({ panelCorner: event.target.value as PanelCorner })
              }
            >
              <option value="top-left">{t('options.panelCornerTopLeft')}</option>
              <option value="top-right">{t('options.panelCornerTopRight')}</option>
              <option value="bottom-left">{t('options.panelCornerBottomLeft')}</option>
              <option value="bottom-right">{t('options.panelCornerBottomRight')}</option>
            </select>
            <button type="button" className="btn" onClick={() => void resetPanelPosition()}>
              {t('options.panelPositionReset')}
            </button>
          </div>
        </div>
        <div className="setting">
          <div>
            <p className="setting-title">{t('options.quickAccessScope')}</p>
            <p className="setting-desc">{t('options.quickAccessScopeDesc')}</p>
          </div>
          <select
            className="select"
            value={settings.quickAccessScope}
            onChange={(event) =>
              void updateSettings({ quickAccessScope: event.target.value as QuickAccessScope })
            }
          >
            <option value="all">{t('options.scopeAll')}</option>
            <option value="whitelist">{t('options.scopeWhitelist')}</option>
            <option value="blacklist">{t('options.scopeBlacklist')}</option>
          </select>
        </div>
        {settings.quickAccessScope !== 'all' && (
          <div className="setting-block">
            <p className="setting-title">{t('options.sitesLabel')}</p>
            <textarea
              className="sites-input"
              spellCheck={false}
              placeholder={t('options.sitesPlaceholder')}
              value={siteDraft}
              onChange={(event) => setSiteDraft(event.target.value)}
            />
            <p className="setting-desc">
              {settings.quickAccessScope === 'whitelist'
                ? t('options.sitesHintWhitelist')
                : t('options.sitesHintBlacklist')}
            </p>
            {settings.quickAccessScope === 'whitelist' &&
              (settings.quickAccessSites ?? []).length === 0 && (
                <p className="setting-warn">{t('options.sitesEmptyWarn')}</p>
              )}
            <div className="sites-actions">
              <button
                type="button"
                className="btn primary"
                disabled={siteDraft === sitesText}
                onClick={() => void saveSiteList()}
              >
                {t('options.sitesSave')}
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="settings">
        <h2>{t('options.language')}</h2>
        <div className="setting">
          <p className="setting-desc">{t('options.languageDesc')}</p>
          <select
            className="select"
            value={settings.locale}
            onChange={(event) =>
              void updateSettings({ locale: event.target.value as LocalePreference })
            }
          >
            <option value="auto">
              {t('options.languageAuto', { locale: LOCALE_LABELS[detectBrowserLocale()] })}
            </option>
            {SUPPORTED_LOCALES.map((locale) => (
              <option key={locale} value={locale}>
                {LOCALE_LABELS[locale]}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="settings">
        <h2>{t('options.password')}</h2>
        <div className="setting">
          <div>
            <p className="setting-title">
              {lock?.enabled ? t('options.passwordEnabled') : t('options.passwordDisabled')}
            </p>
            <p className="setting-desc">{t('options.passwordDesc')}</p>
          </div>
          {lock?.enabled && (
            <button type="button" className="btn" onClick={() => void handleLockNow()}>
              {t('options.lockNow')}
            </button>
          )}
        </div>
        <div className="setting">
          <input
            className="pwd-input"
            type="password"
            autoComplete="off"
            placeholder={
              lock?.enabled
                ? t('options.passwordPlaceholderCurrent')
                : t('options.passwordPlaceholderSet')
            }
            value={passwordInput}
            onChange={(event) => setPasswordInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              if (lock?.enabled) void handleRemovePassword();
              else void handleSetPassword();
            }}
          />
          {lock?.enabled ? (
            <button
              type="button"
              className="btn danger"
              disabled={!passwordInput || passwordBusy}
              onClick={() => void handleRemovePassword()}
            >
              {t('options.disablePassword')}
            </button>
          ) : (
            <button
              type="button"
              className="btn primary"
              disabled={!passwordInput || passwordBusy}
              onClick={() => void handleSetPassword()}
            >
              {t('options.enable')}
            </button>
          )}
        </div>
      </section>

      <section className="settings">
        <h2>{t('options.crypto')}</h2>
        <div className="setting">
          <div>
            <p className="setting-title">{t('options.cryptoToggle')}</p>
            <p className="setting-desc">
              {settings.encryptStorage ? t('options.cryptoOn') : t('options.cryptoOff')}
            </p>
          </div>
          <Switch
            checked={settings.encryptStorage}
            onChange={(next) => void toggleEncryption(next)}
          />
        </div>
      </section>

      <section className="settings">
        <h2>{t('options.about')}</h2>
        <div className="about">
          <p className="about-desc">{t('options.aboutIntro')}</p>

          <p className="about-sub">{t('options.howTitle')}</p>
          <ol className="about-list">
            <li>{t('options.how1')}</li>
            <li>{t('options.how2')}</li>
            <li>{t('options.how3')}</li>
          </ol>

          <p className="about-sub">{t('options.notesTitle')}</p>
          <ul className="about-list notes">
            <li>{t('options.note1')}</li>
            <li>{t('options.note2')}</li>
            <li>{t('options.note3')}</li>
            <li>{t('options.note4')}</li>
            <li>{t('options.note5')}</li>
          </ul>

          <p className="about-version">
            {t('options.version', { version: chrome.runtime.getManifest().version })}
          </p>
        </div>
      </section>

          <p className="footnote">{t('options.risk')}</p>
        </div>
      )}

      {pendingImport && (
        <div className="modal-mask" onClick={() => setPendingImport(null)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <h3>{t('options.importTitle', { count: importCount })}</h3>
            <p className="modal-desc">{pendingImport.fileName}</p>
            {pendingImport.items.length > 0 && (
              <>
                <label className="check import-selectall">
                  <input
                    type="checkbox"
                    checked={allImportSelected}
                    onChange={toggleImportAll}
                  />
                  <span>{t('options.importSelectAll')}</span>
                </label>
                <ul className="import-list">
                  {pendingImport.items.map((item, index) => (
                    <li key={`${index}-${item.site}`}>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={!!importSelected[index]}
                          onChange={() => toggleImportItem(index)}
                        />
                        <span>{item.name}</span>
                      </label>
                      <span className="import-meta">
                        {item.site} · {t('options.importCookiesCount', { count: item.cookies })}
                        {item.hasStorage ? ' · localStorage' : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="btn"
                disabled={busy || importCount === 0}
                onClick={() => void runImport('merge')}
              >
                {t('options.importMerge')}
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={busy || importCount === 0}
                onClick={() => void runImport('replace')}
              >
                {t('options.importReplace')}
              </button>
            </div>
            <button type="button" className="modal-cancel" onClick={() => setPendingImport(null)}>
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}

      <Confirm
        open={clearSite !== null}
        title={t('options.clearSiteTitle', { site: clearSite ?? '' })}
        desc={t('options.clearSiteDesc', {
          site: clearSite ?? '',
          count: profiles.filter((item) => item.site === clearSite).length,
        })}
        confirmText={t('common.delete')}
        onCancel={() => setClearSite(null)}
        onConfirm={() => {
          if (clearSite) void handleClearSite(clearSite);
        }}
      />

      <Confirm
        open={deleteTarget !== null}
        title={t('confirm.deleteTitle')}
        desc={t('confirm.deleteDesc', { name: deleteTarget?.name ?? '' })}
        confirmText={t('common.delete')}
        onCancel={() => setConfirmId(null)}
        onConfirm={() => {
          if (deleteTarget) void handleDelete(deleteTarget.id);
        }}
      />

      <Confirm
        open={overwriteTarget !== null}
        title={t('confirm.overwriteTitle')}
        desc={t('confirm.overwriteDesc', {
          name: overwriteTarget?.name ?? '',
          site: overwriteTarget?.site ?? '',
        })}
        confirmText={t('options.overwrite')}
        onCancel={() => {
          setOverwriteId(null);
          setOverwriteStorage(true);
        }}
        onConfirm={() => {
          if (overwriteTarget) void handleOverwrite(overwriteTarget.id);
        }}
      >
        <label className="check confirm-check">
          <input
            type="checkbox"
            checked={overwriteStorage}
            onChange={(event) => setOverwriteStorage(event.target.checked)}
          />
          <span>
            {t('options.overwriteStorage')}
            <em>
              {overwriteTarget?.storage
                ? t('options.overwriteStorageNote', { origin: overwriteTarget.storage.origin })
                : t('options.overwriteStorageHint')}
            </em>
          </span>
        </label>
      </Confirm>

      {historyTarget && (
        <div className="modal-mask" onClick={() => setHistoryId(null)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <h3>{t('options.historyTitle', { name: historyTarget.name })}</h3>
            <p className="modal-desc">{t('options.historyDesc')}</p>
            {history.length > 0 ? (
              <ul className="history-list">
                {history.map((item) => (
                  <li key={item.id}>
                    <div className="history-info">
                      <span className="history-time">{formatDateTime(item.createdAt)}</span>
                      <span className="history-meta">
                        {formatTime(item.createdAt, t)} · {t(HISTORY_REASON_KEY[item.reason])} ·{' '}
                        {t('options.historyCookies', { count: item.cookies.length })}
                        {item.storage
                          ? ` · LS ${Object.keys(item.storage.localStorage).length}`
                          : ''}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="mini history-restore"
                      disabled={restoringId !== null}
                      onClick={() => void handleRestore(historyTarget.id, item.id)}
                    >
                      {t('options.historyRestore')}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="history-empty">{t('options.historyEmpty')}</p>
            )}
            <button type="button" className="modal-cancel" onClick={() => setHistoryId(null)}>
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}

      <Confirm
        open={confirmClear}
        title={t('options.clearTitle')}
        desc={t('options.clearDesc', { count: profiles.length })}
        confirmText={t('options.clearConfirm')}
        onCancel={() => setConfirmClear(false)}
        onConfirm={() => {
          if (!busy) void runClear();
        }}
      />

      {toast && <div className={`toast ${toast.kind}`}>{toast.text}</div>}
    </div>
  );
}
