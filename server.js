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
const oauth2Client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, redirectUri);

let savedTokens = null;
let systemMemory = "Your name is Atlas. You are a sharp, proactive executive assistant for Aamir Khan Pathan. Keep replies clear, natural, and concise.";
let chatHistory = [];

async function getRecentEmails() {
  if (!savedTokens) return "Gmail not connected.";
  oauth2Client.setCredentials(savedTokens);
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
  const res = await gmail.users.messages.list({ userId: 'me', q: 'in:sent', maxResults: 50 });
  if (!res.data.messages) return "No sent emails.";
  let out = [];
  for (const m of res.data.messages) {
    const d = await gmail.users.messages.get({ userId: 'me', id: m.id, format: 'metadata', metadataHeaders: ['To', 'Subject'] });
    const h = d.data.payload.headers;
    out.push('To: ' + (h.find(x => x.name === 'To')?.value || '') + ' | Subj: ' + (h.find(x => x.name === 'Subject')?.value || '') + ' | ' + d.data.snippet);
  }
  return out.join('\n');
}

async function getDriveFiles() {
  if (!savedTokens) return "Drive not connected.";
  oauth2Client.setCredentials(savedTokens);
  const drive = google.drive({ version: 'v3', auth: oauth2Client });
  const res = await drive.files.list({ pageSize: 20, fields: 'files(id, name, mimeType)' });
  return (res.data.files || []).map(f => f.name + ' (' + f.id + ')').join('\n') || "No files.";
}

app.get('/', (req, res) => {
  const dot = savedTokens ? '#10b981' : '#52525b';
  const auth = savedTokens ? 'Workspace Linked' : 'Link Google';
  res.send([
    '<!DOCTYPE html><html><head><title>Atlas</title><meta name="viewport" content="width=device-width,initial-scale=1">',
    '<script src="https://jsdelivr.net"></script><style>',
    '*{box-sizing:border-box;margin:0;padding:0}',
    'body{font-family:-apple-system,BlinkMacSystemFont,"Inter",sans-serif;background:#09090b;color:#fafafa;height:100vh;display:flex;flex-direction:column;max-width:860px;margin:0 auto;padding:20px}',
    'header{display:flex;justify-content:space-between;align-items:center;padding-bottom:14px;border-bottom:1px solid #27272a}',
    '.brand{display:flex;align-items:center;gap:10px;font-weight:600;font-size:14px;letter-spacing:.05em}',
    '.dot{width:8px;height:8px;border-radius:50%;background:' + dot + '}',
    '.pill{background:#121215;color:#fafafa;border:1px solid #27272a;padding:6px 12px;border-radius:6px;font-size:12px;text-decoration:none;cursor:pointer;margin-left:8px}',
    '.pill.active{border-color:#10b981;color:#10b981}',
    '#status{font-size:12px;color:#71717a;padding:8px 0}',
    '#chat{flex:1;overflow-y:auto;padding:12px 0;display:flex;flex-direction:column;gap:16px;scrollbar-width:none;-ms-overflow-style:none}',
    '#chat::-webkit-scrollbar{display:none}',
    '.entry{display:flex;flex-direction:column;gap:4px;max-width:80%}',
    '.user-entry{align-self:flex-end;align-items:flex-end}',
    '.bot-entry{align-self:flex-start;align-items:flex-start}',
    '.role{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#71717a;font-weight:600;padding:0 4px}',
    '.content{font-size:14px;line-height:1.6;padding:12px 16px;border-radius:12px;border:1px solid #27272a}',
    '.bot-text{background:#121215;color:#e4e4e7;border-bottom-left-radius:3px}',
    '.user-text{background:#1e293b;border-color:#334155;color:#f8fafc;white-space:pre-wrap;border-bottom-right-radius:3px}',
    '.content h1,.content h2,.content h3{color:#fff;margin:12px 0 6px;font-size:15px}',
    '.content p{margin-bottom:8px}.content p:last-child{margin-bottom:0}',
    '.content ul,.content ol{margin:6px 0 10px 18px}.content li{margin-bottom:3px}',
    '.content table{width:100%;border-collapse:collapse;margin:8px 0;font-size:12.5px}',
    '.content th,.content td{border:1px solid #27272a;padding:6px 8px;text-align:left}',
    '.content th{background:#18181b}',
    '.composer{margin-top:10px;background:#121215;border:1px solid #27272a;border-radius:10px;padding:10px 12px;display:flex;gap:10px}',
    'textarea{flex:1;background:transparent;border:none;color:#fafafa;font-family:inherit;font-size:14px;resize:none;outline:none;scrollbar-width:none}',
    'textarea::-webkit-scrollbar{display:none}',
    'button.submit{background:#fafafa;color:#09090b;border:none;border-radius:6px;padding:6px 14px;font-size:13px;font-weight:600;cursor:pointer}',
    '</style></head><body>',
    '<header><div class="brand"><span class="dot"></span><span>ATLAS</span></div>',
    '<div><button id="voiceBtn" class="pill" onclick="toggleVoice()">Voice Off</button><a href="/login" class="pill">' + auth + '</a></div></header>',
    '<div id="status">System ready.</div>',
    '<div id="chat"><div class="entry bot-entry"><div class="role">Atlas</div><div class="content bot-text">Connected and standing by.</div></div></div>',
    '<div class="composer"><textarea id="input" rows="1" placeholder="Write a command..." onkeydown="if(event.key===\'Enter\'&&!event.shiftKey){event.preventDefault();send();}"></textarea>',
    '<button class="submit" onclick="send()">Send</button></div><script>',
    'let voiceActive=false,rec=null;',
    'function toggleVoice(){const b=document.getElementById("voiceBtn"),s=document.getElementById("status");if(!voiceActive){const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR){s.innerText="Voice unavailable.";return;}rec=new SR();rec.continuous=false;rec.interimResults=true;rec.lang="en-US";rec.onresult=(e)=>{const l=Array.from(e.results).at(-1),t=Array.from(l).at(0).transcript.trim();s.innerText="Input: "+t;if(l.isFinal&&t.toLowerCase().includes("atlas"))send(t,true);};rec.onerror=(e)=>{if(e.error!=="no-speech"&&e.error!=="aborted")s.innerText="Audio: "+e.error;};rec.onend=()=>{if(voiceActive&&!window.speechSynthesis.speaking)setTimeout(()=>{try{rec.start();}catch(e){}},150);};rec.start();voiceActive=true;b.innerText="Listening";b.classList.add("active");s.innerText="Hands-free active.";}else{voiceActive=false;if(rec)rec.stop();window.speechSynthesis.cancel();b.innerText="Voice Off";b.classList.remove("active");s.innerText="Voice disabled.";}}',
    'function speak(t){if(!voiceActive)return;if(rec)rec.stop();const u=new SpeechSynthesisUtterance(t.replace(/[*#_|-]/g,""));u.onend=()=>{if(voiceActive&&rec)try{rec.start();}catch(e){}};window.speechSynthesis.speak(u);}',
    'function addMsg(r,t,u){const c=document.getElementById("chat"),d=document.createElement("div");d.className="entry "+(u?"user-entry":"bot-entry");const rl=document.createElement("div");rl.className="role";rl.textContent=r;const ct=document.createElement("div");ct.className="content "+(u?"user-text":"bot-text");if(u)ct.textContent=t;else ct.innerHTML=typeof marked!=="undefined"?marked.parse(t):t;d.appendChild(rl);d.appendChild(ct);c.appendChild(d);c.scrollTop=c.scrollHeight;}',
    'async function send(sp=null,v=false){const i=document.getElementById("input"),t=sp||i.value.trim();if(!t)return;addMsg("You",t,true);if(!v)i.value="";const r=await fetch("/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message:t})});const d=await r.json();addMsg("Atlas",d.reply,false);if(v)speak(d.reply);}',
    '</script></body></html>'
  ].join(''));
});

app.get('/login', (req, res) => {
  const base = Buffer.from('aHR0cHM6Ly93d3cuZ29vZ2xlYXBpcy5jb20vYXV0aC8=', 'base64').toString('utf8');
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline', prompt: 'consent',
    scope: ['gmail.modify', 'calendar', 'tasks', 'documents', 'drive', 'spreadsheets'].map(s => base + s)
  });
  res.redirect(url);
});

app.get('/api/auth/callback/google', async (req, res) => {
  try {
    const { tokens } = await oauth2Client.getToken(req.query.code);
    savedTokens = tokens;
    oauth2Client.setCredentials(tokens);
    res.redirect('/');
  } catch (err) { res.status(500).send('Auth error: ' + err.message); }
});

app.post('/chat', async (req, res) => {
  try {
    const { message } = req.body;
    const lower = message.toLowerCase();
    if (lower.includes('my name is') || lower.includes('remember') || lower.includes('5719')) systemMemory += '\nUser Context: ' + message;
    let ctx = '';
    if (lower.includes('gmail') || lower.includes('email') || lower.includes('sent')) ctx += '\n\n[LAST 50 SENT EMAILS]:\n' + await getRecentEmails();
    if (lower.includes('drive') || lower.includes('spreadsheet') || lower.includes('sheet') || lower.includes('doc')) ctx += '\n\n[DRIVE FILES]:\n' + await getDriveFiles();
    chatHistory.push({ role: 'user', content: message + ctx });
    if (chatHistory.length > 20) chatHistory = chatHistory.slice(-20);
    const completion = await groq.chat.completions.create({ messages: [{ role: 'system', content: systemMemory }, ...chatHistory], model: 'openai/gpt-oss-120b' });
    const reply = completion.choices.at(0).message.content;
    chatHistory.push({ role: 'assistant', content: reply });
    res.json({ reply });
  } catch (err) { res.json({ reply: 'Error: ' + err.message }); }
});

app.listen(process.env.PORT || 3000, () => console.log('Atlas running'));
