import { useEffect, useRef, type ReactNode } from 'react';
import { useI18n } from '@/shared/i18n/provider';

export interface ConfirmProps {
  open: boolean;
  title: string;
  desc?: string;
  /** 卡片主体内容，例如表单或勾选项 */
  children?: ReactNode;
  /** 确认按钮文案，默认「确认」 */
  confirmText?: string;
  cancelText?: string;
  /** 危险操作用淡红按钮 */
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * 通用二次确认弹窗。样式放在 styles/base.css，
 * popup 与 options 两个入口都能直接用。
 */
export function Confirm({
  open,
  title,
  desc,
  children,
  confirmText,
  cancelText,
  danger = true,
  onCancel,
  onConfirm,
}: ConfirmProps) {
  const { t } = useI18n();

  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  useEffect(() => {
    if (!open) return;
    if (!document.body.classList.contains('popup-body')) return;
    const el = cardRef.current;
    if (!el) return;

    // 弹窗是 fixed 定位、不参与文档流，而 popup 的视口高度由普通内容撑开，
    // 这里把 body 撑高，卡片底部才不会被视口裁掉
    const body = document.body;
    const prev = body.style.minHeight;
    body.style.minHeight = `${Math.min(el.scrollHeight + 40, 600)}px`;
    return () => {
      body.style.minHeight = prev;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="confirm-mask" onClick={onCancel}>
      <div
        ref={cardRef}
        className="confirm-card"
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <h3 className="confirm-title">{title}</h3>
        {desc && <p className="confirm-desc">{desc}</p>}
        {children}
        <div className="confirm-btns">
          <button type="button" className="confirm-btn ghost" onClick={onCancel}>
            {cancelText ?? t('common.cancel')}
          </button>
          <button
            type="button"
            className={danger ? 'confirm-btn danger' : 'confirm-btn primary'}
            onClick={onConfirm}
          >
            {confirmText ?? t('common.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
