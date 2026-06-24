// Get or ask for email on first load
let userEmail = localStorage.getItem('forge_email');
if (!userEmail) {
  setTimeout(() => openSettings(), 500);
} else {
  updateCreditUI();
}

// Update credit display
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
      const creditsText = res.tier === 'PROMAX'? 'Unlimited' : `${res.credits} credits`;
      creditEl.innerHTML = `
        <span style="color:${tierColor};font-weight:bold">${res.tier}</span> • 
        ${creditsText}
        ${res.inGrace? '<span style="color:#f59e0b;font-size:11px"> • Grace</span>' : ''}
      `;
    }
  } catch (err) {
    document.getElementById('creditDisplay').innerText = 'Error loading credits';
  }
}

// Handle build button
async function handleBuild() {
  if (!userEmail) {
    alert('Please set your email in Settings first');
    openSettings();
    return;
  }

  const prompt = document.getElementById('promptInput').value.trim();
  if (!prompt) {
    alert('Enter a prompt first');
    return;
  }

  const btn = document.getElementById('buildBtn');
  const output = document.getElementById('outputBox');
  
  btn.disabled = true;
  btn.innerText = 'Building...';
  output.innerText = 'Generating your app...';

  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, email: userEmail })
    });
    
    const data = await res.json();
    
    if (res.status === 402) {
      // Show upgrade modal
      document.getElementById('upgradeMessage').innerText = data.message;
      document.getElementById('upgradeModal').style.display = 'flex';
      output.innerText = 'Build cancelled. Upgrade to continue or try a smaller prompt.';
    } else if (data.success) {
      output.innerText = data.code;
      updateCreditUI(); // Refresh credits
    } else {
      output.innerText = `Error: ${data.error || 'Generation failed'}`;
    }
  } catch (err) {
    output.innerText = 'Network error. Try again.';
  } finally {
    btn.disabled = false;
    btn.innerText = 'Build with Forge';
  }
}

// Modal controls
function openSettings() {
  document.getElementById('settingsModal').style.display = 'flex';
  document.getElementById('userEmail').value = userEmail || '';
}

function closeSettings() {
  document.getElementById('settingsModal').style.display = 'none';
}

function saveEmail() {
  const email = document.getElementById('userEmail').value.trim();
  if (!email ||!email.includes('@')) {
    alert('Enter a valid email');
    return;
  }
  localStorage.setItem('forge_email', email);
  userEmail = email;
  updateCreditUI();
  closeSettings();
}

function closeUpgradeModal() {
  document.getElementById('upgradeModal').style.display = 'none';
}

function continueOnFree() {
  closeUpgradeModal();
  document.getElementById('outputBox').innerText = 'Build cancelled. Free tier active. Try a smaller prompt or upgrade for more power.';
}

// Close modals on background click
window.onclick = function(e) {
  if (e.target.classList.contains('modal')) {
    e.target.style.display = 'none';
  }
}
