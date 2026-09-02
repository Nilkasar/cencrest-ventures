/**
 * Runs synchronously in <head>, before first paint, so an explicit theme
 * override (set via the topbar toggle) never flashes the wrong theme.
 * Mirrors the "system by default, explicit override persisted" contract
 * documented in @bebest/ui/DESIGN.md#theming.
 */
export const themeInitScript = `
(function () {
  try {
    var stored = localStorage.getItem("bebest-theme");
    if (stored === "light" || stored === "dark") {
      document.documentElement.setAttribute("data-theme", stored);
    }
  } catch (_e) {}
})();
`;
