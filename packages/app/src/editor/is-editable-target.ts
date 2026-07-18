// The single "is the user typing into an editable element?" guard shared by
// every global keyboard/paste listener (Editor.tsx's window keydown,
// use-clipboard.ts's window paste). A tool shortcut, Space-hold pan-arm, or a
// paste must never fire while focus is inside a form field or a
// contentEditable region — so this MUST include the isContentEditable check
// (a rich-text/editable div is just as "editable" as an <input>). Extracted so
// the two call sites can't drift apart again (they had: use-clipboard checked
// isContentEditable, Editor.tsx did not).
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    // `=== true`, not a bare truthiness read: some runtimes (jsdom) leave
    // isContentEditable undefined, and this function's contract is a boolean.
    target.isContentEditable === true
  );
}
