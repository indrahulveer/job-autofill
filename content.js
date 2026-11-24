// Injected on demand (activeTab) into the page and its frames.
(function () {
  if (window.__jobAutofill) return;

  const SKIP_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'file', 'password', 'checkbox', 'radio', 'image', 'color', 'range', 'date']);

  const norm = (s) =>
    (s || '').toLowerCase().replace(/[_\-*:()\[\]\/.,]/g, ' ').replace(/\s+/g, ' ').trim();
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function collect(root, out) {
    root.querySelectorAll('input, textarea, select').forEach((el) => out.push(el));
    root.querySelectorAll('*').forEach((el) => {
      if (el.shadowRoot) collect(el.shadowRoot, out);
    });
    return out;
  }

  function isFillable(el) {
    if (el.disabled || el.readOnly) return false;
    if (el.tagName === 'INPUT' && SKIP_TYPES.has((el.type || 'text').toLowerCase())) return false;
    return el.getClientRects().length > 0;
  }

  // "primary" = human-visible text; "secondary" = machine names (name/id).
  function describe(el) {
    const primary = [];
    if (el.labels) el.labels.forEach((l) => primary.push(l.innerText || l.textContent));
    primary.push(el.getAttribute('aria-label'), el.placeholder, el.title);
    const lb = el.getAttribute('aria-labelledby');
    if (lb) {
      lb.split(/\s+/).forEach((id) => {
        const n = el.getRootNode().getElementById ? el.getRootNode().getElementById(id) : null;
        if (n) primary.push(n.innerText || n.textContent);
      });
    }
    // Label rendered near the control but not linked: only trust a container holding exactly one control.
    let p = el.parentElement;
    for (let i = 0; i < 3 && p; i++, p = p.parentElement) {
      if (p.querySelectorAll('input, select, textarea').length !== 1) break;
      const lab = p.querySelector('label, legend, [class*="label" i]');
      if (lab && !lab.contains(el)) {
        primary.push((lab.innerText || lab.textContent || '').slice(0, 120));
        break;
      }
      // plain text next to the control (e.g. <div><span>LinkedIn</span><input></div>)
      const txt = (p.textContent || '').trim();
      if (txt && txt.length <= 80) {
        primary.push(txt);
        break;
      }
    }
    return {
      primary: primary.map(norm).filter(Boolean),
      secondary: [el.name, el.id, el.getAttribute('data-testid'), el.getAttribute('data-qa')].map(norm).filter(Boolean),
      ac: (el.getAttribute('autocomplete') || '').toLowerCase().split(/\s+/)
    };
  }

  function phraseHit(text, phrase) {
    return new RegExp('(^|\\s)' + esc(norm(phrase)) + '(\\s|$)').test(text);
  }

  function matchBuiltin(desc) {
    for (const f of JAF_FIELDS) {
      if (f.ac && f.ac.some((a) => desc.ac.includes(a))) return f;
      if (f.exact && desc.primary.some((t) => f.exact.some((e) => t === norm(e)))) return f;
      if (f.aliases.some((a) => desc.primary.some((t) => phraseHit(t, a)))) return f;
    }
    for (const f of JAF_FIELDS) {
      // machine names are noisy, so require a stricter match (alias without spaces too)
      if (f.aliases.some((a) => desc.secondary.some((t) => phraseHit(t, a) || t.replace(/\s/g, '') === norm(a).replace(/\s/g, '')))) return f;
    }
    return null;
  }

  function matchCustom(desc, custom) {
    const all = desc.primary.concat(desc.secondary);
    for (const c of custom || []) {
      const kws = (c.keywords || '').split(',').map((k) => k.trim()).filter(Boolean);
      if (c.value && kws.some((k) => all.some((t) => phraseHit(t, k)))) return c;
    }
    return null;
  }

  function setNative(el, val) {
    const proto =
      el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype :
      el instanceof HTMLSelectElement ? HTMLSelectElement.prototype :
      HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    el.dispatchEvent(new Event('focus', { bubbles: true }));
    setter.call(el, val);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  function fillSelect(el, val) {
    const v = norm(val);
    const opts = Array.from(el.options);
    const hit =
      opts.find((o) => norm(o.value) === v || norm(o.text) === v) ||
      opts.find((o) => v && (norm(o.text).includes(v) || (norm(o.text) && v.includes(norm(o.text)))));
    if (!hit) return false;
    setNative(el, hit.value);
    return true;
  }

  function alreadyFilled(el) {
    if (el.tagName === 'SELECT') return el.selectedIndex > 0 && norm(el.options[el.selectedIndex].text) !== '';
    return (el.value || '').trim() !== '';
  }

  function flash(el) {
    const old = el.style.outline;
    el.style.outline = '2px solid #34a853';
    setTimeout(() => (el.style.outline = old), 1500);
  }

  function apply(el, value) {
    if (el.tagName === 'SELECT') return fillSelect(el, value);
    let v = value;
    if ((el.type || '').toLowerCase() === 'number') {
      const n = parseFloat(String(value).replace(/,/g, ''));
      if (isNaN(n)) return false;
      v = String(n);
    }
    setNative(el, v);
    return true;
  }

  function fillPage(data) {
    const profile = (data && data.profile) || {};
    const custom = (data && data.custom) || [];
    const overwrite = !!(data && data.overwrite);
    let count = 0;
    collect(document, []).forEach((el) => {
      if (!isFillable(el)) return;
      if (!overwrite && alreadyFilled(el)) return;
      const desc = describe(el);
      let value = null;
      const c = matchCustom(desc, custom);
      if (c) value = c.value;
      else {
        const f = matchBuiltin(desc);
        if (f && profile[f.key]) {
          // a textarea is only for free-text fields, to avoid dumping a summary into e.g. a "location" box
          if (el.tagName === 'TEXTAREA' && !f.multiline && f.key !== 'skills') return;
          value = profile[f.key];
        }
      }
      if (value && apply(el, value)) {
        count++;
        flash(el);
      }
    });
    return count;
  }

  function insertActive(value) {
    let el = document.activeElement;
    while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
    if (!el) return false;
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      setNative(el, value);
      return true;
    }
    if (el.isContentEditable) {
      return document.execCommand('insertText', false, value);
    }
    return false;
  }

  window.__jobAutofill = { fillPage, insertActive };
})();
