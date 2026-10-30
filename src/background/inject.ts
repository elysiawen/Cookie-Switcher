/**
 * 页面内执行的函数必须完全自包含：不能引用模块作用域里的任何变量，
 * 否则序列化后运行时会丢失引用。
 */
export async function readLocalStorage(tabId: number): Promise<Record<string, string>> {
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const out: Record<string, string> = {};
      for (let i = 0; i < window.localStorage.length; i += 1) {
        const key = window.localStorage.key(i);
        if (key !== null) {
          out[key] = window.localStorage.getItem(key) ?? '';
        }
      }
      return out;
    },
  });
  const value = injection?.result;
  if (!value || typeof value !== 'object') return {};
  return value as Record<string, string>;
}

export async function writeLocalStorage(
  tabId: number,
  data: Record<string, string>,
): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (payload: Record<string, string>) => {
      window.localStorage.clear();
      for (const key of Object.keys(payload)) {
        window.localStorage.setItem(key, payload[key]);
      }
    },
    args: [data],
  });
}
