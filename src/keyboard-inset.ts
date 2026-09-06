/** Gap between the layout viewport and the visible visual viewport (keyboard). */
export function keyboardInsetPx(innerHeight: number, visualHeight: number): number {
  return Math.max(0, Math.round(innerHeight - visualHeight));
}

export function applyKeyboardInset(root: HTMLElement, inset: number): void {
  root.style.setProperty("--kb", `${inset}px`);
  root.classList.toggle("kb-open", inset > 40);
}

export function startKeyboardInset(
  win: Pick<Window, "innerHeight" | "scrollTo" | "visualViewport"> = window,
  root: HTMLElement = document.documentElement,
): () => void {
  const vv = win.visualViewport;
  const sync = () => {
    win.scrollTo(0, 0);
    const visualHeight = vv?.height ?? win.innerHeight;
    applyKeyboardInset(root, keyboardInsetPx(win.innerHeight, visualHeight));
  };
  sync();
  if (!vv) return () => {};
  vv.addEventListener("resize", sync);
  vv.addEventListener("scroll", sync);
  win.scrollTo(0, 0);
  return () => {
    vv.removeEventListener("resize", sync);
    vv.removeEventListener("scroll", sync);
    applyKeyboardInset(root, 0);
  };
}
