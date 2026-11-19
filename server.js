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
let systemMemory = "Your name is Atlas. You are a sharp, proactive executive assistant. Keep replies clear, natural, and concise.";
let chatHistory = [];

async function getRecentEmails() {
  if (!savedTokens) return "Gmail is not connected yet.";
  oauth2Client.setCredentials(savedTokens);
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
  const res = await gmail.users.messages.list({ userId: 'me', q: 'in:sent', maxResults: 50 });
  if (!res.data.messages) return "No sent emails found.";

  let summaries = [];
  for (const msg of res.data.messages) {
    const detail = await gmail.users.messages.get({ userId: 'me', id: msg.id, format: 'metadata', metadataHeaders: ['To', 'Subject', 'Date'] });
    const headers = detail.data.payload.headers;
    const to = headers.find(h => h.name === 'To')?.value || '';
    const subject = headers.find(h => h.name === 'Subject')?.value || '';
    summaries.push('To: ' + to + ' | Subject: ' + subject + ' | Snippet: ' + detail.data.snippet);
  }
  return summaries.join('\n');
}

app.get('/', (req, res) => {
  const dotColor = savedTokens ? '#10b981' : '#52525b';
  const authLabel = savedTokens ? 'Workspace Linked' : 'Link Google';
  const html = [
    '<!DOCTYPE html><html lang="en"><head><title>Atlas</title>',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<style>',
    '*{box-sizing:border-box;margin:0;padding:0}',
    'body{font-family:-apple-system,BlinkMacSystemFont,"Inter",sans-serif;background:#09090b;color:#fafafa;height:100vh;display:flex;flex-direction:column;max-width:760px;margin:0 auto;padding:24px 20px}',
    'header{display:flex;justify-content:space-between;align-items:center;padding-bottom:16px;border-bottom:1px solid #27272a}',
    '.brand{display:flex;align-items:center;gap:10px;font-weight:600;font-size:14px;letter-spacing:0.04em}',
    '.dot{width:8px;height:8px;border-radius:50%;background:' + dotColor + '}',
    '.controls{display:flex;gap:8px}',
    '.pill{background:#121215;color:#fafafa;border:1px solid #27272a;padding:6px 12px;border-radius:6px;font-size:12px;font-weight:500;text-decoration:none;cursor:pointer}',
    '.pill:hover{border-color:#52525b;background:#18181b}',
    '.pill.active{border-color:#10b981;color:#10b981}',
    '#status{font-size:12px;color:#71717a;padding:10px 0}',
    '#chat{flex:1;overflow-y:auto;padding:12px 0;display:flex;flex-direction:column;gap:18px}',
    '.entry{display:flex;flex-direction:column;gap:4px}',
    '.role{font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#71717a;font-weight:600}',
    '.role.user{color:#a1a1aa}',
    '.content{font-size:14.5px;line-height:1.6;color:#fafafa;white-space:pre-wrap}',
    '.composer{margin-top:12px;background:#121215;border:1px solid #27272a;border-radius:10px;padding:10px 12px;display:flex;align-items:flex-end;gap:10px}',
    '.composer:focus-within{border-color:#52525b}',
    'textarea{flex:1;background:transparent;border:none;color:#fafafa;font-family:inherit;font-size:14px;line-height:1.5;resize:none;outline:none;max-height:140px;min-height:24px}',
    'button.submit{background:#fafafa;color:#09090b;border:none;border-radius:6px;padding:6px 14px;font-size:13px;font-weight:600;cursor:pointer}',
    '</style></head><body>',
    '<header><div class="brand"><span class="dot"></span><span>ATLAS</span></div>',
    '<div class="controls"><button id="voiceBtn" class="pill" onclick="toggleVoice()">Voice Off</button>',
    '<a href="/login" class="pill">' + authLabel + '</a></div></header>',
    '<div id="status">System ready.</div>',
    '<div id="chat"><div class="entry"><div class="role">Atlas</div><div class="content">Connected and standing by.</div></div></div>',
    '<div class="composer"><textarea id="input" rows="1" placeholder="Write a command or prompt..." onkeydown="if(event.key===\'Enter\'&&!event.shiftKey){event.preventDefault();send();}"></textarea>',
    '<button class="submit" onclick="send()">Send</button></div>',
    '<script>',
    'let voiceActive=false,recognition=null;',
    'function toggleVoice(){const btn=document.getElementById("voiceBtn"),status=document.getElementById("status");if(!voiceActive){const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR){status.innerText="Voice unavailable in this browser.";return;}recognition=new SR();recognition.continuous=false;recognition.interimResults=true;recognition.lang="en-US";recognition.onresult=(e)=>{const last=Array.from(e.results).at(-1);const t=Array.from(last).at(0).transcript.trim();status.innerText="Input: "+t;if(last.isFinal&&t.toLowerCase().includes("atlas"))send(t,true);};recognition.onerror=(e)=>{if(e.error!=="no-speech"&&e.error!=="aborted")status.innerText="Audio: "+e.error;};recognition.onend=()=>{if(voiceActive&&!window.speechSynthesis.speaking)setTimeout(()=>{try{recognition.start();}catch(e){}},150);};recognition.start();voiceActive=true;btn.innerText="Listening";btn.classList.add("active");status.innerText="Hands-free active. Say Atlas to trigger.";}else{voiceActive=false;if(recognition)recognition.stop();window.speechSynthesis.cancel();btn.innerText="Voice Off";btn.classList.remove("active");status.innerText="Voice disabled.";}}',
    'function speak(text){if(!voiceActive)return;if(recognition)recognition.stop();const u=new SpeechSynthesisUtterance(text.replace(/[*#_]/g,""));u.onend=()=>{if(voiceActive&&recognition)try{recognition.start();}catch(e){}};window.speechSynthesis.speak(u);}',
    'function appendMsg(role,text,isUser){const chat=document.getElementById("chat");const d=document.createElement("div");d.className="entry";d.innerHTML="<div class=\'role "+(isUser?"user":"")+"\'>"+role+"</div><div class=\'content\'></div>";d.querySelector(".content").textContent=text;chat.appendChild(d);chat.scrollTop=chat.scrollHeight;}',
    'async function send(spoken=null,isVoice=false){const inp=document.getElementById("input");const text=spoken||inp.value.trim();if(!text)return;appendMsg("You",text,true);if(!isVoice)inp.value="";const res=await fetch("/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message:text})});const data=await res.json();appendMsg("Atlas",data.reply,false);if(isVoice)speak(data.reply);}',
    '</script></body></html>'
  ].join('');
  res.send(html);
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
    const lower = message.toLowerCase();

    if (lower.includes('my name is') || lower.includes('remember') || lower.includes('5719')) {
      systemMemory += '\nUser Context: ' + message;
    }

    let emailContext = '';
    if (lower.includes('gmail') || lower.includes('email') || lower.includes('sent')) {
      const emails = await getRecentEmails();
      emailContext = '\n\n[LIVE GMAIL SENT DATA (Last 50 Sent Emails)]:\n' + emails;
    }

    chatHistory.push({ role: 'user', content: message + emailContext });
    if (chatHistory.length > 20) chatHistory = chatHistory.slice(-20);

    const completion = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: systemMemory },
        ...chatHistory
      ],
      model: 'openai/gpt-oss-120b'
    });

    const reply = completion.choices.at(0).message.content;
    chatHistory.push({ role: 'assistant', content: reply });
    res.json({ reply });
  } catch (err) {
    res.json({ reply: 'Error: ' + err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Atlas running on port ' + PORT));
