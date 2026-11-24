const $ = (id) => document.getElementById(id);
let data = { profile: {}, custom: [], overwrite: false };
let timer;

async function load() {
  const { jaf } = await chrome.storage.local.get('jaf');
  data = Object.assign(data, jaf || {});
  render();
}

function save() {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    await chrome.storage.local.set({ jaf: data });
    const s = $('status');
    s.textContent = 'Saved';
    s.classList.add('on');
    setTimeout(() => s.classList.remove('on'), 900);
  }, 250);
}

function copy(text, btn) {
  navigator.clipboard.writeText(text || '').then(() => {
    const old = btn.textContent;
    btn.textContent = '✓';
    setTimeout(() => (btn.textContent = old), 700);
  });
}

function el(tag, props, children) {
  const e = Object.assign(document.createElement(tag), props || {});
  (children || []).forEach((c) => e.append(c));
  return e;
}

function renderFields() {
  const root = $('fields');
  root.replaceChildren();
  const groups = [...new Set(JAF_FIELDS.map((f) => f.group))];
  groups.sort((a, b) => (a === 'Choice questions') - (b === 'Choice questions')); // yes/no questions go last
  groups.forEach((g) => {
    root.append(el('h2', { className: 'group-title', textContent: g }));
    const list = el('div', { className: 'group' });
    JAF_FIELDS.filter((f) => f.group === g).forEach((f) => {
      if (f.options) {
        const sel = el('select', {}, [el('option', { value: '', textContent: 'Not set' })]);
        f.options.forEach((o) => sel.append(el('option', { value: o, textContent: o })));
        sel.value = data.profile[f.key] || '';
        sel.addEventListener('change', () => {
          data.profile[f.key] = sel.value;
          save();
        });
        list.append(el('div', { className: 'row' }, [el('label', { textContent: f.label }), sel]));
        return;
      }
      const input = el(f.multiline ? 'textarea' : 'input', { value: data.profile[f.key] || '', placeholder: f.multiline ? 'Write a short intro…' : 'Not set' });
      if (!f.multiline) input.type = 'text';
      input.addEventListener('input', () => {
        data.profile[f.key] = input.value;
        save();
      });
      const cp = el('button', { className: 'copy', textContent: '⧉', title: 'Copy' });
      cp.addEventListener('click', () => copy(data.profile[f.key], cp));
      list.append(el('div', { className: 'row' + (f.multiline ? ' tall' : '') }, [el('label', { textContent: f.label }), input, cp]));
    });
    root.append(list);
  });
}

function renderCustom() {
  const root = $('custom');
  root.replaceChildren();
  data.custom.forEach((c, i) => {
    const mk = (key, ph, tag) => {
      const inp = el(tag || 'input', { value: c[key] || '', placeholder: ph });
      if (!tag) inp.type = 'text';
      inp.addEventListener('input', () => {
        c[key] = inp.value;
        save();
      });
      return inp;
    };
    const cp = el('button', { textContent: 'Copy' });
    cp.addEventListener('click', () => copy(c.value, cp));
    const del = el('button', { textContent: 'Delete', className: 'del' });
    del.addEventListener('click', () => {
      data.custom.splice(i, 1);
      renderCustom();
      save();
    });
    root.append(el('div', { className: 'group card' }, [
      el('div', { className: 'card-head' }, [cp, del]),
      el('div', { className: 'row' }, [el('label', { textContent: 'Title' }), mk('label', 'Why this company?')]),
      el('div', { className: 'row' }, [el('label', { textContent: 'Keywords' }), mk('keywords', 'why us, why join')]),
      el('div', { className: 'row tall' }, [el('label', { textContent: 'Answer' }), mk('value', 'Your reusable answer', 'textarea')])
    ]));
  });
}

document.querySelectorAll('.seg').forEach((b) =>
  b.addEventListener('click', () => {
    document.querySelectorAll('.seg').forEach((x) => {
      const on = x === b;
      x.classList.toggle('active', on);
      x.setAttribute('aria-selected', on);
      $('tab-' + x.dataset.tab).hidden = !on;
    });
  })
);

function render() {
  $('overwrite').checked = !!data.overwrite;
  renderFields();
  renderCustom();
}

$('overwrite').addEventListener('change', (e) => {
  data.overwrite = e.target.checked;
  save();
});

$('addCustom').addEventListener('click', () => {
  data.custom.push({ label: '', keywords: '', value: '' });
  renderCustom();
  save();
});

$('fill').addEventListener('click', async () => {
  const msg = $('fillMsg');
  msg.textContent = 'Filling…';
  await chrome.storage.local.set({ jaf: data }); // make sure latest edits are used
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return (msg.textContent = 'No active tab.');
  chrome.runtime.sendMessage({ type: 'fill', tabId: tab.id }, (res) => {
    if (chrome.runtime.lastError || !res) return (msg.textContent = 'Could not reach the page.');
    msg.textContent = res.ok
      ? res.count + ' field(s) filled. Review before submitting.'
      : 'Cannot run on this page (' + res.error + ').';
  });
});

$('export').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = el('a', { href: url, download: 'job-autofill-backup.json' });
  a.click();
  URL.revokeObjectURL(url);
});

$('import').addEventListener('click', () => $('importFile').click());
$('importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    data = { profile: parsed.profile || {}, custom: parsed.custom || [], overwrite: !!parsed.overwrite };
    await chrome.storage.local.set({ jaf: data });
    render();
    $('fillMsg').textContent = 'Imported.';
  } catch (err) {
    $('fillMsg').textContent = 'Invalid JSON file.';
  }
});

load();
