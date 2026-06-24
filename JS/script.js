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

// Your existing elements from script.js
const sendBtn = document.getElementById('sendBtn');
const promptInput = document.getElementById('promptInput') || document.getElementById('prompt');
const output = document.getElementById('output');
const buildBar = document.getElementById('buildBar');
const buildToggle = document.getElementById('buildToggle');
const buildStatusText = document.getElementById('buildStatusText');
const fileList = document.getElementById('fileList');
const welcomeScreen = document.getElementById('welcomeScreen');
const exampleChips = document.querySelectorAll('.chip');

// Auto-resize textarea - keep your existing code
if (promptInput) {
  promptInput.addEventListener('input', () => {
    promptInput.style.height = 'auto';
    promptInput.style.height = promptInput.scrollHeight + 'px';
  });
}

// Add free counter display if you have one in HTML
const freeCounter = document.getElementById('freeCounter');

async function checkFreeRemaining() {
  if (!freeCounter) return;
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
    if (remaining !== null) {
      freeCounter.textContent = `Free: ${remaining} left`;
    }
  } catch (e) {}
}

// Main generate function - uses your sendBtn
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

      if (res.status === 429 && data.upsell) {
        if (output) output.innerHTML = `<div style="color:#f44">Free limit reached. <a href="#" onclick="openSettings()" style="color:#4f46e5">Add your API key</a> or <a href="https://buy.stripe.com/test_00g00g" target="_blank" style="color:#4f46e5">Upgrade to Pro $5/mo</a> for unlimited.</div>`;
        return;
      }

      if (!res.ok) throw new Error(data.error || 'Generation failed');

      // Display plan
      if (output) output.innerHTML = `<b>Plan:</b><br>${data.plan}<br><br><b>Files:</b><br>`;
      
      // Display files in your fileList
      if (fileList) {
        fileList.innerHTML = '';
        data.files.forEach(f => {
          const div = document.createElement('div');
          div.innerHTML = `<b>${f.path}</b><pre>${f.content}</pre>`;
          fileList.appendChild(div);
        });
      }

      if (buildStatusText) buildStatusText.textContent = `Done via ${data.provider}`;

    } catch (err) {
      if (output) output.textContent = `Error: ${err.message}`;
      if (buildStatusText) buildStatusText.textContent = 'Error';
    } finally {
      sendBtn.disabled = false;
      checkFreeRemaining();
    }
  };
}

// Settings modal - add this if you don't have it
function openSettings() {
  const modal = document.getElementById('settingsModal');
  if (!modal) return alert('Add settings modal to HTML');
  
  const keys = getKeys();
  document.getElementById('groqKey').value = keys.groq;
  document.getElementById('openaiKey').value = keys.openai;
  document.getElementById('openrouterKey').value = keys.openrouter;
  document.getElementById('userEmail').value = getUserEmail();
  modal.style.display = 'flex';
}

// Example chips
exampleChips.forEach(chip => {
  chip.onclick = () => {
    if (promptInput) promptInput.value = chip.textContent;
  };
});

checkFreeRemaining();
