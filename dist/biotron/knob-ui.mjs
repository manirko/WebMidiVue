import {knob} from '../core/knobs.mjs';

export const KNOB_HINT = 'Drag ↑↓ · double-click to reset';
export function mountKnob(spec, initial, onCommit) {
  let committed = initial;
  const view = knob(spec, initial, value => sync(value), value => {
    committed = value; onCommit(value);
  });
  const input = view.element.querySelector('.dial-control input');
  // Keep the shared gesture/quantization code, with explicit ARIA slider semantics and no native range.
  input.type = 'text'; input.readOnly = true; input.inputMode = 'none';
  input.setAttribute('role', 'slider'); input.setAttribute('aria-orientation', 'vertical');
  input.setAttribute('aria-valuemin', spec.min); input.setAttribute('aria-valuemax', spec.max);
  view.element.querySelector('.dial-face').innerHTML = '<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="27"/><path d="M32 12v11"/></svg>';
  function sync(value) {input.setAttribute('aria-valuenow', value);}
  function set(value) {committed = view.set(value); sync(committed);}
  for (const event of ['pointercancel', 'lostpointercapture']) input.addEventListener(event, () => set(committed));
  input.addEventListener('blur', () => input.dispatchEvent(new Event('change')));
  set(initial);
  return {element: view.element, input, set,
    disable: disabled => {for (const control of view.element.querySelectorAll('input,button,select')) control.disabled = disabled;}};
}
