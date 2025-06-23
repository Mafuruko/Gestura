const express = require("express");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
const bcrypt = require("bcrypt");
const path = require("path");
const cors = require("cors");
const multer = require("multer");
const { exec } = require("child_process");
const fs = require("fs");

const User = require("./models/User");
const Video = require("./models/Video");
const Dictionary = require("./models/Dictionary");

const app = express();
app.use(bodyParser.json());
app.use(express.static("public"));
app.use(cors());

const mongoURI =
  "mongodb+srv://admin:6969@iot-logger.24cd3.mongodb.net/Gestura?retryWrites=true&w=majority&appName=Gestura";

mongoose
  .connect(mongoURI)
  .then(() => {
    console.log("MongoDB connected successfully.");
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () =>
      console.log(`Server running at http://localhost:${PORT}`)
    );
  })
  .catch((err) => {
    console.error("Failed to connect to MongoDB", err);
    process.exit(1);
  });

// === Upload Config ===
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
});

// === Upload Endpoint ===
app.post("/upload", upload.single("video"), async (req, res) => {
  try {
    const { username } = req.body;
    if (!req.file || !username)
      return res.status(400).json({ message: "Missing file or username." });

    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ message: "User not found." });

    // Simpan ke database (sementara tanpa prediksi)
    const newVideo = new Video({
      user: user._id,
      filename: req.file.originalname,
      mimetype: req.file.mimetype,
      data: req.file.buffer,
    });

    const saved = await newVideo.save();

    // Ensure temp directory exists
    const tempDir = path.join(__dirname, "temp");
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // Simpan file ke disk sementara
    const tempPath = path.join(
      tempDir,
      `${saved._id}_${req.file.originalname}`
    );

    try {
      fs.writeFileSync(tempPath, req.file.buffer);
    } catch (writeError) {
      console.error("[FILE WRITE ERROR]", writeError);
      return res.status(500).json({
        message: "Failed to write temporary file",
        error: writeError.message,
      });
    }

    // Jalankan script Python
    const pythonScriptPath = path.join(
      __dirname,
      "HandSignModel/I3D/video_input_predict.py"
    );
    const pythonCommand = `python3 "${pythonScriptPath}" "${tempPath}"`;

    console.log("[PYTHON COMMAND]", pythonCommand);

    exec(pythonCommand, { timeout: 60000 }, async (error, stdout, stderr) => {
      // Clean up temporary file
      try {
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }
      } catch (cleanupError) {
        console.error("[CLEANUP ERROR]", cleanupError);
      }

      if (error) {
        console.error("[PYTHON ERROR]", error);
        console.error("[PYTHON STDERR]", stderr);
        return res.status(500).json({
          message: "Python script failed",
          error: stderr || error.message,
        });
      }

      console.log("[PYTHON OUTPUT]", stdout);

      try {
        // Ekstrak hasil prediksi
        const match = stdout.match(
          /\[RESULT\] Terdeteksi: \d*\s*(.+?) \(([\d.]+)%\)/
        );
        const label = match?.[1]?.trim() || "Unknown";
        const confidence = parseFloat(match?.[2] || "0") / 100;

        // Tambahkan hasil prediksi ke dokumen
        saved.prediction = label;
        saved.confidence = confidence;
        await saved.save();

        return res.status(201).json({
          message: "Upload and processing successful!",
          prediction: label,
          confidence: confidence,
          file: { filename: saved.filename, id: saved._id },
        });
      } catch (parseError) {
        console.error("[PARSE ERROR]", parseError);
        // Even if parsing fails, return success with default values
        return res.status(201).json({
          message: "Upload successful, but prediction parsing failed",
          prediction: "Processing Error",
          confidence: 0,
          file: { filename: saved.filename, id: saved._id },
        });
      }
    });
  } catch (err) {
    console.error("[UPLOAD ERROR]", err);
    res.status(500).json({ message: "Upload failed.", error: err.message });
  }
});

// === Register Endpoint ===
app.post("/register", async (req, res) => {
  const { username, email, password } = req.body;
  console.log("[REGISTER] Request received:", { username, email });

  if (!username || !email || !password) {
    return res.status(400).json({ message: "All fields are required." });
  }

  try {
    const emailTaken = await User.findOne({ email });
    const usernameTaken = await User.findOne({ username });

    if (emailTaken)
      return res.status(409).json({ message: "Email already in use." });
    if (usernameTaken)
      return res.status(409).json({ message: "Username already taken." });

    const newUser = new User({ username, email, password });
    await newUser.save();
    return res.status(201).json({ message: "User registered successfully." });
  } catch (error) {
    console.error("[REGISTER ERROR]", error);
    res.status(500).json({ message: "Registration failed. Server error." });
  }
});

// === Login Endpoint ===
app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    // Bisa login pakai email ATAU username
    const user = await User.findOne({
      $or: [{ email }, { username: email }],
    });

    if (!user) return res.status(404).json({ error: "User not found" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ error: "Wrong password" });

    res.status(200).json({
      message: "Login success",
      username: user.username,
    });
  } catch (err) {
    res.status(500).json({ error: "Login error", detail: err.message });
  }
});

// === Delete Video Endpoint ===
app.delete("/api/delete-video/:videoId", async (req, res) => {
  try {
    const { videoId } = req.params;
    const { username } = req.body;

    if (!username) {
      return res.status(401).json({ message: "Username required" });
    }

    // Find the user
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Find and delete the video (make sure it belongs to the user)
    const video = await Video.findOneAndDelete({
      _id: videoId,
      user: user._id,
    });

    if (!video) {
      return res
        .status(404)
        .json({ message: "Video not found or unauthorized" });
    }

    console.log(`[DELETE] Video ${videoId} deleted by user ${username}`);
    res.status(200).json({ message: "Video deleted successfully" });
  } catch (error) {
    console.error("[DELETE VIDEO ERROR]", error);
    res
      .status(500)
      .json({ message: "Failed to delete video", error: error.message });
  }
});

// === Get History Endpoint ===
app.get("/api/history", async (req, res) => {
  const username = req.query.username;
  if (!username) return res.status(401).json({ message: "Login required" });

  try {
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ message: "User not found" });

    const videos = await Video.find({ user: user._id }).sort({
      uploadDate: -1,
    });
    res.json(videos);
  } catch (error) {
    console.error("[HISTORY ERROR]", error);
    res
      .status(500)
      .json({ message: "Failed to load history", error: error.message });
  }
});

// === Serve Video Files ===
app.get("/video/:filename", async (req, res) => {
  try {
    const file = await Video.findOne({ filename: req.params.filename });
    if (!file) return res.status(404).send("Video not found");
    res.setHeader("Content-Type", file.mimetype);
    res.send(file.data);
  } catch (err) {
    console.error("[ERROR] serve video", err);
    res.status(500).send("Server error");
  }
});

// app.get("/api/dictionary", async (req, res) => {
//   try {
//     const entries = await Dictionary.find().sort({ word: 1 });
//     res.json(entries);
//   } catch (error) {
//     res.status(500).json({ message: "Failed to fetch dictionary", error: error.message });
//   }
// });

app.get("/api/dictionary", async (req, res) => {
  try {
    const entries = await Dictionary.find().sort({ word: 1 });
    console.log("[DICTIONARY ENTRIES]", entries); // Tambahkan ini
    res.json(entries);
  } catch (error) {
    console.error("[DICTIONARY ERROR]", error);
    res.status(500).json({ message: "Failed to fetch dictionary", error: error.message });
  }
});

// === Serve Static Pages ===
app.get("/", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "index.html"))
);
app.get("/register", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "register.html"))
);
app.get("/login", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "login.html"))
);
app.get("/learn", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "learn.html"))
);
app.get("/faq", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "faq.html"))
);
app.get("/history", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "history.html"))
);

//test

