// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { isEditableTarget } from './is-editable-target';

describe('isEditableTarget', () => {
  it('is true for form fields', () => {
    for (const tag of ['input', 'textarea', 'select'] as const) {
      expect(isEditableTarget(document.createElement(tag))).toBe(true);
    }
  });

  it('is true for a contentEditable element (the check the Editor global keydown used to miss)', () => {
    const el = document.createElement('div');
    // jsdom does not compute isContentEditable from the attribute, so pin it.
    Object.defineProperty(el, 'isContentEditable', { value: true, configurable: true });
    expect(isEditableTarget(el)).toBe(true);
  });

  it('is false for non-editable elements and non-elements', () => {
    expect(isEditableTarget(document.createElement('div'))).toBe(false);
    expect(isEditableTarget(document.createElement('button'))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget(new EventTarget())).toBe(false);
  });
});
