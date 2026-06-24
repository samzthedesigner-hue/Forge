const sendBtn = document.getElementById('sendBtn');
const promptInput = document.getElementById('promptInput');
const output = document.getElementById('output');
const buildBar = document.getElementById('buildBar');
const buildStatusText = document.getElementById('buildStatusText');
const fileList = document.getElementById('fileList');
const welcomeScreen = document.getElementById('welcomeScreen');
const previewFrame = document.getElementById('previewFrame');
const settingsBtn = document.getElementById('settingsBtn');
const welcomeBtn = document.getElementById('welcomeBtn');
const saveEmailBtn = document.getElementById('saveEmailBtn');
const saveBYOKBtn = document.getElementById('saveBYOKBtn');
const closeSettingsBtn = document.getElementById('closeSettingsBtn');
const continueFreeBtn = document.getElementById('continueFreeBtn');
const upgradeSettingsBtn = document.getElementById('upgradeSettingsBtn');

let userEmail = localStorage.getItem('forge_email');
let byokProvider = localStorage.getItem('forge_byok_provider') || '';
let byokKey = localStorage.getItem('forge_byok_key') || '';
let currentProject = { files: {}, activeFile: null };
let buildInProgress = false;
let abortController = null;

promptInput.addEventListener('input', () => {
  promptInput.style.height = 'auto';
  promptInput.style.height = promptInput.scrollHeight + 'px';
});

if (userEmail) {
  welcomeScreen.style.display = 'none';
  updateCreditUI();
}

async function updateCreditUI() {
  const creditEl = document.getElementById('creditDisplay');
  if (!userEmail) return creditEl.innerText = 'No email set';
  try {
    const res = await fetch('/api/check-credits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: userEmail, action: 'check' })
    });
    const data = await res.json();
    const tierColor = data.tier === 'PROMAX'? '#7c3aed' : data.tier === 'PRO'? '#4f46e5' : '#666';
    const creditsText = byokKey? 'BYOK' : data.tier === 'PROMAX'? 'Unlimited' : `${data.credits}`;
    creditEl.innerHTML = `<span style="color:${tierColor};font-weight:bold">${data.tier}</span> • ${creditsText}${data.inGrace? ' • Grace' : ''}`;
  } catch (err) {
    creditEl.innerText = 'Error';
  }
}

async function startBuild() {
  if (buildInProgress) return;
  if (!userEmail) return openSettings();
  
  const prompt = promptInput.value.trim();
  if (!prompt) return alert('Enter a prompt first');

  buildInProgress = true;
  abortController = new AbortController();
  sendBtn.disabled = true;
  sendBtn.innerText = 'Starting...';
  welcomeScreen.style.display = 'none';
  
  const planBox = document.getElementById('buildPlan');
  planBox.innerHTML = 'Planning...';
  buildBar.style.width = '5%';
  buildStatusText.innerText = 'Starting...';
  fileList.innerHTML = '<div class="text-gray-600 text-center py-4">Planning...</div>';
  currentProject = { files: {}, activeFile: null };
  
  try {
    sendBtn.innerText = 'Planning...';
    
    const planRes = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        prompt, email: userEmail, action: 'plan',
        byok: byokKey? { provider: byokProvider, key: byokKey } : null
      }),
      signal: abortController.signal
    });
    
    if (!planRes.ok) {
      const errData = await planRes.json();
      if (planRes.status === 402) {
        document.getElementById('upgradeMessage').innerText = errData.message;
        document.getElementById('upgradeModal').style.display = 'flex';
      }
      throw new Error(errData.error || `API ${planRes.status}`);
    }
    
    const planData = await planRes.json();
    if (!planData.files?.length) throw new Error('No plan generated');
    
    planBox.innerHTML = `<div><b>Project:</b> ${planData.projectName || 'Untitled'}</div><div><b>Files:</b> ${planData.files.length}</div>`;
    
    fileList.innerHTML = '';
    planData.files.forEach(f => {
      currentProject.files[f.path] = { path: f.path, content: '', status: 'pending', description: f.description };
      addFileToList(f.path, 'pending');
    });
    
    sendBtn.innerText = `Building ${planData.files.length} files...`;
    buildStatusText.innerText = `Generating ${planData.files.length} files...`;
    buildBar.style.width = '20%';
    
    let completed = 0;
    const startTime = Date.now();
    
    // Parallel streaming generation
    const filePromises = planData.files.map(async (file) => {
      updateFileStatus(file.path, 'building');
      
      const fileRes = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          prompt, email: userEmail, action: 'file',
          filePath: file.path, fileDescription: file.description,
          existingFiles: planData.files.map(f => f.path),
          byok: byokKey? { provider: byokProvider, key: byokKey } : null
        }),
        signal: abortController.signal
      });
      
      if (!fileRes.ok) throw new Error(`${file.path} failed`);
      
      // Stream the code
      const reader = fileRes.body.getReader();
      const decoder = new TextDecoder();
      let code = '';
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        code += decoder.decode(value);
        currentProject.files[file.path].content = code;
        if (currentProject.activeFile === file.path) output.innerText = code;
        updatePreview();
      }
      
      // Clean markdown fences
      code = code.replace(/```[\w]*\n/g, '').replace(/```$/g, '').trim();
      currentProject.files[file.path].content = code;
      currentProject.files[file.path].status = 'done';
      updateFileStatus(file.path, 'done');
      if (!currentProject.activeFile) selectFile(file.path);
      
      completed++;
      buildBar.style.width = `${20 + (completed/planData.files.length)*80}%`;
      buildStatusText.innerText = `Generated ${completed}/${planData.files.length}`;
    });
    
    await Promise.all(filePromises);
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    buildBar.style.width = '100%';
    buildStatusText.innerText = `Done in ${elapsed}s`;
    updatePreview();
    if (!byokKey) updateCreditUI();
    
  } catch (err) {
    if (err.name === 'AbortError') {
      buildStatusText.innerText = 'Cancelled';
    } else {
      buildStatusText.innerText = `Error`;
      planBox.innerHTML = `<span style="color:#ef4444">Error: ${err.message}</span>`;
    }
    console.error(err);
  } finally {
    buildInProgress = false;
    abortController = null;
    sendBtn.disabled = false;
    sendBtn.innerText = 'Generate Project';
  }
}

function addFileToList(path, status) {
  const div = document.createElement('div');
  div.className = 'file-item';
  div.dataset.path = path;
  div.onclick = () => selectFile(path);
  div.innerHTML = `<span>${path}</span><span class="file-status status-${status}">${status}</span>`;
  fileList.appendChild(div);
}

function updateFileStatus(path, status) {
  const item = document.querySelector(`.file-item[data-path="${path}"]`);
  if (item) {
    const statusEl = item.querySelector('.file-status');
    statusEl.className = `file-status status-${status}`;
    statusEl.innerText = status;
  }
}

function selectFile(path) {
  currentProject.activeFile = path;
  document.querySelectorAll('.file-item').forEach(el => el.classList.remove('active'));
  document.querySelector(`.file-item[data-path="${path}"]`)?.classList.add('active');
  output.innerText = currentProject.files?.content || '// Empty file';
}

function updatePreview() {
  const htmlFile = currentProject.files['index.html'] || currentProject.files['app.jsx'] || currentProject.files['App.js'];
  if (!htmlFile?.content) return;
  
  let html = htmlFile.content;
  
  if (htmlFile.path.includes('.jsx') || htmlFile.path.includes('App.js')) {
    const cssFile = currentProject.files['index.css'] || currentProject.files['styles.css'] || currentProject.files['App.css'];
    const jsFiles = Object.values(currentProject.files).filter(f => f.path.endsWith('.js') || f.path.endsWith('.jsx')).map(f => f.content).join('\n');
    html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><script src="https://unpkg.com/react@18/umd/react.development.js"></script><script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script><script src="https://unpkg.com/@babel/standalone/babel.min.js"></script><script src="https://cdn.tailwindcss.com"></script><style>${cssFile?.content || ''}</style></head><body><div id="root"></div><script type="text/babel">${jsFiles}const root = ReactDOM.createRoot(document.getElementById('root'));root.render(<App />);</script></body></html>`;
  } else if (!html.includes('<!DOCTYPE')) {
    const cssFile = currentProject.files['style.css'] || currentProject.files['styles.css'];
    const jsFile = currentProject.files['script.js'];
    html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><script src="https://cdn.tailwindcss.com"></script><style>${cssFile?.content || ''}</style></head><body>${html}<script>${jsFile?.content || ''}</script></body></html>`;
  }
  
  previewFrame.srcdoc = html;
}

sendBtn.onclick = startBuild;
settingsBtn.onclick = openSettings;
welcomeBtn.onclick = openSettings;
saveEmailBtn.onclick = saveEmail;
saveBYOKBtn.onclick = saveBYOK;
closeSettingsBtn.onclick = closeSettings;
continueFreeBtn.onclick = continueOnFree;
upgradeSettingsBtn.onclick = () => {
  closeUpgradeModal();
  openSettings();
};

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
  welcomeScreen.style.display = 'none';
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

function closeUpgradeModal() { document.getElementById('upgradeModal').style.display = 'none'; }
function continueOnFree() {
  closeUpgradeModal();
  document.getElementById('buildPlan').innerHTML = 'Build cancelled. Add your API key in Settings for unlimited builds.';
  if (abortController) abortController.abort();
}
window.onclick = e => { if (e.target.classList.contains('modal')) e.target.style.display = 'none'; }
