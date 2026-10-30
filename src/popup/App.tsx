import { useCallback, useEffect, useState } from 'react';
import { formatTime } from '@/shared/i18n';
import { useI18n } from '@/shared/i18n/provider';
import { LOCKED_ERROR, sendMessage } from '@/shared/messages';
import type {
  LockState,
  PopupState,
  Profile,
  SaveResult,
  Scope,
  SwitchResult,
} from '@/shared/types';

type Toast = { kind: 'ok' | 'err' | 'warn'; text: string } | null;

function hueOf(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) % 360;
  }
  return hash;
}

function Avatar({ name }: { name: string }) {
  const hue = hueOf(name || '?');
  return (
    <span
      className="avatar"
      style={{ background: `hsl(${hue} 76% 95%)`, color: `hsl(${hue} 52% 38%)` }}
    >
      {name.trim().slice(0, 1).toUpperCase() || '?'}
    </span>
  );
}

interface RowProps {
  profile: Profile;
  busy: boolean;
  disabled: boolean;
  confirming: boolean;
  onSwitch: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => void;
}

function ProfileRow({
  profile,
  busy,
  disabled,
  confirming,
  onSwitch,
  onAskDelete,
  onCancelDelete,
  onDelete,
}: RowProps) {
  const { t } = useI18n();

  if (confirming) {
    return (
      <li className="row row-confirm">
        <span className="confirm-text">{t('popup.confirmDelete', { name: profile.name })}</span>
        <div className="confirm-actions">
          <button type="button" className="mini ghost" onClick={onCancelDelete}>
            {t('common.cancel')}
          </button>
          <button type="button" className="mini danger" onClick={onDelete}>
            {t('common.delete')}
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className="row">
      <button type="button" className="row-main" onClick={onSwitch} disabled={disabled || busy}>
        <Avatar name={profile.name} />
        <span className="row-text">
          <span className="row-name">
            {profile.name}
            {profile.storage && <span className="tag">+LS</span>}
          </span>
          <span className="row-meta">
            {t('popup.rowMeta', {
              count: profile.cookies.length,
              time: formatTime(profile.updatedAt, t),
            })}
          </span>
        </span>
        {busy && <span className="spinner" />}
      </button>
      <button type="button" className="row-del" title={t('common.delete')} onClick={onAskDelete}>
        <svg
          viewBox="0 0 24 24"
          width="15"
          height="15"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M4.75 7h14.5" />
          <path d="M9.6 7V5.6A1.6 1.6 0 0 1 11.2 4h1.6a1.6 1.6 0 0 1 1.6 1.6V7" />
          <path d="M6.9 7l.74 11.55A1.8 1.8 0 0 0 9.44 20.3h5.12a1.8 1.8 0 0 0 1.8-1.75L17.1 7" />
          <path d="M10.4 10.8v5.7M13.6 10.8v5.7" />
        </svg>
      </button>
    </li>
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
    <div className="lock">
      <div className="lock-badge">
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path
            fill="currentColor"
            d="M12 2a5 5 0 0 0-5 5v2H6.5A1.5 1.5 0 0 0 5 10.5v9A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-9A1.5 1.5 0 0 0 17.5 9H17V7a5 5 0 0 0-5-5Zm3.5 7h-7V7a3.5 3.5 0 1 1 7 0v2Zm-3.5 4a1.6 1.6 0 0 1 .9 2.92V18a.9.9 0 0 1-1.8 0v-2.08A1.6 1.6 0 0 1 12 13Z"
          />
        </svg>
      </div>
      <p className="lock-title">{t('lock.locked')}</p>
      <p className="lock-desc">{t('lock.desc')}</p>
      <input
        className="input lock-input"
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
        className="btn primary lock-submit"
        disabled={!password || busy}
        onClick={() => void submit()}
      >
        {busy ? t('lock.verifying') : t('lock.unlock')}
      </button>

      {resetArmed ? (
        <div className="lock-reset">
          <p>{t('lock.resetWarn')}</p>
          <div className="lock-reset-actions">
            <button type="button" className="link" onClick={() => setResetArmed(false)}>
              {t('common.cancel')}
            </button>
            <button type="button" className="link danger" onClick={() => void reset()}>
              {t('lock.resetConfirm')}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="link lock-forgot" onClick={() => setResetArmed(true)}>
          {t('lock.forgot')}
        </button>
      )}
    </div>
  );
}

export default function App() {
  const { t } = useI18n();
  const [state, setState] = useState<PopupState | null>(null);
  const [lock, setLock] = useState<LockState | null>(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [scope, setScope] = useState<Scope>('subdomains');
  const [includeStorage, setIncludeStorage] = useState(false);

  const refreshLock = useCallback(async () => {
    const result = await sendMessage<LockState>({ type: 'GET_LOCK_STATE' });
    if (result.ok) setLock(result.data);
  }, []);

  const refresh = useCallback(async () => {
    const result = await sendMessage<PopupState>({ type: 'GET_POPUP_STATE' });
    if (result.ok) {
      setState(result.data);
      setError('');
      return;
    }
    if (result.error === LOCKED_ERROR) {
      setState(null);
      await refreshLock();
      return;
    }
    setError(result.error);
  }, [refreshLock]);

  useEffect(() => {
    void (async () => {
      const result = await sendMessage<LockState>({ type: 'GET_LOCK_STATE' });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setLock(result.data);
      if (!result.data.enabled || result.data.unlocked) await refresh();
    })();
  }, [refresh]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const context = state?.context;
  const profiles = state?.profiles ?? [];
  const canOperate = Boolean(context?.injectable);

  const openSave = () => {
    setName(t('popup.defaultName', { n: profiles.length + 1 }));
    setIncludeStorage(false);
    setSaveOpen(true);
  };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    const result = await sendMessage<SaveResult>({
      type: 'SAVE_PROFILE',
      name,
      scope,
      includeStorage,
    });
    setSaving(false);
    if (!result.ok) {
      setToast({ kind: 'err', text: result.error });
      return;
    }
    const data = result.data;
    const detail = [
      t('popup.saved', { name: data.profile?.name ?? '' }),
      t('popup.savedCookies', { count: data.cookieCount }),
    ];
    if (data.storageCount) detail.push(t('popup.savedLs', { count: data.storageCount }));
    setToast({
      kind: data.errors.length ? 'warn' : 'ok',
      text: data.errors.length ? `${detail.join(' · ')}（${data.errors[0]}）` : detail.join(' · '),
    });
    setSaveOpen(false);
    await refresh();
  };

  const handleSwitch = async (profile: Profile) => {
    if (busyId) return;
    setBusyId(profile.id);
    setConfirmId(null);
    const result = await sendMessage<SwitchResult>({ type: 'SWITCH_PROFILE', id: profile.id });
    setBusyId(null);
    if (!result.ok) {
      setToast({ kind: 'err', text: result.error });
      return;
    }
    const data = result.data;
    const detail = [
      t('popup.switched', { name: data.profileName }),
      t('popup.written', { count: data.written }),
      t('popup.cleared', { count: data.cleared }),
    ];
    if (data.skippedExpired) detail.push(t('popup.skippedExpired', { count: data.skippedExpired }));
    if (data.storageWritten) detail.push(t('popup.lsSynced'));
    if (data.storageNote) detail.push(data.storageNote);
    const trouble = data.errors[0] ?? data.warnings[0];
    setToast({
      kind: trouble ? 'warn' : 'ok',
      text: data.errors.length
        ? `${detail.join(' · ')}｜${t('popup.failedCount', { count: data.errors.length, error: data.errors[0] })}`
        : trouble
          ? `${detail.join(' · ')}｜${trouble}`
          : detail.join(' · '),
    });
    await refresh();
  };

  const handleDelete = async (id: string) => {
    const result = await sendMessage<{ id: string }>({ type: 'DELETE_PROFILE', id });
    setConfirmId(null);
    if (!result.ok) {
      setToast({ kind: 'err', text: result.error });
      return;
    }
    setToast({ kind: 'ok', text: t('popup.deleted') });
    await refresh();
  };

  const openOptions = () => {
    chrome.runtime.openOptionsPage();
    window.close();
  };

  const handleLockNow = async () => {
    const result = await sendMessage<LockState>({ type: 'LOCK_NOW' });
    if (!result.ok) return;
    setState(null);
    setLock(result.data);
  };

  if (lock?.enabled && !lock.unlocked) {
    return (
      <div className="pop">
        <LockScreen
          onUnlocked={() => {
            void (async () => {
              await refreshLock();
              await refresh();
            })();
          }}
        />
      </div>
    );
  }

  return (
    <div className="pop">
      <header className="head">
        <div className="head-main">
          <span className="dot" />
          <div className="head-text">
            <span className="host" title={context?.hostname ?? ''}>
              {context?.hostname ?? t('popup.noPage')}
            </span>
            <span className="sub">
              {context?.site ? `${context.site} · ` : ''}
              {t('popup.cookieCount', { count: context?.liveCookieCount ?? 0 })}
            </span>
          </div>
        </div>
        <div className="head-actions">
          {lock?.enabled && (
            <button
              type="button"
              className="icon-btn"
              title={t('popup.lockNowTitle')}
              onClick={() => void handleLockNow()}
            >
              <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M12 2a5 5 0 0 0-5 5v2H6.5A1.5 1.5 0 0 0 5 10.5v9A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-9A1.5 1.5 0 0 0 17.5 9H17V7a5 5 0 0 0-5-5Zm3.5 7h-7V7a3.5 3.5 0 1 1 7 0v2Zm-2.6 4a1.6 1.6 0 0 1 .9 2.92V18a.9.9 0 0 1-1.8 0v-2.08A1.6 1.6 0 0 1 12.9 13Z"
                />
              </svg>
            </button>
          )}
          <button
            type="button"
            className="icon-btn"
            title={t('popup.manageAllTitle')}
            onClick={openOptions}
          >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path
              fill="currentColor"
              d="M12 15.5A3.5 3.5 0 1 0 12 8.5a3.5 3.5 0 0 0 0 7Zm8.94-2.62.02-.88-.02-.88 1.7-1.32a.75.75 0 0 0 .18-.96l-1.6-2.77a.75.75 0 0 0-.9-.32l-2 .8a7.6 7.6 0 0 0-1.52-.88l-.3-2.13A.75.75 0 0 0 15.75 3h-3.2a.75.75 0 0 0-.74.63l-.3 2.13a7.6 7.6 0 0 0-1.53.88l-2-.8a.75.75 0 0 0-.9.32L5.5 8.93a.75.75 0 0 0 .18.96l1.7 1.32a7.8 7.8 0 0 0 0 1.76l-1.7 1.32a.75.75 0 0 0-.18.96l1.6 2.77c.17.3.54.43.9.32l2-.8c.48.36 1 .66 1.53.88l.3 2.13c.05.36.37.63.74.63h3.2c.37 0 .69-.27.74-.63l.3-2.13a7.6 7.6 0 0 0 1.52-.88l2 .8c.36.11.73-.02.9-.32l1.6-2.77a.75.75 0 0 0-.18-.96l-1.7-1.32Z"
            />
          </svg>
          </button>
        </div>
      </header>

      {error && <div className="banner error">{error}</div>}

      {context && !canOperate && <div className="banner warn">{t('popup.notWebPage')}</div>}

      <main className="body">
        {!state ? (
          <div className="loading">{t('common.loading')}</div>
        ) : profiles.length === 0 ? (
          <div className="empty">
            <div className="empty-icon">🍪</div>
            <p className="empty-title">{t('popup.emptyTitle')}</p>
            <p className="empty-desc">{t('popup.emptyDesc')}</p>
          </div>
        ) : (
          <ul className="list">
            {profiles.map((profile) => (
              <ProfileRow
                key={profile.id}
                profile={profile}
                busy={busyId === profile.id}
                disabled={!canOperate}
                confirming={confirmId === profile.id}
                onSwitch={() => void handleSwitch(profile)}
                onAskDelete={() => setConfirmId(profile.id)}
                onCancelDelete={() => setConfirmId(null)}
                onDelete={() => void handleDelete(profile.id)}
              />
            ))}
          </ul>
        )}

        {saveOpen ? (
          <section className="save">
            <label className="field">
              <span className="label">{t('popup.nameLabel')}</span>
              <input
                className="input"
                value={name}
                autoFocus
                placeholder={t('popup.namePlaceholder')}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void handleSave();
                  if (event.key === 'Escape') setSaveOpen(false);
                }}
              />
            </label>

            <div className="field">
              <span className="label">{t('popup.scopeLabel')}</span>
              <div className="segment">
                <button
                  type="button"
                  className={scope === 'subdomains' ? 'seg on' : 'seg'}
                  onClick={() => setScope('subdomains')}
                >
                  {t('popup.scopeSubdomains')}
                </button>
                <button
                  type="button"
                  className={scope === 'exact' ? 'seg on' : 'seg'}
                  onClick={() => setScope('exact')}
                >
                  {t('popup.scopeExact')}
                </button>
              </div>
              <span className="hint">
                {scope === 'subdomains'
                  ? t('popup.scopeSubdomainsHint', { site: context?.site ?? '' })
                  : t('popup.scopeExactHint', {
                      host: context?.hostname ?? '',
                      site: context?.site ?? '',
                    })}
              </span>
            </div>

            <label className={canOperate ? 'check' : 'check disabled'}>
              <input
                type="checkbox"
                checked={includeStorage}
                disabled={!canOperate}
                onChange={(event) => setIncludeStorage(event.target.checked)}
              />
              <span>
                {t('popup.includeStorage')}
                <em>
                  {t('popup.includeStorageOrigin', { origin: context?.origin ?? '-' })}
                </em>
              </span>
            </label>

            <div className="save-actions">
              <button type="button" className="btn ghost" onClick={() => setSaveOpen(false)}>
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={saving || !canOperate}
                onClick={() => void handleSave()}
              >
                {saving ? t('common.saving') : t('common.save')}
              </button>
            </div>
          </section>
        ) : (
          <button type="button" className="add" disabled={!canOperate} onClick={openSave}>
            <span className="plus">+</span> {t('popup.saveCurrent')}
          </button>
        )}
      </main>

      <footer className="foot">
        <span className="foot-hint">
          {state?.settings.encryptStorage ? t('popup.encrypted') : t('popup.unencrypted')}
          {profiles.length > 0
            ? ` · ${t('popup.identityCount', { count: profiles.length })}`
            : ''}
        </span>
        <button type="button" className="link" onClick={openOptions}>
          {t('popup.manageAll')}
        </button>
      </footer>

      {toast && <div className={`toast ${toast.kind}`}>{toast.text}</div>}
    </div>
  );
}
