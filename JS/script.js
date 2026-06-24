// Elements from your existing setup
const sendBtn = document.getElementById('sendBtn') || document.getElementById('buildBtn');
const promptInput = document.getElementById('promptInput');
const output = document.getElementById('output') || document.getElementById('codeEditor');
const buildBar = document.getElementById('buildBar');
const buildToggle = document.getElementById('buildToggle');
const buildStatusText = document.getElementById('buildStatusText') || document.getElementById('buildStatus');
const fileList = document.getElementById('fileList');
const welcomeScreen = document.getElementById('welcomeScreen');
const exampleChips = document.querySelectorAll('.example-chip');
const previewFrame = document.getElementById('previewFrame');

// State
let userEmail = localStorage.getItem('forge_email');
let byokProvider = localStorage.getItem('forge_byok_provider') || '';
let byokKey = localStorage.getItem('forge_byok_key') || '';
let currentProject = { files: {}, activeFile: null };
let buildInProgress = false;

// Auto-resize textarea
if (promptInput) {
  promptInput.addEventListener('input', () => {
    promptInput.style.height = 'auto';
    promptInput.style.height = promptInput.scrollHeight + 'px';
  });
}

// Example chips
exampleChips?.forEach(chip => {
  chip.addEventListener('click', () => {
    promptInput.value = chip.dataset.prompt || chip.innerText;
    promptInput.dispatchEvent(new Event('input'));
  });
});

// Init
if (!userEmail) {
  setTimeout(() => openSettings(), 500);
} else {
  updateCreditUI();
}
if (welcomeScreen && userEmail) welcomeScreen.style.display = 'none';

// Credits
async function updateCreditUI() {
  if (!userEmail) return;
  try {
    const res = await fetch('/api/check-credits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: userEmail, action: 'check' })
    }).then(r => r.json());
    
    const creditEl = document.getElementById('creditDisplay');
    if (creditEl) {
      const tierColor = res.tier === 'PROMAX'? '#7c3aed' : res.tier === 'PRO'? '#4f46e5' : '#666';
      const creditsText = byokKey? 'BYOK Active' : res.tier === 'PROMAX'? 'Unlimited' : `${res.credits} credits`;
      creditEl.innerHTML = `<span style="color:${tierColor};font-weight:bold">${res.tier}</span> • ${creditsText}${res.inGrace? ' • <span style="color:#f59e0b">Grace</span>' : ''}`;
    }
  } catch (err) {
    const creditEl = document.getElementById('creditDisplay');
    if (creditEl) creditEl.innerText = 'Error';
  }
}

// Start multi-file build
async function startBuild() {
  if (buildInProgress) return;
  if (!userEmail) return openSettings();
  
  const prompt = promptInput.value.trim();
  if (!prompt) return alert('Enter a prompt first');

  buildInProgress = true;
  if (sendBtn) {
    sendBtn.disabled = true;
    sendBtn.innerText = 'Planning...';
  }
  if (welcomeScreen) welcomeScreen.style.display = 'none';
  
  document.getElementById('buildPlan').innerHTML = 'Analyzing your request...';
  if (buildBar) buildBar.style.width = '0%';
  if (buildStatusText) buildStatusText.innerText = 'Planning project structure...';
  if (fileList) fileList.innerHTML = '<div style="color:#666;text-align:center;padding:20px;font-size:12px">Generating files...</div>';
  currentProject = { files: {}, activeFile: null };
  
  try {
    // Step 1: Get plan
    const planRes = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        prompt, 
        email: userEmail, 
        action: 'plan',
        byok: byokKey? { provider: byokProvider, key: byokKey } : null
      })
    });
    
    const planData = await planRes.json();
    
    if (planRes.status === 402 &&!byokKey) {
      document.getElementById('upgradeMessage').innerText = planData.message;
      document.getElementById('upgradeModal').style.display = 'flex';
      throw new Error('Insufficient credits');
    }
    
    if (!planData.files ||!planData.files.length) throw new Error('No plan generated');
    
    // Show plan
    document.getElementById('buildPlan').innerHTML = `
      <div><b>Project:</b> ${planData.projectName || 'Untitled'}</div>
      <div><b>Files:</b> ${planData.files.length}</div>
      <div style="margin-top:8px"><b>Structure:</b></div>
      ${planData.files.map(f => `<div style="margin-left:10px;font-size:11px">• ${f.path}</div>`).join('')}
    `;
    
    // Init file list
    if (fileList) fileList.innerHTML = '';
    planData.files.forEach(f => {
      currentProject.files[f.path] = { path: f.path, content: '', status: 'pending', description: f.description };
      addFileToList(f.path, 'pending');
    });
    
    // Step 2: Generate files one by one
    if (sendBtn) sendBtn.innerText = 'Building...';
    let completed = 0;
    
    for (const file of planData.files) {
      updateFileStatus(file.path, 'building');
      if (buildStatusText) buildStatusText.innerText = `Building ${file.path}...`;
      
      const fileRes = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          prompt, 
          email: userEmail, 
          action: 'file',
          filePath: file.path,
          fileDescription: file.description,
          existingFiles: Object.keys(currentProject.files).filter(p => currentProject.files[p].content),
          byok: byokKey? { provider: byokProvider, key: byokKey } : null
        })
      }).then(r => r.json());
      
      if (fileRes.code) {
        currentProject.files[file.path].content = fileRes.code;
        currentProject.files[file.path].status = 'done';
        updateFileStatus(file.path, 'done');
        if (!currentProject.activeFile) selectFile(file.path);
      } else {
        updateFileStatus(file.path, 'error');
      }
      
      completed++;
      if (buildBar) buildBar.style.width = `${(completed/planData.files.length)*100}%`;
      updatePreview();
    }
    
    if (buildStatusText) buildStatusText.innerText = `Done. ${completed} files generated.`;
    if (!byokKey) updateCreditUI();
    
  } catch (err) {
    if (buildStatusText) buildStatusText.innerText = `Error: ${err.message}`;
  } finally {
    buildInProgress = false;
    if (sendBtn) {
      sendBtn.disabled = false;
      sendBtn.innerText = 'Generate Project';
    }
  }
}

// File UI
function addFileToList(path, status) {
  if (!fileList) return;
  if (fileList.querySelector('[data-empty]')) fileList.innerHTML = '';
  
  const div = document.createElement('div');
  div.className = 'file-item';
  div.dataset.path = path;
  div.onclick = () => selectFile(path);
  div.innerHTML = `
    <span>${path}</span>
    <span class="file-status status-${status}">${status}</span>
  `;
  fileList.appendChild(div);
}

function updateFileStatus(path, status) {
  const item = document.querySelector(`.file-item[data-path="${path}"]`);
  if (item) {
    const statusEl = item.querySelector('.file-status');
    if (statusEl) {
      statusEl.className = `file-status status-${status}`;
      statusEl.innerText = status;
    }
  }
}

function selectFile(path) {
  currentProject.activeFile = path;
  document.querySelectorAll('.file-item').forEach(el => el.classList.remove('active'));
  document.querySelector(`.file-item[data-path="${path}"]`)?.classList.add('active');
  if (output) output.innerText = currentProject.files?.content || '// Empty file';
}

// Preview
function updatePreview() {
  if (!previewFrame) return;
  const htmlFile = currentProject.files['index.html'] || currentProject.files['app.jsx'] || currentProject.files['App.js'];
  
  if (!htmlFile?.content) return;
  
  let html = htmlFile.content;
  
  // If React, wrap it
  if (htmlFile.path.includes('.jsx') || htmlFile.path.includes('App.js')) {
    const cssFile = currentProject.files['index.css'] || currentProject.files['styles.css'] || currentProject.files['App.css'];
    html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script src="https://unpkg.com/react@18/umd/react.development.js"></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>${cssFile?.content || ''}</style>
</head>
<body>
  <div id="root"></div>
  <script type="text/babel">
    ${Object.values(currentProject.files).filter(f => f.path.endsWith('.js') || f.path.endsWith('.jsx')).map(f => f.content).join('\n')}
    const root = ReactDOM.createRoot(document.getElementById('root'));
    root.render(<App />);
  </script>
</body>
</html>`;
  }
  
  previewFrame.srcdoc = html;
}

// Bind button
if (sendBtn) sendBtn.onclick = startBuild;

// Settings
function openSettings() {
  document.getElementById('settingsModal').style.display = 'flex';
  document.getElementById('userEmail').value = userEmail || '';
  document.getElementById('byokProvider').value = byokProvider || '';
  document.getElementById('byokKey').value = byokKey || '';
}
function closeSettings() { document.getElementById('settingsModal').style.display = 'none'; }
function saveEmail() {
  const email = document.getElementById('userEmail').value.trim();
  if (!email ||!email.includes('@')) return alert('Enter a valid email');
  localStorage.setItem('forge_email', email);
  userEmail = email;
  updateCreditUI();
  closeSettings();
  if (welcomeScreen) welcomeScreen.style.display = 'none';
}
function saveBYOK() {
  const provider = document.getElementById('byokProvider').value;
  const key = document.getElementById('byokKey').value.trim();
  if (provider &&!key) return alert('Enter your API key');
  localStorage.setItem('forge_byok_provider', provider);
  localStorage.setItem('forge_byok_key', key);
  byokProvider = provider;
  byokKey = key;
  updateCreditUI();
  alert(provider? 'BYOK saved. Unlimited builds enabled.' : 'BYOK cleared.');
  closeSettings();
}

// Modals
function closeUpgradeModal() { document.getElementById('upgradeModal').style.display = 'none'; }
function continueOnFree() {
  closeUpgradeModal();
  document.getElementById('buildPlan').innerHTML = 'Build cancelled. Add your API key in Settings for unlimited builds.';
}
window.onclick = e => { if (e.target.classList.contains('modal')) e.target.style.display = 'none'; }
