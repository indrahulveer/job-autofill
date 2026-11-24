importScripts('fields.js');

const DEFAULTS = { profile: {}, custom: [], overwrite: false };

async function getData() {
  const { jaf } = await chrome.storage.local.get('jaf');
  return Object.assign({}, DEFAULTS, jaf || {});
}

async function runFill(tabId) {
  const data = await getData();
  await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['fields.js', 'content.js'] });
  const out = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: (d) => window.__jobAutofill.fillPage(d),
    args: [data]
  });
  const n = out.reduce((sum, r) => sum + (r.result || 0), 0);
  chrome.action.setBadgeBackgroundColor({ tabId, color: '#34a853' });
  chrome.action.setBadgeText({ tabId, text: String(n) });
  setTimeout(() => chrome.action.setBadgeText({ tabId, text: '' }), 4000);
  return n;
}

async function insertValue(tabId, frameId, value) {
  const target = { tabId, frameIds: [frameId || 0] };
  await chrome.scripting.executeScript({ target, files: ['fields.js', 'content.js'] });
  await chrome.scripting.executeScript({
    target,
    func: (v) => window.__jobAutofill.insertActive(v),
    args: [value]
  });
}

const preview = (s) => (s.length > 32 ? s.slice(0, 32) + '…' : s).replace(/\s+/g, ' ');

async function buildMenus() {
  await chrome.contextMenus.removeAll();
  const data = await getData();
  chrome.contextMenus.create({ id: 'jaf-fill', title: 'Job Autofill: fill this page', contexts: ['page', 'editable'] });
  chrome.contextMenus.create({ id: 'jaf-root', title: 'Job Autofill: insert saved value', contexts: ['editable'] });
  JAF_FIELDS.forEach((f) => {
    const v = data.profile[f.key];
    if (v) chrome.contextMenus.create({ id: 'f:' + f.key, parentId: 'jaf-root', title: `${f.label}: ${preview(v)}`, contexts: ['editable'] });
  });
  data.custom.forEach((c, i) => {
    if (c.value) chrome.contextMenus.create({ id: 'c:' + i, parentId: 'jaf-root', title: `${c.label || 'Custom'}: ${preview(c.value)}`, contexts: ['editable'] });
  });
}

chrome.runtime.onInstalled.addListener(buildMenus);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.jaf) buildMenus();
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab) return;
  if (info.menuItemId === 'jaf-fill') return void runFill(tab.id);
  const data = await getData();
  const id = String(info.menuItemId);
  let value = null;
  if (id.startsWith('f:')) value = data.profile[id.slice(2)];
  if (id.startsWith('c:')) value = (data.custom[Number(id.slice(2))] || {}).value;
  if (value) insertValue(tab.id, info.frameId, value);
});

chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd !== 'fill-page') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) runFill(tab.id);
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'fill') {
    runFill(msg.tabId)
      .then((n) => sendResponse({ ok: true, count: n }))
      .catch((e) => sendResponse({ ok: false, error: String(e && e.message || e) }));
    return true; // async response
  }
});
