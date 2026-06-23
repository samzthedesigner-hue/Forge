const sendBtn = document.getElementById('sendBtn')
const promptInput = document.getElementById('prompt')
const output = document.getElementById('output')
const buildBar = document.getElementById('buildBar')
const buildToggle = document.getElementById('buildToggle')
const buildStatusText = document.getElementById('buildStatusText')
const fileList = document.getElementById('fileList')
const welcomeScreen = document.getElementById('welcomeScreen')
const exampleChips = document.querySelectorAll('.example-chip')

// Auto-resize textarea
promptInput.addEventListener('input', () => {
  promptInput.style.height = 'auto'
  promptInput.style.height = promptInput.scrollHeight + 'px'
})

// Collapsible build bar
buildToggle.addEventListener('click', () => {
  buildBar.classList.toggle('collapsed')
})

// Hide welcome when first message sent
function hideWelcome() {
  if (welcomeScreen) welcomeScreen.style.display = 'none'
}

// Example chips fill input
exampleChips.forEach(chip => {
  chip.addEventListener('click', () => {
    promptInput.value = chip.textContent
    promptInput.focus()
  })
})

sendBtn.addEventListener('click', handleSend)
promptInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' &&!e.shiftKey) {
    e.preventDefault()
    handleSend()
  }
})

async function handleSend() {
  const prompt = promptInput.value.trim()
  if (!prompt) return

  // Add user message
  addMessage(prompt, 'user')
  hideWelcome()
  promptInput.value = ''
  promptInput.style.height = 'auto'

  sendBtn.disabled = true
  showBuildBar()

  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt })
    })

    const data = await res.json()

    if (res.status === 429) {
      hideBuildBar()
      addMessage(data.error, 'assistant')
    } else if (!res.ok) {
      hideBuildBar()
      addMessage(data.error || 'Something went wrong', 'assistant')
    } else {
      // Simulate file building + typewriter effect
      await simulateBuild(data.result)
      hideBuildBar()
    }
  } catch (err) {
    hideBuildBar()
    addMessage('Network error. Try again.', 'assistant')
  } finally {
    sendBtn.disabled = false
  }
}

function addMessage(text, role) {
  const msg = document.createElement('div')
  msg.className = `message ${role}`
  msg.textContent = text
  output.appendChild(msg)
  output.scrollTop = output.scrollHeight
}

function showBuildBar() {
  buildBar.classList.remove('hidden')
  fileList.innerHTML = ''
  buildStatusText.textContent = 'Building...'
}

function hideBuildBar() {
  setTimeout(() => {
    buildBar.classList.add('hidden')
  }, 1000)
}

async function simulateBuild(result) {
  // Fake file list - replace with real file data from your API later
  const files = ['index.html', 'style.css', 'script.js', 'package.json']

  for (let i = 0; i < files.length; i++) {
    const fileItem = document.createElement('div')
    fileItem.className = 'file-item active'
    fileItem.textContent = `▸ ${files[i]}`
    fileList.appendChild(fileItem)

    await sleep(600)
    fileItem.className = 'file-item done'
    fileItem.textContent = `✓ ${files[i]}`
  }

  buildStatusText.textContent = 'Complete'
  await sleep(500)

  // Type out response
  await typeWriter(result)
}

function typeWriter(text) {
  return new Promise((resolve) => {
    const msg = document.createElement('div')
    msg.className = 'message assistant'
    output.appendChild(msg)

    let i = 0
    const interval = setInterval(() => {
      msg.textContent += text[i]
      i++
      output.scrollTop = output.scrollHeight
      if (i >= text.length) {
        clearInterval(interval)
        resolve()
      }
    }, 15)
  })
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
  }
