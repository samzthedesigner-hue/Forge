// Pro + BYOK key handling
function getKeys() {
  return {
    groq: localStorage.getItem('forge_groq_key') || '',
    openai: localStorage.getItem('forge_openai_key') || '',
    openrouter: localStorage.getItem('forge_openrouter_key') || ''
  };
}

function getUserEmail() {
  return localStorage.getItem('forge_user_email') || '';
}

function saveKeys(keys) {
  if (keys.groq) localStorage.setItem('forge_groq_key', keys.groq);
  if (keys.openai) localStorage.setItem('forge_openai_key', keys.openai);
  if (keys.openrouter) localStorage.setItem('forge_openrouter_key', keys.openrouter);
}

function saveUserEmail(email) {
  if (email) localStorage.setItem('forge_user_email', email);
}

// Elements from your existing UI
const sendBtn = document.getElementById('sendBtn');
const promptInput = document.getElementById('promptInput') || document.getElementById('prompt');
const output = document.getElementById('output');
const buildBar = document.getElementById('buildBar');
const buildToggle = document.getElementById('buildToggle');
const buildStatusText = document.getElementById('buildStatusText');
const fileList = document.getElementById('fileList');
const welcomeScreen = document.getElementById('welcomeScreen');
const exampleChips = document.querySelectorAll('.chip');
const freeCounter = document.getElementById('freeCounter');

// Auto-resize textarea
if (promptInput) {
  promptInput.addEventListener('input', () => {
    promptInput.style.height = 'auto';
    promptInput.style.height = promptInput.scrollHeight + 'px';
  });
}

// Check remaining credits/free uses
async function checkFreeRemaining() {
  try {
    const res = await fetch('/api/generate', {
      method: 'OPTIONS',
      headers: {
        'X-Groq-Key': getKeys().groq,
        'X-OpenAI-Key': getKeys().openai,
        'X-OpenRouter-Key': getKeys().openrouter,
        'X-User-Email': getUserEmail()
      }
    });
    const remaining = res.headers.get('X-Free-Remaining');
    const credits = res.headers.get('X-Credits-Remaining');
    
    if (credits !== null) {
      if (freeCounter) freeCounter.textContent = `Pro: ${credits} credits`;
    } else if (remaining !== null) {
      if (freeCounter) freeCounter.textContent = `Free: ${remaining} left`;
    }
  } catch (e) {}
}

// Settings modal
function openSettings() {
  const modal = document.getElementById('settingsModal');
  if (!modal) return;
  
  const keys = getKeys();
  document.getElementById('groqKey').value = keys.groq;
  document.getElementById('openaiKey').value = keys.openai;
  document.getElementById('openrouterKey').value = keys.openrouter;
  document.getElementById('userEmail').value = getUserEmail();
  modal.style.display = 'flex';
}

window.openSettings = openSettings;

// Main generate
if (sendBtn) {
  sendBtn.onclick = async () => {
    const prompt = promptInput.value;
    const lang = document.getElementById('lang')?.value || 'react';
    const keys = getKeys();

    if (!prompt) return alert('Enter a prompt');

    if (welcomeScreen) welcomeScreen.style.display = 'none';
    if (output) output.textContent = 'Generating...';
    if (buildStatusText) buildStatusText.textContent = 'Building...';
    if (buildBar) buildBar.style.display = 'block';
    sendBtn.disabled = true;

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Groq-Key': keys.groq,
          'X-OpenAI-Key': keys.openai,
          'X-OpenRouter-Key': keys.openrouter,
          'X-User-Email': getUserEmail()
        },
        body: JSON.stringify({ prompt, lang, taskType: 'code' })
      });

      const data = await res.json();

      if (res.status === 429) {
        if (data.upsell === 'promax') {
          if (output) output.innerHTML = `<div style="color:#f44">Out of Pro credits. <a href="https://buy.stripe.com/REPLACE_PROMAX_LINK" target="_blank" style="color:#7c3aed">Upgrade to Pro Max</a> for unlimited.</div>`;
        } else if (data.upsell === 'pro') {
          if (output) output.innerHTML = `<div style="color:#f44">Free limit reached. <a href="#" onclick="openSettings()" style="color:#4f46e5">Add your API key</a> or <a href="https://buy.stripe.com/REPLACE_PRO_LINK" target="_blank" style="color:#4f46e5">Upgrade to Pro $5/mo</a>.</div>`;
        }
        return;
      }

      if (!res.ok) throw new Error(data.error || 'Generation failed');

      if (output) output.innerHTML = `<b>Plan:</b><br>${data.plan}<br><br><b>Files:</b><br>`;
      
      if (fileList) {
        fileList.innerHTML = '';
        data.files.forEach(f => {
          const div = document.createElement('div');
          div.innerHTML = `<b>${f.path}</b><pre style="background:#0a0a0a;padding:10px;border-radius:4px;overflow-x:auto;margin:10px 0">${f.content.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</pre>`;
          fileList.appendChild(div);
        });
      }

      if (buildStatusText) buildStatusText.textContent = `Done via ${data.provider}`;
      
      // Update credits display
      if (data.creditsLeft !== null && data.creditsLeft !== undefined) {
        if (freeCounter) freeCounter.textContent = `Pro: ${data.creditsLeft} credits`;
        if (data.creditsLeft < 20 && data.creditsLeft > 0) {
          if (output) output.innerHTML += `<div style="color:#f44;margin-top:10px">⚠️ Low credits: ${data.creditsLeft} left. <a href="https://buy.stripe.com/REPLACE_PROMAX_LINK" target="_blank">Upgrade to Pro Max</a></div>`;
        }
      } else if (data.tier === 'PROMAX') {
        if (freeCounter) freeCounter.textContent = `Pro Max: Unlimited`;
      }

    } catch (err) {
      if (output) output.textContent = `Error: ${err.message}`;
      if (buildStatusText) buildStatusText.textContent = 'Error';
    } finally {
      sendBtn.disabled = false;
      checkFreeRemaining();
    }
  };
}

// Example chips
exampleChips.forEach(chip => {
  chip.onclick = () => {
    if (promptInput) promptInput.value = chip.textContent;
  };
});

checkFreeRemaining();
