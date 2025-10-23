const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');
const { executeQuery } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Create uploads directory if it doesn't exist
const createUploadDir = async (dir) => {
  try {
    await fs.access(dir);
  } catch (error) {
    await fs.mkdir(dir, { recursive: true });
  }
};

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads', file.fieldname);
    await createUploadDir(uploadDir);
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = uuidv4();
    const ext = path.extname(file.originalname);
    cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Allow images, videos, audio, and documents
    const allowedMimes = [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'video/mp4', 'video/webm', 'video/ogg',
      'audio/mpeg', 'audio/wav', 'audio/ogg',
      'application/pdf', 'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain'
    ];

    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} not allowed`));
    }
  }
});

// Upload image
router.post('/image', [authenticateToken, upload.single('image')], async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const userId = req.user.id;
    const filePath = req.file.path;
    const fileName = req.file.filename;
    const originalName = req.file.originalname;
    const mimeType = req.file.mimetype;
    const fileSize = req.file.size;

    // Process image with Sharp (resize and optimize)
    const processedFileName = fileName.replace(path.extname(fileName), '_processed.jpg');
    const processedFilePath = path.join(path.dirname(filePath), processedFileName);

    await sharp(filePath)
      .resize(1920, 1080, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toFile(processedFilePath);

    // Delete original file
    await fs.unlink(filePath);

    const fileUrl = `/uploads/image/${processedFileName}`;

    // Store file info in database
    await executeQuery(
      'INSERT INTO file_uploads (user_id, original_name, stored_name, file_path, file_size, mime_type, is_public) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [userId, originalName, processedFileName, fileUrl, fileSize, 'image/jpeg', true]
    );

    // Log activity
    await executeQuery(
      'INSERT INTO user_activity (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
      [userId, 'file_upload', JSON.stringify({ type: 'image', file_name: processedFileName }), req.ip]
    );

    res.json({
      message: 'Image uploaded successfully',
      fileUrl,
      fileName: processedFileName,
      originalName,
      fileSize
    });
  } catch (error) {
    console.error('Image upload error:', error);
    res.status(500).json({ error: 'Failed to upload image' });
  }
});

// Upload file
router.post('/file', [authenticateToken, upload.single('file')], async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const userId = req.user.id;
    const fileName = req.file.filename;
    const originalName = req.file.originalname;
    const mimeType = req.file.mimetype;
    const fileSize = req.file.size;
    const fileUrl = `/uploads/file/${fileName}`;

    // Store file info in database
    await executeQuery(
      'INSERT INTO file_uploads (user_id, original_name, stored_name, file_path, file_size, mime_type, is_public) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [userId, originalName, fileName, fileUrl, fileSize, mimeType, true]
    );

    // Log activity
    await executeQuery(
      'INSERT INTO user_activity (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
      [userId, 'file_upload', JSON.stringify({ type: 'file', file_name: fileName }), req.ip]
    );

    res.json({
      message: 'File uploaded successfully',
      fileUrl,
      fileName,
      originalName,
      fileSize,
      mimeType
    });
  } catch (error) {
    console.error('File upload error:', error);
    res.status(500).json({ error: 'Failed to upload file' });
  }
});

// Upload avatar (separate endpoint for better handling)
router.post('/avatar', [authenticateToken, upload.single('avatar')], async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const userId = req.user.id;
    const filePath = req.file.path;
    const fileName = req.file.filename;
    const originalName = req.file.originalname;
    const mimeType = req.file.mimetype;
    const fileSize = req.file.size;

    // Process avatar with Sharp (resize to square)
    const processedFileName = fileName.replace(path.extname(fileName), '_processed.jpg');
    const processedFilePath = path.join(path.dirname(filePath), processedFileName);

    await sharp(filePath)
      .resize(200, 200, { fit: 'cover' })
      .jpeg({ quality: 90 })
      .toFile(processedFilePath);

    // Delete original file
    await fs.unlink(filePath);

    const fileUrl = `/uploads/avatar/${processedFileName}`;

    // Update user avatar in database
    await executeQuery(
      'UPDATE users SET avatar_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [fileUrl, userId]
    );

    // Store file info in database
    await executeQuery(
      'INSERT INTO file_uploads (user_id, original_name, stored_name, file_path, file_size, mime_type, is_public) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [userId, originalName, processedFileName, fileUrl, fileSize, 'image/jpeg', false]
    );

    // Log activity
    await executeQuery(
      'INSERT INTO user_activity (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
      [userId, 'avatar_upload', JSON.stringify({ file_name: processedFileName }), req.ip]
    );

    res.json({
      message: 'Avatar uploaded successfully',
      fileUrl,
      fileName: processedFileName,
      originalName,
      fileSize
    });
  } catch (error) {
    console.error('Avatar upload error:', error);
    res.status(500).json({ error: 'Failed to upload avatar' });
  }
});

// Get user's uploaded files
router.get('/my-files', authenticateToken, async (req, res) => {
  try {
    const { limit = 50, offset = 0 } = req.query;
    const userId = req.user.id;

    const files = await executeQuery(`
      SELECT 
        id, original_name, stored_name, file_path, file_size, mime_type, 
        upload_date, is_public
      FROM file_uploads 
      WHERE user_id = ?
      ORDER BY upload_date DESC
      LIMIT ? OFFSET ?
    `, [userId, parseInt(limit), parseInt(offset)]);

    res.json({ files });
  } catch (error) {
    console.error('Get user files error:', error);
    res.status(500).json({ error: 'Failed to get user files' });
  }
});

// Delete file
router.delete('/file/:fileId', authenticateToken, async (req, res) => {
  try {
    const { fileId } = req.params;
    const userId = req.user.id;

    // Check if file exists and belongs to user
    const files = await executeQuery(
      'SELECT file_path, stored_name FROM file_uploads WHERE id = ? AND user_id = ?',
      [fileId, userId]
    );

    if (files.length === 0) {
      return res.status(404).json({ error: 'File not found' });
    }

    const file = files[0];

    // Delete file from filesystem
    try {
      const fullPath = path.join(__dirname, '..', file.file_path);
      await fs.unlink(fullPath);
    } catch (error) {
      console.error('Error deleting file from filesystem:', error);
      // Continue with database deletion even if file system deletion fails
    }

    // Delete file record from database
    await executeQuery('DELETE FROM file_uploads WHERE id = ?', [fileId]);

    // Log activity
    await executeQuery(
      'INSERT INTO user_activity (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
      [userId, 'file_delete', JSON.stringify({ file_id: fileId, file_name: file.stored_name }), req.ip]
    );

    res.json({ message: 'File deleted successfully' });
  } catch (error) {
    console.error('Delete file error:', error);
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

// Get file info
router.get('/file/:fileId', authenticateToken, async (req, res) => {
  try {
    const { fileId } = req.params;
    const userId = req.user.id;

    const files = await executeQuery(
      'SELECT * FROM file_uploads WHERE id = ? AND (user_id = ? OR is_public = TRUE)',
      [fileId, userId]
    );

    if (files.length === 0) {
      return res.status(404).json({ error: 'File not found' });
    }

    res.json({ file: files[0] });
  } catch (error) {
    console.error('Get file info error:', error);
    res.status(500).json({ error: 'Failed to get file info' });
  }
});

module.exports = router;
