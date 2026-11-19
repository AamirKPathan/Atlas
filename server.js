const express = require('express');
const cors = require('cors');
const Groq = require('groq-sdk');
const { google } = require('googleapis');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const redirectUri = Buffer.from('aHR0cHM6Ly9hdGxhcy1ib3QtbXVqdS5vbnJlbmRlci5jb20vYXBpL2F1dGgvY2FsbGJhY2svZ29vZ2xl', 'base64').toString('utf8');

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  redirectUri
);

let savedTokens = null;
let systemMemory = "Your name is Atlas. You are a sharp, concise AI assistant. Keep spoken replies brief, natural, and conversational without markdown symbols or asterisks.";
let chatHistory = [];

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Atlas AI Agent</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        body { font-family: system-ui, sans-serif; background: #0f172a; color: #f8fafc; max-width: 700px; margin: 0 auto; padding: 20px; }
        .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #334155; padding-bottom: 15px; gap: 10px; flex-wrap: wrap; }
        .btn { background: #3b82f6; color: white; padding: 8px 14px; text-decoration: none; border-radius: 6px; font-size: 14px; border: none; cursor: pointer; font-weight: bold; }
        .voice-off { background: #ef4444; }
        .voice-on { background: #22c55e; color: #0f172a; }
        #status { font-size: 13px; color: #94a3b8; margin-top: 8px; }
        #chat { height: 55vh; overflow-y: auto; border: 1px solid #334155; border-radius: 8px; padding: 15px; margin: 15px 0; background: #1e293b; }
        .msg { margin-bottom: 12px; line-height: 1.5; }
        .user { color: #38bdf8; font-weight: bold; }
        .bot { color: #4ade80; font-weight: bold; }
        .input-area { display: flex; gap: 10px; }
        input { flex: 1; padding: 12px; border-radius: 6px; border: 1px solid #475569; background: #1e293b; color: white; font-size: 16px; }
        button.send { padding: 12px 20px; background: #22c55e; color: #0f172a; font-weight: bold; border: none; border-radius: 6px; cursor: pointer; }
      </style>
    </head>
    <body>
      <div class="header">
        <h2>🤖 Atlas Command Center</h2>
        <div>
          <button id="voiceBtn" class="btn voice-off" onclick="toggleVoice()">🎙️ Enable Hands-Free</button>
          <a href="/login" class="btn">${savedTokens ? '✅ Google Connected' : '🔗 Connect Google'}</a>
        </div>
      </div>
      <div id="status">Voice is off. Click "Enable Hands-Free" once, then just say "Atlas..." anytime.</div>
      <div id="chat">
        <div class="msg"><span class="bot">Atlas:</span> Online and ready.</div>
      </div>
      <div class="input-area">
        <input id="input" placeholder="Type or say 'Atlas' out loud..." onkeypress="if(event.key==='Enter') send()" />
        <button class="send" onclick="send()">Send</button>
      </div>

      <script>
        let voiceActive = false;
        let recognition = null;

        function toggleVoice() {
          const btn = document.getElementById('voiceBtn');
          const status = document.getElementById('status');
          if (!voiceActive) {
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (!SpeechRecognition) {
              alert('Your browser does not support voice recognition. Please use Google Chrome or Microsoft Edge.');
              return;
            }
            recognition = new SpeechRecognition();
            recognition.continuous = true;
            recognition.interimResults = false;
            recognition.lang = 'en-US';

            recognition.onresult = (event) => {
              const transcript = event.results[event.results.length - 1].transcript.trim();
              status.innerText = 'Heard: "' + transcript + '"';
              if (transcript.toLowerCase().includes('atlas')) {
                send(transcript, true);
              }
            };

            recognition.onend = () => {
              if (voiceActive && !window.speechSynthesis.speaking) {
                try { recognition.start(); } catch(e) {}
              }
            };

            recognition.start();
            voiceActive = true;
            btn.innerText = '🟢 Listening ("Atlas...")';
            btn.className = 'btn voice-on';
            status.innerText = 'Hands-free active! Just say "Atlas" followed by your command.';
          } else {
            voiceActive = false;
            if (recognition) recognition.stop();
            window.speechSynthesis.cancel();
            btn.innerText = '🎙️ Enable Hands-Free';
            btn.className = 'btn voice-off';
            status.innerText = 'Voice turned off.';
          }
        }

        function speak(text) {
          if (!voiceActive) return;
          if (recognition) recognition.stop();
          const cleanText = text.replace(/[*#_]/g, '');
          const utterance = new SpeechSynthesisUtterance(cleanText);
          utterance.onend = () => {
            if (voiceActive && recognition) {
              try { recognition.start(); } catch(e) {}
            }
          };
          window.speechSynthesis.speak(utterance);
        }

        async function send(spokenText = null, isVoice = false) {
          const input = document.getElementById('input');
          const text = spokenText || input.value.trim();
          if (!text) return;
          const chat = document.getElementById('chat');
          chat.innerHTML += '<div class="msg"><span class="user">You:</span> ' + text + '</div>';
          if (!isVoice) input.value = '';
          chat.scrollTop = chat.scrollHeight;

          const res = await fetch('/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: text })
          });
          const data = await res.json();
          chat.innerHTML += '<div class="msg"><span class="bot">Atlas:</span> ' + data.reply + '</div>';
          chat.scrollTop = chat.scrollHeight;
          if (isVoice) speak(data.reply);
        }
      </script>
    </body>
    </html>
  `);
});

app.get('/login', (req, res) => {
  const base = Buffer.from('aHR0cHM6Ly93d3cuZ29vZ2xlYXBpcy5jb20vYXV0aC8=', 'base64').toString('utf8');
  const scopes = [
    base + 'gmail.modify',
    base + 'calendar',
    base + 'tasks',
    base + 'documents',
    base + 'drive',
    base + 'spreadsheets'
  ];
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: scopes
  });
  res.redirect(url);
});

app.get('/api/auth/callback/google', async (req, res) => {
  try {
    const { code } = req.query;
    const { tokens } = await oauth2Client.getToken(code);
    savedTokens = tokens;
    oauth2Client.setCredentials(tokens);
    res.redirect('/');
  } catch (err) {
    res.status(500).send('Auth error: ' + err.message);
  }
});

app.post('/chat', async (req, res) => {
  try {
    const { message } = req.body;
    if (message.toLowerCase().includes('remember')) {
      systemMemory += ' ' + message;
    }
    chatHistory.push({ role: 'user', content: message });
    if (chatHistory.length > 20) chatHistory = chatHistory.slice(-20);

    const completion = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: systemMemory },
        ...chatHistory
      ],
      model: 'openai/gpt-oss-120b'
    });

    const reply = completion.choices[0].message.content;
    chatHistory.push({ role: 'assistant', content: reply });
    res.json({ reply });
  } catch (err) {
    res.json({ reply: 'Error: ' + err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Atlas running on port ' + PORT));
