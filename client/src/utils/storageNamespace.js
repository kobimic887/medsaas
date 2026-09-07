// Same-origin isolation for the /staging/ build.
//
// The staging app shares its origin (https://app.pyxis-discovery.com) with the
// production app at "/". localStorage/sessionStorage are origin-scoped, so
// without isolation the staging build would read, overwrite and clear the
// production app's keys (auth session, docking/viewer results) and vice versa.
//
// Rather than editing every `localStorage.getItem('molstar_pdb_url')` call
// site, this shim transparently prefixes every key the staging build touches
// with "pxstg__" and is installed once at bootstrap. The production build has
// APP_BASE_PATH === "" and installs nothing, so its keys stay exactly as they
// are today. The two environments then never see each other's keys:
//   - staging logout clears only pxstg__* keys (a production session in another
//     tab keeps its token and viewer results),
//   - a production logout never clears the staging session.
//
// clear() is deliberately safe: it only removes keys with the namespace prefix
// instead of wiping the whole origin's storage.

import { APP_BASE_PATH } from "./appEnv";

export const STORAGE_NAMESPACE_PREFIX = "pxstg__";

/** Apply the namespace to one key. Exported for tests. */
export function namespacedKey(prefix, key) {
  return `${prefix}${String(key)}`;
}

function wrapStorage(storage, prefix) {
  if (!storage) return;
  const define = (name, fn) => {
    try {
      Object.defineProperty(storage, name, {
        configurable: true,
        enumerable: false,
        writable: true,
        value: fn,
      });
    } catch {
      // Some private-mode browsers make Storage read-only; skip the patch
      // rather than crashing the app at boot.
      try {
        storage[name] = fn;
      } catch {
        /* ignore */
      }
    }
  };

  const original = {
    getItem: storage.getItem.bind(storage),
    setItem: storage.setItem.bind(storage),
    removeItem: storage.removeItem.bind(storage),
  };

  define("getItem", (key) => {
    try {
      return original.getItem(namespacedKey(prefix, key));
    } catch {
      return null;
    }
  });
  define("setItem", (key, value) => {
    try {
      return original.setItem(namespacedKey(prefix, key), String(value));
    } catch {
      /* quota/private-mode errors surface as writes that never persist */
    }
  });
  define("removeItem", (key) => {
    try {
      return original.removeItem(namespacedKey(prefix, key));
    } catch {
      /* ignore */
    }
  });
  // Only wipe keys this environment owns — never the production app's keys.
  define("clear", () => {
    try {
      const doomed = [];
      for (let i = 0; i < storage.length; i += 1) {
        const key = storage.key(i);
        if (key && key.startsWith(prefix)) doomed.push(key);
      }
      for (const key of doomed) {
        original.removeItem(key);
      }
    } catch {
      /* ignore */
    }
  });
}

/** Pure helper so the same behaviour is testable outside a browser. */
export function installStorageNamespaceFor(localStorageLike, sessionStorageLike, prefix) {
  if (!prefix) return false;
  wrapStorage(localStorageLike, prefix);
  wrapStorage(sessionStorageLike, prefix);
  return true;
}

/** Install the namespace for the current build. No-op on the root build. */
export function installStorageNamespace() {
  if (!APP_BASE_PATH || typeof window === "undefined") return false;
  if (window.__pxStorageNamespaceInstalled) return true;
  installStorageNamespaceFor(
    window.localStorage,
    window.sessionStorage,
    STORAGE_NAMESPACE_PREFIX
  );
  window.__pxStorageNamespaceInstalled = true;
  return true;
}
