// Small event/DOM fixture for exercising the real controls in node, without an audio device or browser.
export function installDOM() {
  const previous = {document: globalThis.document, Option: globalThis.Option};
  class Element extends EventTarget {
    constructor(tag) {
      super(); this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.attributes = {};
      this.style = {setProperty: (key, value) => {this.style[key] = value;}}; this._value = ''; this.hidden = false;
    }
    setAttribute(key, value) {this.attributes[key] = String(value);}
    getAttribute(key) {return this.attributes[key] ?? null;}
    append(...children) {for (const child of children) {child.parentElement = this; this.children.push(child);}}
    replaceChildren(...children) {this.children = []; this.append(...children);}
    get options() {return this.children;}
    add(option) {this.append(option);}
    set value(value) {this._value = String(value);}
    get value() {return this._value || (this.tagName === 'SELECT' ? this.options[0]?.value || '' : '');}
    focus() {const old = document.activeElement; document.activeElement = this; if (old !== this) old?.dispatchEvent(new Event('blur'));}
    blur() {document.activeElement = null; this.dispatchEvent(new Event('blur'));}
    select() {}
    setPointerCapture(id) {this.pointerId = id;}
    querySelector(selector) {return this.querySelectorAll(selector)[0] || null;}
    querySelectorAll(selector) {
      const matches = (element, part) => part[0] === '#' ? element.id === part.slice(1)
        : part[0] === '.' ? element.className?.split(' ').includes(part.slice(1))
        : part === '[data-setting]' ? Object.hasOwn(element.dataset, 'setting')
        : element.tagName === part.toUpperCase();
      const result = [], selectors = selector.split(',').map(s => s.trim().split(/\s+/));
      const walk = element => {for (const child of element.children) {
        if (selectors.some(parts => {
          if (!matches(child, parts.at(-1))) return false;
          let ancestor = child.parentElement;
          for (let i = parts.length - 2; i >= 0; i--) {
            while (ancestor && !matches(ancestor, parts[i])) ancestor = ancestor.parentElement;
            if (!ancestor) return false; ancestor = ancestor.parentElement;
          }
          return true;
        })) result.push(child);
        walk(child);
      }};
      walk(this); return result;
    }
    set innerHTML(html) {
      this.children = []; const stack = [this];
      for (const match of html.matchAll(/<\/?([\w-]+)([^>]*)>/g)) {
        if (match[0][1] === '/') {stack.pop(); continue;}
        const element = new Element(match[1]);
        for (const [, key, value] of match[2].matchAll(/([\w-]+)="([^"]*)"/g)) {
          element.setAttribute(key, value);
          if (['id','type'].includes(key)) element[key] = value;
          if (key === 'class') element.className = value;
        }
        stack.at(-1).append(element);
        if (!['input','path','circle'].includes(match[1])) stack.push(element);
      }
    }
  }
  globalThis.document = {activeElement: null, createElement: tag => new Element(tag)};
  globalThis.Option = class extends Element {
    constructor(text, value) {super('option'); this.textContent = text; this.value = value;}
  };
  return () => Object.assign(globalThis, previous);
}
export function fire(element, type, detail = {}) {
  const event = new Event(type, {cancelable: true}); Object.assign(event, detail); element.dispatchEvent(event); return event;
}
