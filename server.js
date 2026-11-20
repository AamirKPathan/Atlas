const express = require('express');
const { google } = require('googleapis');
const Groq = require('groq-sdk');

const app = express();
app.use(express.json({ limit: '1mb' }));

const PORT = process.env.PORT || 3000;
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const sub = 'atlas-bot-muju';
const dom = ['onrender', 'com'].join('.');
const host = process.env.RENDER_EXTERNAL_URL || ('https://' + sub + '.' + dom);
const redirectUri = host + '/api/auth/callback/google';

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  redirectUri
);

let savedTokens = null, memoryFileId = null, chatHistory = [];
let systemMemory = "Your name is Atlas. Executive assistant for Aamir Khan Pathan (FRC Team 5719 Business Lead & Web Design). You HAVE direct read/write tool access to Gmail, Calendar, Tasks, Docs, Drive, and Sheets. Never claim you cannot access them—use your tools directly. Current year: 2026.";

async function syncMemory(saveNew = false) {
  if (!savedTokens) return;
  oauth2Client.setCredentials(savedTokens);
  const drive = google.drive({ version: 'v3', auth: oauth2Client });
  try {
    if (!memoryFileId) {
      const s = await drive.files.list({ q: "name='Atlas_Memory.json' and trashed=false", fields: 'files(id)' });
      if (s.data.files.length) memoryFileId = s.data.files.at(0).id;
    }
    if (memoryFileId && !saveNew) {
      const f = await drive.files.get({ fileId: memoryFileId, alt: 'media' });
      if (f.data?.systemMemory) systemMemory = String(f.data.systemMemory).slice(0, 1500);
      if (Array.isArray(f.data?.chatHistory)) chatHistory = f.data.chatHistory.slice(-6).map(m => ({ role: m.role, content: String(m.content).slice(0, 800) }));
      return;
    }
    const cleanHistory = chatHistory.slice(-6).map(m => ({ role: m.role, content: String(m.content).slice(0, 800) }));
    const body = JSON.stringify({ systemMemory: systemMemory.slice(0, 1500), chatHistory: cleanHistory });
    if (memoryFileId) await drive.files.update({ fileId: memoryFileId, media: { mimeType: 'application/json', body } });
    else {
      const c = await drive.files.create({ requestBody: { name: 'Atlas_Memory.json', mimeType: 'application/json' }, media: { mimeType: 'application/json', body }, fields: 'id' });
      memoryFileId = c.data.id;
    }
  } catch (e) {}
}

const tools = [
  { type: 'function', function: { name: 'send_email', description: 'Send an email via Gmail', parameters: { type: 'object', properties: { to: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' } }, required: ['to', 'subject', 'body'] } } },
  { type: 'function', function: { name: 'check_emails', description: 'Check recent inbox or sent emails', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'get_calendar', description: 'List upcoming Google Calendar events', parameters: { type: 'object', properties: { maxResults: { type: 'number' } } } } },
  { type: 'function', function: { name: 'create_event', description: 'Schedule a block or event on Google Calendar', parameters: { type: 'object', properties: { summary: { type: 'string' }, startISO: { type: 'string' }, endISO: { type: 'string' } }, required: ['summary', 'startISO', 'endISO'] } } },
  { type: 'function', function: { name: 'manage_tasks', description: 'List, add, or complete Google Tasks', parameters: { type: 'object', properties: { action: { type: 'string', enum: ['list', 'add', 'complete'] }, title: { type: 'string' } }, required: ['action'] } } },
  { type: 'function', function: { name: 'manage_docs', description: 'Create, read, or delete a Google Doc', parameters: { type: 'object', properties: { action: { type: 'string', enum: ['create', 'read', 'delete'] }, titleOrId: { type: 'string' }, content: { type: 'string' } }, required: ['action', 'titleOrId'] } } },
  { type: 'function', function: { name: 'append_sheet', description: 'Add a row of lead/sponsor data to a Google Sheet', parameters: { type: 'object', properties: { spreadsheetId: { type: 'string' }, values: { type: 'array', items: { type: 'string' } } }, required: ['spreadsheetId', 'values'] } } },
  { type: 'function', function: { name: 'list_drive', description: 'Find files and IDs in Google Drive', parameters: { type: 'object', properties: { query: { type: 'string' } } } } }
];
async function runTool(name, args) {
  if (!savedTokens) return 'Error: Click Connect Google at the top right first.';
  oauth2Client.setCredentials(savedTokens);
  try {
    if (name === 'send_email') {
      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
      const raw = Buffer.from('To: ' + args.to + '\r\nSubject: ' + args.subject + '\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n' + args.body).toString('base64url');
      await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
      return 'Email sent to ' + args.to;
    }
    if (name === 'check_emails') {
      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
      const r = await gmail.users.messages.list({ userId: 'me', q: args.query || 'in:inbox', maxResults: 10 });
      if (!r.data.messages) return 'No emails found.';
      let out = [];
      for (const m of r.data.messages) {
        const d = await gmail.users.messages.get({ userId: 'me', id: m.id, format: 'metadata', metadataHeaders: ['From', 'To', 'Subject'] });
        const h = d.data.payload.headers;
        out.push('From:' + (h.find(x => x.name === 'From')?.value || '') + '|Subj:' + (h.find(x => x.name === 'Subject')?.value || '') + '|' + d.data.snippet.slice(0, 90));
      }
      return out.join('\n');
    }
    if (name === 'get_calendar') {
      const cal = google.calendar({ version: 'v3', auth: oauth2Client });
      const r = await cal.events.list({ calendarId: 'primary', timeMin: new Date().toISOString(), maxResults: args.maxResults || 10, singleEvents: true, orderBy: 'startTime' });
      return (r.data.items || []).map(e => e.summary + ' (' + (e.start.dateTime || e.start.date) + ')').join('\n') || 'No upcoming events.';
    }
    if (name === 'create_event') {
      const cal = google.calendar({ version: 'v3', auth: oauth2Client });
      await cal.events.insert({ calendarId: 'primary', requestBody: { summary: args.summary, start: { dateTime: args.startISO }, end: { dateTime: args.endISO } } });
      return 'Scheduled: ' + args.summary + ' at ' + args.startISO;
    }
    if (name === 'manage_tasks') {
      const tasks = google.tasks({ version: 'v1', auth: oauth2Client });
      const list = await tasks.tasks.list({ tasklist: '@default', showCompleted: false });
      const items = list.data.items || [];
      if (args.action === 'list') return items.map(t => t.title).join('\n') || 'No open tasks.';
      if (args.action === 'add') {
        await tasks.tasks.insert({ tasklist: '@default', requestBody: { title: args.title } });
        return 'Added task: ' + args.title;
      }
      if (args.action === 'complete') {
        const match = items.find(t => t.title.toLowerCase().includes((args.title || '').toLowerCase()));
        if (!match) return 'Task not found: ' + args.title;
        await tasks.tasks.patch({ tasklist: '@default', task: match.id, requestBody: { status: 'completed' } });
        return 'Completed task: ' + match.title;
      }
    }
    if (name === 'manage_docs') {
      const docs = google.docs({ version: 'v1', auth: oauth2Client });
      const drive = google.drive({ version: 'v3', auth: oauth2Client });
      if (args.action === 'create') {
        const doc = await docs.documents.create({ requestBody: { title: args.titleOrId } });
        if (args.content) await docs.documents.batchUpdate({ documentId: doc.data.documentId, requestBody: { requests: [{ insertText: { location: { index: 1 }, text: args.content } }] } });
        return 'Created Doc "' + args.titleOrId + '" (ID: ' + doc.data.documentId + ')';
      }
      if (args.action === 'read') {
        const doc = await docs.documents.get({ documentId: args.titleOrId });
        return doc.data.body.content.map(c => c.paragraph?.elements?.map(e => e.textRun?.content).join('') || '').join('').slice(0, 1500);
      }
      if (args.action === 'delete') {
        await drive.files.delete({ fileId: args.titleOrId });
        return 'Deleted file ' + args.titleOrId;
      }
    }
    if (name === 'append_sheet') {
      const sheets = google.sheets({ version: 'v4', auth: oauth2Client });
      await sheets.spreadsheets.values.append({ spreadsheetId: args.spreadsheetId, range: 'A1', valueInputOption: 'USER_ENTERED', requestBody: { values: [args.values] } });
      return 'Row added to sheet ' + args.spreadsheetId;
    }
    if (name === 'list_drive') {
      const drive = google.drive({ version: 'v3', auth: oauth2Client });
      const q = args.query ? "name contains '" + args.query + "' and trashed=false" : "trashed=false";
      const r = await drive.files.list({ q, pageSize: 15, fields: 'files(id, name)' });
      return (r.data.files || []).map(f => f.name + ' (ID: ' + f.id + ')').join('\n') || 'No matching files.';
    }
  } catch (e) { return 'Tool error: ' + e.message; }
  return 'Done.';
}

app.get('/', (req, res) => {
  const dot = savedTokens ? '#10b981' : '#52525b';
  const authLabel = savedTokens ? 'Workspace Linked' : 'Connect Google';
  const sOpen = '<' + 'script>';
  const sClose = '<' + '/script>';
  res.send([
    '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ATLAS AI</title><style>',
    '*{box-sizing:border-box}body{margin:0;padding:20px;background:#09090b;color:#fafafa;font-family:-apple-system,BlinkMacSystemFont,"Inter",sans-serif;height:100vh}',
    '.app{max-width:850px;height:calc(100vh - 40px);margin:auto;display:flex;flex-direction:column}',
    'header{display:flex;justify-content:space-between;align-items:center;padding-bottom:14px;border-bottom:1px solid #27272a}',
    '.brand{display:flex;align-items:center;gap:10px;font-weight:600;font-size:14px;letter-spacing:.05em}',
    '.dot{width:8px;height:8px;border-radius:50%;background:' + dot + '}',
    '.pill{background:#121215;color:#fafafa;border:1px solid #27272a;padding:6px 12px;border-radius:6px;font-size:12px;text-decoration:none;cursor:pointer;margin-left:8px}',
    '.pill.active{border-color:#10b981;color:#10b981}',
    '#status{font-size:12px;color:#71717a;padding:8px 0}',
    '#chat{flex:1;overflow-y:auto;padding:12px 0;display:flex;flex-direction:column;gap:16px;scrollbar-width:none;-ms-overflow-style:none}',
    '#chat::-webkit-scrollbar{display:none}',
    '.entry{display:flex;flex-direction:column;gap:4px;max-width:80%}',
    '.user-entry{align-self:flex-end;align-items:flex-end}.bot-entry{align-self:flex-start;align-items:flex-start}',
    '.role{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#71717a;font-weight:600;padding:0 4px}',
    '.content{font-size:14px;line-height:1.65;padding:12px 16px;border-radius:12px;border:1px solid #27272a;overflow-wrap:anywhere}',
    '.bot-text{background:#121215;color:#e4e4e7;border-bottom-left-radius:3px}',
    '.user-text{background:#1e293b;border-color:#334155;color:#f8fafc;white-space:pre-wrap;border-bottom-right-radius:3px}',
    '.content h1,.content h2,.content h3{color:#fff;margin:10px 0 4px;font-size:15.5px;font-weight:600}',
    '.content strong{color:#fff}.content li{margin-left:18px;margin-bottom:3px}.content hr{border:none;border-top:1px solid #27272a;margin:10px 0}',
    '.composer{margin-top:10px;background:#121215;border:1px solid #27272a;border-radius:12px;padding:10px 12px;display:flex;align-items:flex-end;gap:10px}',
    'textarea{flex:1;background:transparent;border:none;color:#fafafa;font-family:inherit;font-size:14px;line-height:22px;min-height:154px;max-height:260px;overflow-y:auto;resize:vertical;outline:none}',
    'textarea::-webkit-scrollbar{width:5px}textarea::-webkit-scrollbar-thumb{background:#3f3f46;border-radius:4px}',
    'button.submit{background:#fafafa;color:#09090b;border:none;border-radius:8px;padding:7px 14px;font-size:13px;font-weight:600;cursor:pointer}',
    'button:disabled{opacity:.5;cursor:not-allowed}',
    '</style></head><body><div class="app">',
    '<header><div class="brand"><span class="dot"></span>ATLAS</div><div><a href="/login" class="pill">' + authLabel + '</a><button id="voiceBtn" class="pill" onclick="toggleVoice()">Voice Off</button></div></header>',
    '<div id="status">System ready.</div>',
    '<div id="chat"><div class="entry bot-entry"><div class="role">Atlas</div><div class="content bot-text">Atlas connected and standing by.</div></div></div>',
    '<div class="composer"><textarea id="input" rows="7" placeholder="Message Atlas..." oninput="this.style.height=\'154px\';this.style.height=Math.min(Math.max(this.scrollHeight,154),260)+\'px\'" onkeydown="if(event.key===\'Enter\'&&!event.shiftKey){event.preventDefault();send();}"></textarea>',
    '<button class="submit" id="sendBtn" onclick="send()">Send</button></div></div>' + sOpen,
    'function escapeHTML(v){return String(v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}',
    'function parseMD(t){var e=escapeHTML(t);var b=e.split("**").map(function(p,i){return i%2===1?"<strong>"+p+"</strong>":p;}).join("");return b.split(String.fromCharCode(10)).map(function(l){if(l.startsWith("### "))return "<h3>"+l.slice(4)+"</h3>";if(l.startsWith("## "))return "<h2>"+l.slice(3)+"</h2>";if(l.startsWith("# "))return "<h1>"+l.slice(2)+"</h1>";if(l.trim()==="---")return "<hr>";if(l.startsWith("- ")||l.startsWith("* "))return "<li>"+l.slice(2)+"</li>";return l;}).join("<br>");}',
    'function addMsg(role,text,isUser){const chat=document.getElementById("chat"),entry=document.createElement("div");entry.className="entry "+(isUser?"user-entry":"bot-entry");const label=document.createElement("div");label.className="role";label.textContent=role;const content=document.createElement("div");content.className="content "+(isUser?"user-text":"bot-text");if(isUser)content.textContent=text;else content.innerHTML=parseMD(text);entry.appendChild(label);entry.appendChild(content);chat.appendChild(entry);chat.scrollTop=chat.scrollHeight;}',
'async function send(sp=null,voice=false){const input=document.getElementById("input"),btn=document.getElementById("sendBtn"),message=sp||input.value.trim();if(!message||btn.disabled)return;addMsg("You",message,true);if(!voice){input.value="";input.style.height="154px";}btn.disabled=true;document.getElementById("status").textContent="Atlas is thinking...";try{const res=await fetch("/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message})});const data=await res.json();addMsg("Atlas",data.reply,false);document.getElementById("status").textContent="System ready.";if(voice)speak(data.reply);}catch(e){addMsg("Atlas","Connection error: "+e.message,false);document.getElementById("status").textContent="Connection error.";}finally{btn.disabled=false;}}',
'let voiceActive=false,rec=null;',
'function toggleVoice(){const b=document.getElementById("voiceBtn"),s=document.getElementById("status");if(!voiceActive){const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR){s.textContent="Voice unavailable.";return;}rec=new SR();rec.continuous=false;rec.interimResults=true;rec.lang="en-US";rec.onresult=function(e){const l=Array.from(e.results).at(-1),t=Array.from(l).at(0).transcript.trim();s.textContent="Input: "+t;if(l.isFinal&&t.toLowerCase().includes("atlas"))send(t,true);};rec.onerror=function(e){if(e.error!=="no-speech"&&e.error!=="aborted")s.textContent="Audio: "+e.error;};rec.onend=function(){if(voiceActive&&!window.speechSynthesis.speaking)setTimeout(function(){if(voiceActive)try{rec.start();}catch(e){}},200);};rec.start();voiceActive=true;b.textContent="Listening";b.classList.add("active");s.textContent="Hands-free active.";}else{voiceActive=false;if(rec)rec.stop();window.speechSynthesis.cancel();b.textContent="Voice Off";b.classList.remove("active");s.textContent="Voice disabled.";}}',
'function speak(t){if(!voiceActive)return;if(rec)rec.stop();const u=new SpeechSynthesisUtterance(t.replace(/[*#_|-]/g,""));u.onend=function(){if(voiceActive&&rec)try{rec.start();}catch(e){}};window.speechSynthesis.speak(u);}',
sClose + ''
].join(''));
});
app.get('/login', (req, res) => {
try {
const authHost = ['www', 'googleapis', 'com'].join('.');
const prefix = 'https://' + authHost + '/auth/';
const scopes = ['gmail.modify', 'calendar', 'tasks', 'documents', 'drive', 'spreadsheets'].map(s => prefix + s);
const url = oauth2Client.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: scopes });
res.redirect(url);
} catch (e) { res.status(500).send('Login error: ' + e.message); }
});
app.get('/api/auth/callback/google', async (req, res) => {
try {
const { tokens } = await oauth2Client.getToken(req.query.code);
savedTokens = tokens;
oauth2Client.setCredentials(tokens);
await syncMemory(false);
await syncMemory(true);
res.redirect('/');
} catch (e) { res.status(500).send('Callback error: ' + e.message); }
});
app.post('/chat', async (req, res) => {
try {
const { message } = req.body, l = message.toLowerCase();
if (l.includes('my name') || l.includes('remember') || l.includes('5719') || l.includes('save')) systemMemory += '\nFact: ' + message.slice(0, 300);
const recent = chatHistory.slice(-6).map(m => ({ role: m.role, content: String(m.content).slice(0, 800) }));
const msgs = [{ role: 'system', content: systemMemory.slice(0, 1500) }, ...recent, { role: 'user', content: message.slice(0, 2500) }];
let comp = await groq.chat.completions.create({ messages: msgs, model: 'openai/gpt-oss-120b', tools, tool_choice: 'auto' });
let msg = comp.choices.at(0).message;
if (msg.tool_calls && msg.tool_calls.length > 0) {
msgs.push(msg);
for (const tc of msg.tool_calls) {
const resTool = await runTool(tc.function.name, JSON.parse(tc.function.arguments || '{}'));
msgs.push({ role: 'tool', tool_call_id: tc.id, content: String(resTool).slice(0, 1500) });
}
comp = await groq.chat.completions.create({ messages: msgs, model: 'openai/gpt-oss-120b' });
msg = comp.choices.at(0).message;
}
const reply = msg.content || 'Action completed.';
chatHistory.push({ role: 'user', content: message.slice(0, 800) });
chatHistory.push({ role: 'assistant', content: reply.slice(0, 800) });
if (chatHistory.length > 6) chatHistory = chatHistory.slice(-6);
await syncMemory(true);
res.json({ reply });
} catch (e) { res.json({ reply: 'Error: ' + e.message }); }
});
app.listen(PORT, () => console.log('Atlas running on port ' + PORT));
