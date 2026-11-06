export type Notice = { title: string; hash: string };

let notice: Notice | null = null;
const listeners = new Set<() => void>();

function set(next: Notice | null) {
  notice = next;
  listeners.forEach((listener) => listener());
}

export const getNotice = () => notice;
export const showNotice = (title: string, hash: string) => set({ title, hash });
export const closeNotice = () => set(null);

export function subscribeNotice(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
