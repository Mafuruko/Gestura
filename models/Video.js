// const mongoose = require('mongoose');

// const VideoSchema = new mongoose.Schema({
//   filename: String, 
//   mimetype: String,
//   data: Buffer,
//   uploadDate: { type: Date, default: Date.now }
// });

// module.exports = mongoose.model('Video', VideoSchema);


const mongoose = require('mongoose');

const VideoSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  filename: String,
  mimetype: String,
  data: Buffer,
  prediction: String, 
  confidence: Number,
  uploadDate: { type: Date, default: Date.now() + 7 * 60 * 60 * 1000 }
});


module.exports = mongoose.model('Video', VideoSchema);