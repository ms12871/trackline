const REFRESH_INTERVAL = 30_000;
const countdown = document.querySelector("#refresh-countdown");
const refresh = document.querySelector("#refresh-button");
const boardMode = document.querySelector("#board-mode-toggle");
let refreshStarted = Date.now();

function setBoardMode(enabled) {
  document.body.classList.toggle("board-mode", enabled);
  boardMode.setAttribute("aria-pressed", String(enabled));
  boardMode.textContent = enabled ? "STANDARD MODE" : "BOARD MODE";
  localStorage.setItem("trackline-board-mode", enabled ? "on" : "off");
}

if (boardMode) {
  setBoardMode(localStorage.getItem("trackline-board-mode") === "on");
  boardMode.addEventListener("click", () => {
    setBoardMode(!document.body.classList.contains("board-mode"));
  });
}

if (countdown && refresh) {
  refresh.addEventListener("click", () => {
    refreshStarted = Date.now();
  });
  window.setInterval(() => {
    const elapsed = (Date.now() - refreshStarted) % REFRESH_INTERVAL;
    const remaining = Math.ceil((REFRESH_INTERVAL - elapsed) / 1000);
    countdown.textContent = `NEXT UPDATE IN ${remaining}s`;
  }, 1000);
}

document.addEventListener("keydown", (event) => {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  const target = event.target;
  if (target instanceof HTMLElement && (
    target.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)
  )) return;

  if (event.key === "/" && !event.repeat) {
    event.preventDefault();
    const search = document.querySelector("#route-query, #from-station, #station-select");
    search?.focus();
  } else if (event.key.toLowerCase() === "r" && !event.repeat) {
    refresh?.click();
  } else if (event.key.toLowerCase() === "x" && !event.repeat) {
    document.querySelector("#swap-stations")?.click();
  }
});

let touchStartY = null;
document.addEventListener("touchstart", (event) => {
  if (window.scrollY === 0 && event.touches.length === 1) {
    touchStartY = event.touches[0].clientY;
  } else {
    touchStartY = null;
  }
}, { passive: true });

document.addEventListener("touchend", (event) => {
  if (touchStartY === null || window.scrollY !== 0) return;
  const pullDistance = event.changedTouches[0].clientY - touchStartY;
  touchStartY = null;
  if (pullDistance >= 85) refresh?.click();
}, { passive: true });
