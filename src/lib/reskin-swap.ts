/** Keep preparation and the covered commit cancellable; every resource lease has one owner. */
export async function runReskinSwap({
  prepare,
  cover,
  apply,
  painted,
  reveal,
  current,
}: {
  prepare?: () => Promise<void | (() => void)>;
  cover: () => Promise<void>;
  apply: () => void | Promise<void>;
  painted: () => Promise<void>;
  reveal: () => void;
  current: () => boolean;
}) {
  let release: void | (() => void) = undefined;
  try {
    release = await prepare?.();
    if (!current()) return;
    await cover();
    if (!current()) return;
    await apply();
    await painted();
    if (current()) reveal();
  } finally {
    release?.();
  }
}
