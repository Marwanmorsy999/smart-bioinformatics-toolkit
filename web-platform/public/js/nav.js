/* Global shell: accessible mobile navigation toggle.
   Shell-only behaviour. No analysis, API or scientific logic lives here. */

const DESKTOP = "(min-width: 641px)";

for (const header of document.querySelectorAll(".topbar")) {
  const toggle = header.querySelector(".nav-toggle");
  if (!toggle) continue;

  const nav = document.getElementById(toggle.getAttribute("aria-controls"));
  if (!nav) continue;

  function setOpen(open) {
    header.dataset.navOpen = String(open);
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
  }

  toggle.addEventListener("click", () => {
    setOpen(toggle.getAttribute("aria-expanded") !== "true");
  });

  // Following a link closes the panel so it never covers the new page.
  nav.addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.closest("a")) setOpen(false);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && header.dataset.navOpen === "true") {
      setOpen(false);
      toggle.focus();
    }
  });

  const desktop = window.matchMedia(DESKTOP);
  const resetOnDesktop = () => {
    if (desktop.matches) setOpen(false);
  };
  if (typeof desktop.addEventListener === "function") {
    desktop.addEventListener("change", resetOnDesktop);
  } else if (typeof desktop.addListener === "function") {
    desktop.addListener(resetOnDesktop);
  }
  resetOnDesktop();
}
