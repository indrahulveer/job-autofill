// Injected on demand (activeTab) into the page and its frames.
(function () {
  if (window.__jobAutofill) return;

  const SKIP_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'file', 'password', 'checkbox', 'radio', 'image', 'color', 'range', 'date']);

  const norm = (s) =>
    (s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
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

  function excluded(f, desc) {
    if (f.notAc && f.notAc.some((a) => desc.ac.includes(a))) return true;
    if (!f.not) return false;
    const all = desc.primary.concat(desc.secondary);
    return f.not.some((p) => { const re = new RegExp(p, 'i'); return all.some((t) => re.test(t)); });
  }

  function matchBuiltin(desc) {
    for (const f of JAF_FIELDS) {
      if (excluded(f, desc)) continue;
      if (f.ac && f.ac.some((a) => desc.ac.includes(a))) return f;
      if (f.exact && desc.primary.some((t) => f.exact.some((e) => t === norm(e)))) return f;
      if (f.aliases.some((a) => desc.primary.some((t) => phraseHit(t, a)))) return f;
    }
    for (const f of JAF_FIELDS) {
      if (excluded(f, desc)) continue;
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
          // choice questions are only answered by dropdowns / radios / buttons, never typed into a text box
          if (f.options && el.tagName !== 'SELECT') return;
          value = profile[f.key];
        }
      }
      if (value && apply(el, value)) {
        count++;
        flash(el);
      }
    });
    count += fillChoices(profile, overwrite);
    return count;
  }

  // ---------- radio buttons, role=radio and Yes/No / Male/Female button pairs ----------
  const txt = (e) => (e.innerText || e.textContent || '');

  function optionLabel(el) {
    if (el.tagName === 'INPUT') {
      const parts = [];
      if (el.labels) el.labels.forEach((l) => parts.push(txt(l)));
      if (!parts.join('').trim()) parts.push(el.getAttribute('aria-label') || '');
      if (!parts.join('').trim() && el.closest('label')) parts.push(txt(el.closest('label')));
      if (!parts.join('').trim() && el.nextSibling) parts.push(el.nextSibling.textContent || '');
      if (!parts.join('').trim() && el.nextElementSibling) parts.push(txt(el.nextElementSibling));
      if (!parts.join('').trim()) parts.push(el.value || '');
      return norm(parts.join(' '));
    }
    return norm(el.getAttribute('aria-label') || txt(el));
  }

  function isChosen(el) {
    return el.checked === true || el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-pressed') === 'true';
  }

  // Finds the question text for a group of options: legend / aria label, else the nearest ancestor
  // that carries extra text but does not contain any other group's options.
  function questionFor(opts, allOpts) {
    const first = opts[0];
    const fs = first.closest('fieldset');
    if (fs && fs.querySelector('legend')) return norm(txt(fs.querySelector('legend')));
    const rg = first.closest('[role="radiogroup"], [role="group"]');
    if (rg) {
      const own = rg.getAttribute('aria-label');
      const lb = rg.getAttribute('aria-labelledby');
      const byId = lb ? lb.split(/\s+/).map((id) => { const n = document.getElementById(id); return n ? txt(n) : ''; }).join(' ') : '';
      if ((own || byId).trim()) return norm((own || '') + ' ' + byId);
    }
    const mine = new Set(opts);
    let p = first.parentElement, best = '';
    for (let i = 0; i < 7 && p; i++, p = p.parentElement) {
      if (allOpts.some((o) => !mine.has(o) && p.contains(o))) break;       // reached a neighbouring question
      let t = txt(p);
      opts.forEach((o) => { t = t.replace(txt(o), ' '); });
      t = norm(t);
      if (t.length >= 8) { best = t; break; }
    }
    return best.slice(0, 1500);
  }

  function pickOption(opts, value) {
    const v = norm(value);
    if (!v) return null;
    const labels = opts.map(optionLabel);
    let i = labels.findIndex((l) => l === v);
    if (i < 0) i = labels.findIndex((l) => l.startsWith(v + ' '));
    if (i < 0) i = labels.findIndex((l) => l.length <= 40 && new RegExp('(^|\\s)' + esc(v) + '(\\s|$)').test(l));
    return i < 0 ? null : opts[i];
  }

  function matchChoice(question) {
    for (const f of JAF_FIELDS) {
      if (!f.options) continue;
      if (f.aliases.some((a) => phraseHit(question, a))) return f;
    }
    return null;
  }

  function fillChoices(profile, overwrite) {
    const groups = [];
    const used = new Set();

    // 1) native radio buttons, grouped by name + form
    const radios = new Map();
    collect(document, []).forEach((el) => {
      if (el.tagName !== 'INPUT' || (el.type || '').toLowerCase() !== 'radio' || el.disabled) return;
      const k = (el.name || 'noname-' + groups.length) + '|' + (el.form ? Array.prototype.indexOf.call(document.forms, el.form) : -1);
      if (!radios.has(k)) radios.set(k, []);
      radios.get(k).push(el);
    });
    radios.forEach((g) => groups.push(g));

    // 2) ARIA radios (custom components)
    const aria = new Map();
    document.querySelectorAll('[role="radio"]').forEach((el) => {
      if (el.getAttribute('aria-disabled') === 'true') return;
      const host = el.closest('[role="radiogroup"]') || el.parentElement;
      if (!aria.has(host)) aria.set(host, []);
      aria.get(host).push(el);
    });
    aria.forEach((g) => groups.push(g));

    // 3) plain buttons used as a pair/short list of answers: group siblings with short text
    const btns = new Map();
    document.querySelectorAll('button, [role="button"]').forEach((el) => {
      if (el.disabled || el.getAttribute('role') === 'radio' || (el.type || '') === 'submit') return;
      const t = optionLabel(el);
      if (!t || t.length > 25 || el.getClientRects().length === 0) return;
      const host = el.parentElement;
      if (!host) return;
      if (!btns.has(host)) btns.set(host, []);
      btns.get(host).push(el);
    });
    btns.forEach((g) => { if (g.length >= 2 && g.length <= 6) groups.push(g); });

    const allOpts = groups.flat();
    let n = 0;
    groups.forEach((opts) => {
      if (opts.some((o) => used.has(o))) return;
      const f = matchChoice(questionFor(opts, allOpts));
      if (!f || !profile[f.key]) return;
      if (!overwrite && opts.some(isChosen)) return;
      const target = pickOption(opts, profile[f.key]);
      if (!target) return;
      opts.forEach((o) => used.add(o));
      target.click();
      flash(target.tagName === 'INPUT' && target.labels && target.labels[0] ? target.labels[0] : target);
      n++;
    });
    return n;
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
