const express = require('express');
const cors = require('cors');
const Groq = require('groq-sdk');
const { google } = require('googleapis');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const redirectUri = 'https://' + 'atlas-bot-muju.onrender.com' + '/api/auth/callback/google';

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  redirectUri
);

app.get('/', (req, res) => {
  res.send('<h1>Atlas is Online and Ready!</h1><p><a href="/login">Click here to connect Atlas to your Google Account</a></p>');
});

app.get('/login', (req, res) => {
  const base = 'https://' + '://googleapis.com';
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
    oauth2Client.setCredentials(tokens);
    res.send('<h1>Success! Atlas is now connected to your Gmail, Calendar, Tasks, Docs, Drive, and Sheets!</h1>');
  } catch (err) {
    res.status(500).send('Auth error: ' + err.message);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Atlas running on port ${PORT}`));
