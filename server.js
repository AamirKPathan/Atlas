
const express = require('express');
const { google } = require('googleapis');
const Groq = require('groq-sdk');

const app = express();

app.use(express.json({ limit: '1mb' }));

// =====================================
// CONFIGURATION
// =====================================

const PORT = process.env.PORT || 3000;

if (!process.env.GROQ_API_KEY) {
    throw new Error('Missing GROQ_API_KEY environment variable');
}

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
});

const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI ||
    `http://localhost:${PORT}/api/auth/callback/google`
);

let savedTokens = null;
let systemMemory = '';
let chatHistory = [];

const tools = [];

// =====================================
// MEMORY
// =====================================

async function syncMemory() {
    return true;
}

// =====================================
// TOOL EXECUTION
// =====================================

async function runTool(name, args) {
    throw new Error(`Unknown tool: ${name}`);
}

// =====================================
// HTML INTERFACE
// =====================================

app.get('/', (req, res) => {

res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ATLAS AI</title>

<style>
*{box-sizing:border-box}
body{
margin:0;padding:20px;background:#09090b;color:#fafafa;
font-family:Arial,sans-serif;height:100vh
}
.app{
max-width:850px;height:calc(100vh - 40px);
margin:auto;display:flex;flex-direction:column
}
header{
display:flex;justify-content:space-between;
align-items:center;padding-bottom:14px;
border-bottom:1px solid #27272a
}
.brand{
display:flex;align-items:center;gap:10px;
font-weight:600;font-size:14px;letter-spacing:.05em
}
.dot{
width:8px;height:8px;border-radius:50%;
background:#10b981
}
.pill{
background:#121215;color:#fafafa;
border:1px solid #27272a;padding:6px 12px;
border-radius:6px;font-size:12px;
text-decoration:none;cursor:pointer;margin-left:8px
}
.pill.active{border-color:#10b981;color:#10b981}
#status{font-size:12px;color:#71717a;padding:8px 0}
#chat{
flex:1;overflow-y:auto;padding:12px 0;
display:flex;flex-direction:column;gap:16px;
scrollbar-width:none
}
#chat::-webkit-scrollbar{display:none}
.entry{
display:flex;flex-direction:column;gap:4px;
max-width:80%
}
.user-entry{align-self:flex-end;align-items:flex-end}
.bot-entry{align-self:flex-start;align-items:flex-start}
.role{
font-size:10px;text-transform:uppercase;
letter-spacing:.06em;color:#71717a;
font-weight:600;padding:0 4px
}
.content{
font-size:14px;line-height:1.65;padding:12px 16px;
border-radius:12px;border:1px solid #27272a;
overflow-wrap:anywhere
}
.bot-text{
background:#121215;color:#e4e4e7;
border-bottom-left-radius:3px
}
.user-text{
background:#1e293b;border-color:#334155;
color:#f8fafc;white-space:pre-wrap;
border-bottom-right-radius:3px
}
.content h1,.content h2,.content h3{
color:#fff;margin:10px 0 4px;
font-size:15.5px;font-weight:600
}
.content strong{color:#fff}
.content li{margin-left:18px;margin-bottom:3px}
.content pre{
overflow-x:auto;background:#09090b;
padding:10px;border-radius:6px
}
.content code{color:#a7f3d0}
.composer{
margin-top:10px;background:#121215;
border:1px solid #27272a;border-radius:12px;
padding:10px 12px;display:flex;
align-items:flex-end;gap:10px
}
textarea{
flex:1;background:transparent;border:none;
color:#fafafa;font-family:inherit;
font-size:14px;line-height:22px;
min-height:60px;max-height:260px;
overflow-y:auto;resize:vertical;outline:none
}
button.submit{
background:#fafafa;color:#09090b;border:none;
border-radius:8px;padding:7px 14px;
font-size:13px;font-weight:600;cursor:pointer
}
button:disabled{opacity:.5;cursor:not-allowed}
@media(max-width:600px){
body{padding:12px}
.app{height:calc(100vh - 24px)}
.entry{max-width:95%}
}
</style>
</head>

<body>
<div class="app">

<header>
<div class="brand">
<span class="dot"></span>
ATLAS
</div>

<div>
<a href="/login" class="pill">Connect Google</a>
<button id="voiceBtn" class="pill" onclick="toggleVoice()">Voice Off</button>
</div>
</header>

<div id="status">System ready.</div>

<div id="chat">
<div class="entry bot-entry">
<div class="role">Atlas</div>
<div class="content bot-text">
Atlas connected and standing by.
</div>
</div>
</div>

<div class="composer">
<textarea id="input" placeholder="Message Atlas..." onkeydown="handleKey(event)"></textarea>
<button class="submit" id="sendBtn" onclick="send()">Send</button>
</div>

</div>

<script>

function escapeHTML(value){
return String(value)
.replace(/&/g,'&amp;')
.replace(/</g,'&lt;')
.replace(/>/g,'&gt;')
.replace(/"/g,'&quot;')
.replace(/'/g,'&#039;');
}

function parseMD(text){
return escapeHTML(text)
.replace(/\\*\\*(.*?)\\*\\*/g,'<strong>$1</strong>')
.replace(/^### (.*)$/gm,'<h3>$1</h3>')
.replace(/^## (.*)$/gm,'<h2>$1</h2>')
.replace(/^# (.*)$/gm,'<h1>$1</h1>')
.replace(/^- (.*)$/gm,'<li>$1</li>')
.replace(/^---$/gm,'<hr>')
.replace(/\\n/g,'<br>');
}

function addMsg(role,text,isUser){
const chat=document.getElementById('chat');
const entry=document.createElement('div');
entry.className='entry '+(isUser?'user-entry':'bot-entry');

const label=document.createElement('div');
label.className='role';
label.textContent=role;

const content=document.createElement('div');
content.className='content '+(isUser?'user-text':'bot-text');

if(isUser){
content.textContent=text;
}else{
content.innerHTML=parseMD(text);
}

entry.appendChild(label);
entry.appendChild(content);
chat.appendChild(entry);
chat.scrollTop=chat.scrollHeight;
}

async function send(sp=null,voice=false){
const input=document.getElementById('input');
const button=document.getElementById('sendBtn');
const message=sp||input.value.trim();

if(!message||button.disabled)return;

addMsg('You',message,true);

if(!voice){
input.value='';
input.style.height='60px';
}

button.disabled=true;
document.getElementById('status').textContent='Atlas is thinking...';

try{
const response=await fetch('/chat',{
method:'POST',
headers:{'Content-Type':'application/json'},
body:JSON.stringify({message})
});

const data=await response.json();

if(!response.ok)throw new Error(data.reply||'Server error');

addMsg('Atlas',data.reply,false);

document.getElementById('status').textContent=
'Atlas connected and standing by.';

if(voice)speak(data.reply);

}catch(error){
addMsg('Atlas','Connection error: '+error.message,false);
document.getElementById('status').textContent='Connection error.';
}finally{
button.disabled=false;
}
}

function handleKey(event){
if(event.key==='Enter'&&!event.shiftKey){
event.preventDefault();
send();
}
}

let voiceActive=false;
let recognition=null;

function toggleVoice(){
const button=document.getElementById('voiceBtn');
const status=document.getElementById('status');

if(!voiceActive){
const SR=window.SpeechRecognition||window.webkitSpeechRecognition;

if(!SR){
status.textContent='Voice unavailable in this browser.';
return;
}

recognition=new SR();
recognition.continuous=false;
recognition.interimResults=true;
recognition.lang='en-US';

recognition.onresult=function(event){
const result=event.results[event.results.length-1];
const transcript=result[0].transcript.trim();

status.textContent='Input: '+transcript;

if(result.isFinal&&transcript.toLowerCase().includes('atlas')){
send(transcript,true);
}
};

recognition.onerror=function(event){
if(event.error!=='no-speech'&&event.error!=='aborted'){
status.textContent='Audio error: '+event.error;
}
};

recognition.onend=function(){
if(voiceActive&&!window.speechSynthesis.speaking){
setTimeout(()=>{
if(voiceActive){
try{recognition.start()}catch(e){}
}
},250);
}
};

try{
recognition.start();
voiceActive=true;
button.textContent='Listening';
button.classList.add('active');
status.textContent='Hands-free active.';
}catch(error){
status.textContent='Could not start voice recognition.';
}

}else{
voiceActive=false;
if(recognition)recognition.stop();
window.speechSynthesis.cancel();
button.textContent='Voice Off';
button.classList.remove('active');
status.textContent='Voice disabled.';
}
}

function speak(text){
if(!voiceActive||!text)return;

if(recognition)recognition.stop();

const utterance=new SpeechSynthesisUtterance(
text.replace(/[*#_|-]/g,'')
);

utterance.onend=function(){
if(voiceActive&&recognition){
try{recognition.start()}catch(e){}
}
};

window.speechSynthesis.speak(utterance);
}

</script>
</body>
</html>`);

});

// =====================================
// GOOGLE LOGIN
// =====================================

app.get('/login',(req,res)=>{
const base='https://www.googleapis.com/auth/';

const scopes=[
'gmail.modify',
'calendar',
'tasks',
'documents',
'drive',
'spreadsheets'
].map(scope=>base+scope);

const url=oauth2Client.generateAuthUrl({
access_type:'offline',
prompt:'consent',
scope
});

res.redirect(url);
});

// =====================================
// GOOGLE CALLBACK
// =====================================

app.get('/api/auth/callback/google',async(req,res)=>{
try{
const {tokens}=await oauth2Client.getToken(req.query.code);

savedTokens=tokens;
oauth2Client.setCredentials(tokens);

await syncMemory();

res.redirect('/');
}catch(error){
console.error('Google OAuth error:',error);
res.status(500).send('Google authentication failed.');
}
});

// =====================================
// CHAT API
// =====================================

app.post('/chat',async(req,res)=>{
try{
const message=req.body?.message;

if(typeof message!=='string'||!message.trim()){
return res.status(400).json({reply:'Please enter a message.'});
}

const cleanMessage=message.trim();
const lowerMessage=cleanMessage.toLowerCase();

if(
lowerMessage.includes('my name')||
lowerMessage.includes('remember')||
lowerMessage.includes('save')
){
systemMemory+='\nFact: '+cleanMessage.slice(0,300);
}

const messages=[
{
role:'system',
content:
'You are Atlas, a helpful AI assistant. '+
'Be accurate, clear, and helpful.\n'+
systemMemory.slice(0,1500)
},
...chatHistory.slice(-6),
{
role:'user',
content:cleanMessage.slice(0,2500)
}
];

let completion=await groq.chat.completions.create({
messages,
model:'openai/gpt-oss-120b',
...(tools.length?{tools,tool_choice:'auto'}:{})
});

let assistantMessage=completion.choices[0].message;

if(assistantMessage.tool_calls?.length){
messages.push(assistantMessage);

for(const tc of assistantMessage.tool_calls){
try{
const args=JSON.parse(tc.function.arguments||'{}');

const result=await runTool(tc.function.name,args);

messages.push({
role:'tool',
tool_call_id:tc.id,
content:String(result).slice(0,1500)
});

}catch(error){
messages.push({
role:'tool',
tool_call_id:tc.id,
content:JSON.stringify({error:'Tool execution failed.'})
});
}
}

completion=await groq.chat.completions.create({
messages,
model:'openai/gpt-oss-120b'
});

assistantMessage=completion.choices[0].message;
}

const reply=assistantMessage.content||'Action completed.';

chatHistory.push(
{role:'user',content:cleanMessage.slice(0,800)},
{role:'assistant',content:reply.slice(0,800)}
);

if(chatHistory.length>6){
chatHistory=chatHistory.slice(-6);
}

await syncMemory();

res.json({reply});

}catch(error){
console.error('Atlas error:',error);
res.status(500).json({
reply:'Atlas encountered an error. Please try again.'
});
}
});

// =====================================
// START SERVER
// =====================================

app.listen(PORT,()=>{
console.log('Atlas running on port '+PORT);
});
