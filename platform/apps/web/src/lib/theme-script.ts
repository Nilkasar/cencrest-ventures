/**
 * Runs synchronously in <head>, before first paint, so an explicit theme
 * override (set via the topbar toggle) never flashes the wrong theme.
 * Mirrors the "system by default, explicit override persisted" contract
 * documented in @bebest/ui/DESIGN.md#theming. Also restores a collapsed
 * sidebar (`use-sidebar.ts`) so the content offset doesn't jump on load.
 */
export const themeInitScript = `
(function () {
  try {
    var stored = localStorage.getItem("bebest-theme");
    if (stored === "light" || stored === "dark") {
      document.documentElement.setAttribute("data-theme", stored);
    }
    if (localStorage.getItem("bebest-sidebar") === "collapsed") {
      document.documentElement.setAttribute("data-sidebar", "collapsed");
    }
  } catch (_e) {}
})();
`;
