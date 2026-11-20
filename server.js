
const express = require('express');
const cors = require('cors');
const Groq = require('groq-sdk');
const { google } = require('googleapis');

require('dotenv').config();

// ==========================================
// INITIALIZATION
// ==========================================

const app = express();

app.use(cors());
app.use(express.json());

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
});

const redirectUri = Buffer.from(
    'aHR0cHM6Ly9hdGxhcy1ib3QtbXVqdS5vbnJlbmRlci5jb20vYXBpL2F1dGgvY2FsbGJhY2svZ29vZ2xl',
    'base64'
).toString('utf8');

const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri
);

// ==========================================
// MEMORY VARIABLES
// ==========================================

let savedTokens = null;
let memoryFileId = null;
let chatHistory = [];

let systemMemory =
    "Your name is Atlas. Executive assistant for Aamir Khan Pathan (FRC Team 5719 Business Lead & Web Design). Be clear and concise.";

// ==========================================
// GOOGLE DRIVE MEMORY SYNC
// ==========================================

async function syncMemory(saveNew = false) {
    if (!savedTokens) return;

    oauth2Client.setCredentials(savedTokens);

    const drive = google.drive({
        version: 'v3',
        auth: oauth2Client
    });

    try {
        if (!memoryFileId) {
            const s = await drive.files.list({
                q: "name='Atlas_Memory.json' and trashed=false",
                fields: 'files(id)'
            });

            if (s.data.files.length) {
                memoryFileId = s.data.files.at(0).id;
            }
        }

        // LOAD EXISTING MEMORY

        if (memoryFileId && !saveNew) {
            const f = await drive.files.get({
                fileId: memoryFileId,
                alt: 'media'
            });

            if (f.data?.systemMemory) {
                systemMemory = String(f.data.systemMemory).slice(0, 1500);
            }

            if (Array.isArray(f.data?.chatHistory)) {
                chatHistory = f.data.chatHistory
                    .slice(-6)
                    .map(m => ({
                        role: m.role,
                        content: String(m.content).slice(0, 800)
                    }));
            }

            return;
        }

        // CLEAN CHAT HISTORY

        const cleanHistory = chatHistory
            .slice(-6)
            .map(m => ({
                role: m.role,
                content: String(m.content).slice(0, 800)
            }));

        const body = JSON.stringify({
            systemMemory: systemMemory.slice(0, 1500),
            chatHistory: cleanHistory
        });

        // UPDATE OR CREATE MEMORY FILE

        if (memoryFileId) {
            await drive.files.update({
                fileId: memoryFileId,
                media: {
                    mimeType: 'application/json',
                    body
                }
            });
        } else {
            const c = await drive.files.create({
                requestBody: {
                    name: 'Atlas_Memory.json',
                    mimeType: 'application/json'
                },
                media: {
                    mimeType: 'application/json',
                    body
                },
                fields: 'id'
            });

            memoryFileId = c.data.id;
        }

    } catch (e) {}
}

// ==========================================
// GMAIL INTEGRATION
// ==========================================

async function getEmails() {
    if (!savedTokens) return "Gmail not linked.";

    oauth2Client.setCredentials(savedTokens);

    const gmail = google.gmail({
        version: 'v1',
        auth: oauth2Client
    });

    const r = await gmail.users.messages.list({
        userId: 'me',
        q: 'in:sent',
        maxResults: 20
    });

    if (!r.data.messages) {
        return "No sent emails.";
    }

    let out = [];

    for (const m of r.data.messages) {
        const d = await gmail.users.messages.get({
            userId: 'me',
            id: m.id,
            format: 'metadata',
            metadataHeaders: ['To', 'Subject']
        });

        const h = d.data.payload.headers;

        out.push(
            'To:' +
            (h.find(x => x.name === 'To')?.value || '') +
            '|Subj:' +
            (h.find(x => x.name === 'Subject')?.value || '') +
            '|' +
            d.data.snippet.slice(0, 80)
        );
    }

    return out.join('\n');
}

// ==========================================
// GOOGLE DRIVE INTEGRATION
// ==========================================

async function getDrive() {
    if (!savedTokens) return "Drive not linked.";

    oauth2Client.setCredentials(savedTokens);

    const drive = google.drive({
        version: 'v3',
        auth: oauth2Client
    });

    const r = await drive.files.list({
        pageSize: 15,
        fields: 'files(id, name)'
    });

    return (
        (r.data.files || [])
            .map(f => f.name + '(' + f.id + ')')
            .join('\n') || "No files."
    );
}

// ==========================================
// ATLAS DASHBOARD
// ==========================================

app.get('/', (req, res) => {
    const dot = savedTokens ? '#10b981' : '#52525b';
    const auth = savedTokens ? 'Workspace Linked' : 'Link Google';

    const sOpen = '<' + 'script>';
    const sClose = '<' + '/script>';

    res.send([
        '<!DOCTYPE html><html><head><title>Atlas</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>',

        '*{box-sizing:border-box;margin:0;padding:0}',
        'body{font-family:-apple-system,sans-serif;background:#09090b;color:#fafafa;height:100vh;display:flex;flex-direction:column;max-width:860px;margin:0 auto;padding:20px}',
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
        '.content{font-size:14px;line-height:1.65;padding:12px 16px;border-radius:12px;border:1px solid #27272a}',
        '.bot-text{background:#121215;color:#e4e4e7;border-bottom-left-radius:3px}',
        '.user-text{background:#1e293b;border-color:#334155;color:#f8fafc;white-space:pre-wrap;border-bottom-right-radius:3px}',
        '.content h1,.content h2,.content h3{color:#fff;margin:10px 0 4px;font-size:15.5px;font-weight:600}',
        '.content strong{color:#fff;font-weight:600}',
        '.content li{margin-left:18px;margin-bottom:3px}',
        '.content hr{border:none;border-top:1px solid #27272a;margin:10px 0}',
        '.composer{margin-top:10px;background:#121215;border:1px solid #27272a;border-radius:12px;padding:10px 12px;display:flex;align-items:flex-end;gap:10px}',
        'textarea{flex:1;background:transparent;border:none;color:#fafafa;font-family:inherit;font-size:14px;line-height:22px;min-height:154px;max-height:260px;overflow-y:auto;resize:vertical;outline:none}',
        'textarea::-webkit-scrollbar{width:5px}',
        'textarea::-webkit-scrollbar-thumb{background:#3f3f46;border-radius:4px}',
        'button.submit{background:#fafafa;color:#09090b;border:none;border-radius:8px;padding:7px 14px;font-size:13px;font-weight:600;cursor:pointer}',

        '</style></head><body>',

        // HEADER

        '<header><div class="brand"><span class="dot"></span><span>ATLAS</span></div>',
        '<div><button id="voiceBtn" class="pill" onclick="toggleVoice()">Voice Off</button><a href="/login" class="pill">' + auth + '</a></div></header>',

        '<div id="status">System ready.</div>',

        // CHAT WINDOW

        '<div id="chat"><div class="entry bot-entry"><div class="role">Atlas</div><div class="content bot-text">Connected and standing by.</div></div></div>',

        // MESSAGE COMPOSER

        '<div class="composer"><textarea id="input" rows="7" placeholder="Write a command..." oninput="this.style.height=\'154px\';this.style.height=Math.min(Math.max(this.scrollHeight,154),260)+\'px\'" onkeydown="if(event.key===\'Enter\'&&!event.shiftKey){event.preventDefault();send();}"></textarea>',
        '<button class="submit" onclick="send()">Send</button></div>' + sOpen,

        // MARKDOWN PARSER

        'function parseMD(t){var b=t.split("**").map(function(p,i){return i%2===1?"<strong>"+p+"</strong>":p;}).join("");return b.split(String.fromCharCode(10)).map(function(l){if(l.startsWith("### "))return "<h3>"+l.slice(4)+"</h3>";if(l.startsWith("## "))return "<h2>"+l.slice(3)+"</h2>";if(l.startsWith("# "))return "<h1>"+l.slice(2)+"</h1>";if(l.trim()==="---")return "<hr>";if(l.startsWith("- ")||l.startsWith("* "))return "<li>"+l.slice(2)+"</li>";return l;}).join("<br>");}',

        // VOICE VARIABLES

        'let voiceActive=false,rec=null;',

        // VOICE RECOGNITION

        'function toggleVoice(){const b=document.getElementById("voiceBtn"),s=document.getElementById("status");if(!voiceActive){const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR){s.innerText="Voice unavailable.";return;}rec=new SR();rec.continuous=false;rec.interimResults=true;rec.lang="en-US";rec.onresult=(e)=>{const l=Array.from(e.results).at(-1),t=Array.from(l).at(0).transcript.trim();s.innerText="Input: "+t;if(l.isFinal&&t.toLowerCase().includes("atlas"))send(t,true);};rec.onerror=(e)=>{if(e.error!=="no-speech"&&e.error!=="aborted")s.innerText="Audio: "+e.error;};rec.onend=()=>{if(voiceActive&&!window.speechSynthesis.speaking)setTimeout(()=>{try{rec.start();}catch(e){}},150);};rec.start();voiceActive=true;b.innerText="Listening";b.classList.add("active");s.innerText="Hands-free active.";}else{voiceActive=false;if(rec)rec.stop();window.speechSynthesis.cancel();b.innerText="Voice Off";b.classList.remove("active");s.innerText="Voice disabled.";}}',

        // TEXT-TO-SPEECH

        'function speak(t){if(!voiceActive)return;if(rec)rec.stop();const u=new SpeechSynthesisUtterance(t.replace(/[*#_|-]/g,""));u.onend=()=>{if(voiceActive&&rec)try{rec.start();}catch(e){}};window.speechSynthesis.speak(u);}',

        // ADD CHAT MESSAGE

        'function addMsg(r,t,u){const c=document.getElementById("chat"),d=document.createElement("div");d.className="entry "+(u?"user-entry":"bot-entry");d.innerHTML="<div class=\'role\'>"+r+"</div><div class=\'content "+(u?"user-text":"bot-text")+"\'></div>";const ct=d.querySelector(".content");if(u)ct.textContent=t;else ct.innerHTML=parseMD(t);c.appendChild(d);c.scrollTop=c.scrollHeight;}',

        // SEND CHAT MESSAGE

        'async function send(sp=null,v=false){const i=document.getElementById("input"),t=sp||i.value.trim();if(!t)return;addMsg("You",t,true);if(!v){i.value="";i.style.height="154px";}const r=await fetch("/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message:t})});const d=await r.json();addMsg("Atlas",d.reply,false);if(v)speak(d.reply);}',

        sClose + '</body></html>'
    ].join(''));
});

// ==========================================
// GOOGLE OAUTH LOGIN
// ==========================================

app.get('/login', (req, res) => {
    const base = Buffer.from(
        'aHR0cHM6Ly93d3cuZ29vZ2xlYXBpcy5jb20vYXV0aC8=',
        'base64'
    ).toString('utf8');

    res.redirect(
        oauth2Client.generateAuthUrl({
            access_type: 'offline',
            prompt: 'consent',
            scope: [
                'gmail.modify',
                'calendar',
                'tasks',
                'documents',
                'drive',
                'spreadsheets'
            ].map(s => base + s)
        })
    );
});

// ==========================================
// GOOGLE OAUTH CALLBACK
// ==========================================

app.get('/api/auth/callback/google', async (req, res) => {
    try {
        const { tokens } = await oauth2Client.getToken(req.query.code);

        savedTokens = tokens;

        oauth2Client.setCredentials(tokens);

        await syncMemory(false);
        await syncMemory(true);

        res.redirect('/');

    } catch (e) {
        res.status(500).send(e.message);
    }
});

// ==========================================
// AI CHAT ENDPOINT
// ==========================================

app.post('/chat', async (req, res) => {
    try {
        const { message } = req.body;
        const l = message.toLowerCase();

        // MEMORY DETECTION

        if (
            l.includes('my name') ||
            l.includes('remember') ||
            l.includes('5719') ||
            l.includes('save')
        ) {
            systemMemory += '\nFact: ' + message.slice(0, 300);
        }

        // CONTEXT RETRIEVAL

        let ctx = '';

        if (
            l.includes('gmail') ||
            l.includes('email') ||
            l.includes('sent')
        ) {
            ctx += '\n\n[SENT EMAILS]:\n' + await getEmails();
        }

        if (
            l.includes('drive') ||
            l.includes('sheet') ||
            l.includes('doc')
        ) {
            ctx += '\n\n[DRIVE]:\n' + await getDrive();
        }

        // RECENT CHAT HISTORY

        const recent = chatHistory
            .slice(-6)
            .map(m => ({
                role: m.role,
                content: String(m.content).slice(0, 800)
            }));

        // GROQ AI COMPLETION

        const comp = await groq.chat.completions.create({
            messages: [
                {
                    role: 'system',
                    content: systemMemory.slice(0, 1500)
                },
                ...recent,
                {
                    role: 'user',
                    content: (message + ctx).slice(0, 3500)
                }
            ],
            model: 'openai/gpt-oss-120b'
        });

        const reply = comp.choices.at(0).message.content;

        // UPDATE CHAT HISTORY

        chatHistory.push(
            {
                role: 'user',
                content: message.slice(0, 800)
            },
            {
                role: 'assistant',
                content: reply.slice(0, 800)
            }
        );

        if (chatHistory.length > 6) {
            chatHistory = chatHistory.slice(-6);
        }

        // SAVE MEMORY

        await syncMemory(true);

        res.json({ reply });

    } catch (e) {
        res.json({
            reply: 'Error: ' + e.message
        });
    }
});

// ==========================================
// START SERVER
// ==========================================

app.listen(
    process.env.PORT || 3000,
    () => console.log('Atlas running')
);
