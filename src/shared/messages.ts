import type {
  ExportBundle,
  LockState,
  PanelState,
  PopupState,
  Profile,
  SaveResult,
  Scope,
  Settings,
  SwitchResult,
} from './types';

export type Request =
  | { type: 'GET_POPUP_STATE' }
  | { type: 'GET_PANEL_STATE' }
  | { type: 'OPEN_OPTIONS' }
  | { type: 'SAVE_PROFILE'; name: string; scope: Scope; includeStorage: boolean }
  | { type: 'SWITCH_PROFILE'; id: string }
  | { type: 'DELETE_PROFILE'; id: string }
  | { type: 'RENAME_PROFILE'; id: string; name: string }
  | { type: 'GET_ALL_PROFILES' }
  | { type: 'EXPORT_DATA' }
  | { type: 'IMPORT_DATA'; payload: string; mode: 'merge' | 'replace' }
  | { type: 'CLEAR_ALL' }
  | { type: 'GET_SETTINGS' }
  | { type: 'UPDATE_SETTINGS'; patch: Partial<Settings> }
  | { type: 'GET_LOCK_STATE' }
  | { type: 'UNLOCK'; password: string }
  | { type: 'SET_PASSWORD'; password: string; currentPassword?: string }
  | { type: 'REMOVE_PASSWORD'; password: string }
  | { type: 'LOCK_NOW' }
  | { type: 'RESET_LOCK' };

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** 后台在未解锁状态下返回的统一错误码 */
export const LOCKED_ERROR = 'LOCKED';

export function sendMessage<T>(request: Request): Promise<ApiResult<T>> {
  return chrome.runtime.sendMessage(request) as Promise<ApiResult<T>>;
}

export type RequestOf<K extends Request['type']> = Extract<Request, { type: K }>;

export type ResponseMap = {
  GET_POPUP_STATE: PopupState;
  GET_PANEL_STATE: PanelState;
  OPEN_OPTIONS: { opened: true };
  SAVE_PROFILE: SaveResult;
  SWITCH_PROFILE: SwitchResult;
  DELETE_PROFILE: { id: string };
  RENAME_PROFILE: Profile;
  GET_ALL_PROFILES: Profile[];
  EXPORT_DATA: ExportBundle;
  IMPORT_DATA: { imported: number; total: number };
  CLEAR_ALL: { cleared: number };
  GET_SETTINGS: Settings;
  UPDATE_SETTINGS: Settings;
  GET_LOCK_STATE: LockState;
  UNLOCK: LockState;
  SET_PASSWORD: LockState;
  REMOVE_PASSWORD: LockState;
  LOCK_NOW: LockState;
  RESET_LOCK: LockState;
};
