// TooWholesome DPS: the "Start automatically with AION 2" toggle in Settings.
// The backend registers or removes a sign-in task (src-tauri/src/autostart.rs);
// the toggle always shows what Task Scheduler actually has.
(() => {
  const invoke = (cmd, args) =>
    window.__TAURI__?.core?.invoke?.(cmd, args) ?? Promise.reject(new Error("Not available here"));

  const start = () => {
    const box = document.querySelector(".launchWithGameCheckbox");
    const status = document.querySelector(".launchWithGameStatus");
    if (!box) return;

    const say = (text, isError = false) => {
      if (!status) return;
      status.textContent = text || "";
      status.hidden = !text;
      status.classList.toggle("isError", isError);
    };

    const refresh = () =>
      invoke("get_launch_with_game")
        .then((on) => {
          box.checked = !!on;
        })
        .catch(() => {});

    box.addEventListener("change", () => {
      const wanted = box.checked;
      box.disabled = true;
      say(wanted ? "Setting up…" : "Turning off…");
      invoke("set_launch_with_game", { enabled: wanted })
        .then((on) => {
          box.checked = !!on;
          say(on ? "On: the meter will wait in the background and appear when AION 2 opens." : "");
        })
        .catch((err) => {
          box.checked = !wanted;
          say(String(err?.message || err || "Could not change this setting."), true);
        })
        .finally(() => {
          box.disabled = false;
        });
    });

    refresh();
    // Settings is a reused window: re-read whenever it is shown again.
    window.__TAURI__?.event?.listen?.("settings-shown", refresh);
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
