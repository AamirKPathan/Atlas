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
let systemMemory = "You are a helpful AI assistant. You have not been named yet unless the user tells you.";
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
        .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #334155; padding-bottom: 15px; }
        .btn { background: #3b82f6; color: white; padding: 8px 14px; text-decoration: none; border-radius: 6px; font-size: 14px; }
        #chat { height: 60vh; overflow-y: auto; border: 1px solid #334155; border-radius: 8px; padding: 15px; margin: 20px 0; background: #1e293b; }
        .msg { margin-bottom: 12px; line-height: 1.5; }
        .user { color: #38bdf8; font-weight: bold; }
        .bot { color: #4ade80; font-weight: bold; }
        .input-area { display: flex; gap: 10px; }
        input { flex: 1; padding: 12px; border-radius: 6px; border: 1px solid #475569; background: #1e293b; color: white; font-size: 16px; }
        button { padding: 12px 20px; background: #22c55e; color: #0f172a; font-weight: bold; border: none; border-radius: 6px; cursor: pointer; }
      </style>
    </head>
    <body>
      <div class="header">
        <h2>🤖 Atlas Command Center</h2>
        <a href="/login" class="btn">${savedTokens ? '✅ Google Connected' : '🔗 Connect Google'}</a>
      </div>
      <div id="chat">
        <div class="msg"><span class="bot">System:</span> Online and ready. Send a message below!</div>
      </div>
      <div class="input-area">
        <input id="input" placeholder="Talk to your bot (e.g. Remember your name is Atlas)..." onkeypress="if(event.key==='Enter') send()" />
        <button onclick="send()">Send</button>
      </div>
      <script>
        async function send() {
          const input = document.getElementById('input');
          const text = input.value.trim();
          if (!text) return;
          const chat = document.getElementById('chat');
          chat.innerHTML += '<div class="msg"><span class="user">You:</span> ' + text + '</div>';
          input.value = '';
          chat.scrollTop = chat.scrollHeight;

          const res = await fetch('/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: text })
          });
          const data = await res.json();
          chat.innerHTML += '<div class="msg"><span class="bot">Atlas:</span> ' + data.reply + '</div>';
          chat.scrollTop = chat.scrollHeight;
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
      model: 'llama-3.3-70b-versatile'
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
