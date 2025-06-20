
// ==== File: server.js ====
const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const path = require('path');
const cors = require('cors');
const multer = require('multer');
 
const User = require('./models/User');
const Video = require('./models/Video');

const app = express();
app.use(bodyParser.json());
app.use(express.static('public')); 
app.use(cors()); 

const mongoURI = 'mongodb+srv://admin:6969@iot-logger.24cd3.mongodb.net/Gestura?retryWrites=true&w=majority&appName=Gestura';

mongoose.connect(mongoURI)
  .then(() => {
    console.log('MongoDB connected successfully.');
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
  })
  .catch(err => {
    console.error('Failed to connect to MongoDB', err);
    process.exit(1);
  });

// === Upload Config ===
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// === Upload Endpoint ===
app.post('/upload', upload.single('video'), async (req, res) => {
  try { 
  const { username } = req.body;  // username dikirim dari client
  if (!username) return res.status(401).json({ message: 'User not logged in' });

  const user = await User.findOne({ username });
  if (!user) return res.status(404).json({ message: 'User not found' });

  // lanjutkan seperti biasa—tapi sertakan user._id
  const newVideo = new Video({
    user: user._id,
    filename: req.file.originalname,
    mimetype: req.file.mimetype,
    data: req.file.buffer
  });

    const saved = await newVideo.save();

    res.status(201).json({
      message: 'Video uploaded successfully!',
      file: {
        filename: saved.filename,
        id: saved._id
      }
    });
  } catch (err) {
    console.error('[UPLOAD ERROR]', err);
    res.status(500).json({ message: 'Upload failed.', error: err.message });
  }
});

// === Register Endpoint ===
app.post('/register', async (req, res) => {
  const { username, email, password } = req.body;
  console.log('[REGISTER] Request received:', { username, email });

  if (!username || !email || !password) {
    return res.status(400).json({ message: 'All fields are required.' });
  }

  try {
    const emailTaken = await User.findOne({ email });
    const usernameTaken = await User.findOne({ username });

    if (emailTaken) return res.status(409).json({ message: 'Email already in use.' });
    if (usernameTaken) return res.status(409).json({ message: 'Username already taken.' });

    const newUser = new User({ username, email, password });
    await newUser.save();
    return res.status(201).json({ message: 'User registered successfully.' });
  } catch (error) {
    console.error('[REGISTER ERROR]', error);
    res.status(500).json({ message: 'Registration failed. Server error.' });
  }
});

// === Login Endpoint ===
app.post('/login', async (req, res) => {
  const { email, password } = req.body; 
 
  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ error: 'Email not found' });

    const isMatch = await bcrypt.compare(password, user.password); 
    if (!isMatch) return res.status(401).json({ error: 'Wrong password' });

    res.status(200).json({
      message: 'Login success',
      username: user.username
    });
  } catch (err) {
    res.status(500).json({ error: 'Login error', detail: err.message });
  }
});

app.get('/video/:filename', async (req, res) => {
  try {
    const file = await Video.findOne({ filename: req.params.filename });
    if (!file) return res.status(404).send('Not found');
    res.setHeader('Content-Type', file.mimetype);
    res.send(file.data);
  } catch (err) {
    console.error('[ERROR] serve video', err);
    res.status(500).send('Server error');
  }
});
  


// === Serve Static Pages ===
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'public', 'register.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/learn', (req, res) => res.sendFile(path.join(__dirname, 'public', 'learn.html'))); 
app.get('/faq', (req, res) => res.sendFile(path.join(__dirname, 'public', 'faq.html')));
app.get('/history', (req, res) => res.sendFile(path.join(__dirname, 'public', 'history.html')));



app.get('/api/history', async (req, res) => {
  const username = req.query.username;
  if (!username) return res.status(401).json({ message: 'Login required' });

  const user = await User.findOne({ username });
  if (!user) return res.status(404).json({ message: 'User not found' });

  const videos = await Video.find({ user: user._id }).sort({ uploadDate: -1 });
  res.json(videos);
});
