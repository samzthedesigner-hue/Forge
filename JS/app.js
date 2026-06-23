const API_URL = '/api/generate';
const FREE_LIMIT = 25;

let editor, currentFiles = {}, openTabs = [], activeTab = null, projects = [], currentPrompt = '';

require.config({ paths: { vs: 'https://unpkg.com/monaco-editor@0.45.0/min/vs' }});
require(['vs/editor/editor.main'], () => {
  editor = monaco.editor.create(document.getElementById('editor'), {
    value: '// Generate code to start', language: 'javascript', theme: 'vs-dark', automaticLayout: true
  });
  loadProjects();
  updateFreeCount();
});

const $ = id => document.getElementById(id);
const promptInput = $('promptInput'), langSelect = $('langSelect');
const generateBtn = $('generateBtn'), askBtn = $('askBtn'), runBtn = $('runBtn'), buildBtn = $('buildBtn');
const zipBtn = $('zipBtn'), pushBtn = $('pushBtn'), settingsBtn = $('settingsBtn');
const projectsBtn = $('projectsBtn'), statusEl = $('status'), logStream = $('log-stream');
const buildLog = $('build-log'), scrollToLatest = $('scrollToLatest');

function loadProjects() {
  projects = JSON.parse(localStorage.getItem('forge_projects') || '[]');
}

function saveProject(prompt, files) {
  const name = prompt.slice(0, 40) + (prompt.length > 40? '...' : '');
  projects.unshift({ name, prompt, files, date: Date.now() });
  if (projects.length > 10) projects.pop();
  localStorage.setItem('forge_projects', JSON.stringify(projects));
}

async function updateFreeCount() {
  const userKey = localStorage.getItem('user_groq_key');
  if (userKey) {
    statusEl.textContent = 'BYOK Mode';
    statusEl.style.color = 'var(--accent)';
    return;
  }
  const res = await fetch(API_URL, { method: 'OPTIONS' });
  const remaining = res.headers.get('X-Free-Remaining');
  $('freeCount').textContent = `${remaining} generations left this month`;
  statusEl.textContent = `Free: ${remaining} left`;
}

// Auto-build with streaming logs
generateBtn.onclick = async () => {
  const prompt = promptInput.value.trim();
  if (!prompt) return;
  currentPrompt = prompt;

  showBuildLog();
  addLog('Planning', `Analyzing: ${prompt}`, 'building');
  generateBtn.disabled = true;
  askBtn.disabled = false;

  try {
    const userKey = localStorage.getItem('user_groq_key');
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-User-Key': userKey || '' },
      body: JSON.stringify({ prompt, lang: langSelect.value })
    });

    if (res.status === 429) {
      hideBuildLog();
      $('upsell-modal').classList.remove('hidden');
      generateBtn.disabled = false;
      askBtn.disabled = true;
      return;
    }

    const data = await res.json();
    addLog('Plan', data.plan, 'success', true);

    // Auto-start building files - no approve button
    await buildFilesStream(data.files);
    saveProject(prompt, data.files);
    updateFreeCount();

  } catch (e) {
    addLog('Error', e.message, 'error', true);
    setTimeout(() => { hideBuildLog(); generateBtn.disabled = false; askBtn.disabled = true; }, 2000);
  }
};

// Stream files one by one with collapsible entries
async function buildFilesStream(files) {
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const logId = addLog(`Building ${f.path}`, `Writing ${f.content.length} chars...`, 'building');
    await new Promise(r => setTimeout(r, 400 + Math.random() * 300));
    currentFiles[f.path] = f.content;
    updateLog(logId, `Built ${f.path}`, `✓ ${f.content.split('\n').length} lines`, 'success');
    autoScroll();
  }
  addLog('Complete', `Built ${files.length} files successfully`, 'success', true);
  renderFileTree();
  openFile(files[0].path);
  [runBtn][buildBtn][zipBtn][pushBtn].forEach(b => b.disabled = false);
  generateBtn.disabled = false;
  $('build-status-text').textContent = 'Build complete';
  setTimeout(() => { hideBuildLog(); }, 2000);
}

// Log system with collapse + auto-scroll
let logCounter = 0;
function addLog(title, body, type = '', expanded = false) {
  const id = `log-${logCounter++}`;
  const entry = document.createElement('div');
  entry.className = `log-entry ${type} ${expanded? 'expanded' : ''}`;
  entry.id = id;
  entry.innerHTML = `
    <div class="log-head" onclick="toggleLog('${id}')">
      <span class="arrow">▶</span>
      <span>${title}</span>
    </div>
    <div class="log-body">${body}</div>
  `;
  logStream.appendChild(entry);
  autoScroll();
  return id;
}

window.toggleLog = (id) => {
  $(id).classList.toggle('expanded');
};

function updateLog(id, title, body, type) {
  const el = $(id);
  if (!el) return;
  el.className = `log-entry ${type}`;
  el.querySelector('.log-head span:last-child').textContent = title;
  el.querySelector('.log-body').textContent = body;
}

function autoScroll() {
  const isAtBottom = logStream.scrollHeight - logStream.scrollTop <= logStream.clientHeight + 50;
  if (isAtBottom) {
    logStream.scrollTop = logStream.scrollHeight;
    scrollToLatest.classList.add('hidden');
  } else {
    scrollToLatest.classList.remove('hidden');
  }
}

scrollToLatest.onclick = () => {
  logStream.scrollTop = logStream.scrollHeight;
  scrollToLatest.classList.add('hidden');
};

logStream.addEventListener('scroll', autoScroll);

function showBuildLog() {
  buildLog.classList.remove('hidden');
  logStream.innerHTML = '';
  $('build-status-text').textContent = 'Forge is building...';
}

function hideBuildLog() {
  buildLog.classList.add('hidden');
}

// Ask Forge mid-build
askBtn.onclick = () => {
  $('ask-modal').classList.remove('hidden');
  $('askResponse').textContent = '';
  $('askInput').value = '';
};

$('sendAsk').onclick = async () => {
  const question = $('askInput').value.trim();
  if (!question) return;
  $('askResponse').textContent = 'Forge is thinking...';
  const userKey = localStorage.getItem('user_groq_key');
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-User-Key': userKey || '' },
    body: JSON.stringify({ ask: `Context: Building "${currentPrompt}". Question: ${question}` })
  });
  const data = await res.json();
  $('askResponse').textContent = data.answer;
};
$('closeAsk').onclick = () => $('ask-modal').classList.add('hidden');

// File tree + tabs
function renderFileTree() {
  $('fileList').innerHTML = Object.keys(currentFiles).map(p =>
    `<div class="file-item ${p===activeTab?'active':''}" onclick="openFile('${p}')">${p}</div>`
  ).join('');
}
window.openFile = (path) => {
  activeTab = path;
  if (!openTabs.includes(path)) openTabs.push(path);
  renderTabs();
  editor.setValue(currentFiles);
  monaco.editor.setModelLanguage(editor.getModel(), getLang(path));
  renderFileTree();
};
function renderTabs() {
  $('tabs').innerHTML = openTabs.map(p =>
    `<div class="tab ${p===activeTab?'active':''}" onclick="openFile('${p}')">${p.split('/').pop()}</div>`
  ).join('');
}
function getLang(p) {
  if (p.endsWith('.jsx')||p.endsWith('.js')) return 'javascript';
  if (p.endsWith('.css')) return 'css';
  if (p.endsWith('.html')) return 'html';
  if (p.endsWith('.py')) return 'python';
  if (p.endsWith('.json')) return 'json';
  return 'plaintext';
}

// Run preview
runBtn.onclick = () => {
  const html = currentFiles['index.html'] || currentFiles[Object.keys(currentFiles).find(f=>f.endsWith('.html'))];
  if (!html) return alert('No HTML file to preview');
  $('preview').srcdoc = html;
  $('preview-panel').classList.remove('hidden');
};
$('closePreview').onclick = () => $('preview-panel').classList.add('hidden');

// Projects
projectsBtn.onclick = () => {
  $('projectsList').innerHTML = projects.map((p,i) =>
    `<div class="project-item" onclick="loadProject(${i})">
      <div class="project-item-name">${p.name}</div>
      <div class="project-item-date">${new Date(p.date).toLocaleString()}</div>
    </div>`
  ).join('') || '<p style="color:#8b949e">No projects yet</p>';
  $('projects-modal').classList.remove('hidden');
};
window.loadProject = (i) => {
  currentFiles = projects[i].files;
  currentPrompt = projects[i].prompt;
  renderFileTree();
  openFile(Object.keys(currentFiles)[0]);
  [runBtn][buildBtn][zipBtn][pushBtn][askBtn].forEach(b => b.disabled = false);
  $('projects-modal').classList.add('hidden');
};
$('closeProjects').onclick = () => $('projects-modal').classList.add('hidden');

// Settings BYOK
settingsBtn.onclick = () => {
  $('userKeyInput').value = localStorage.getItem('user_groq_key') || '';
  updateFreeCount();
  $('settings-modal').classList.remove('hidden');
};
$('saveSettings').onclick = () => {
  const key = $('userKeyInput').value.trim();
  if (key) localStorage.setItem('user_groq_key', key);
  else localStorage.removeItem('user_groq_key');
  $('settings-modal').classList.add('hidden');
  updateFreeCount();
};
$('closeSettings').onclick = () => $('settings-modal').classList.add('hidden');

// Upsell
$('useBYOK').onclick = () => {
  $('upsell-modal').classList.add('hidden');
  settingsBtn.click();
};
$('closeUpsell').onclick = () => $('upsell-modal').classList.add('hidden');

// Zip
zipBtn.onclick = async () => {
  const { default: JSZip } = await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm');
  const zip = new JSZip();
  Object.entries(currentFiles).forEach(([p,c]) => zip.file(p,c));
  const blob = await zip.generateAsync({type:'blob'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'forge-project.zip'; a.click();
};

// GitHub push placeholder
pushBtn.onclick = () => alert('GitHub push: Connect OAuth in production. For now, use Download ZIP + upload to GitHub.');
