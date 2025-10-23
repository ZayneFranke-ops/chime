const express = require('express');
const { body, validationResult } = require('express-validator');
const { executeQuery } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs').promises;

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/avatars/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `avatar-${uniqueSuffix}${path.extname(file.originalname)}`);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed for avatars'));
    }
  }
});

// Get user profile
router.get('/profile/:userId?', authenticateToken, async (req, res) => {
  try {
    const userId = req.params.userId || req.user.id;
    
    const users = await executeQuery(`
      SELECT 
        id, username, email, display_name, bio, avatar_url, 
        status, last_seen, created_at, is_verified, 
        theme_preference, notification_settings, privacy_settings
      FROM users 
      WHERE id = ? AND is_banned = FALSE
    `, [userId]);

    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = users[0];
    
    // Parse JSON fields
    user.notification_settings = JSON.parse(user.notification_settings || '{}');
    user.privacy_settings = JSON.parse(user.privacy_settings || '{}');

    res.json({ user });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Failed to get profile' });
  }
});

// Update user profile
router.put('/profile', [
  authenticateToken,
  body('display_name').optional().isLength({ min: 1, max: 100 }).withMessage('Display name must be between 1 and 100 characters'),
  body('bio').optional().isLength({ max: 500 }).withMessage('Bio must be less than 500 characters'),
  body('theme_preference').optional().isIn(['dark', 'light']).withMessage('Invalid theme preference')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { display_name, bio, theme_preference, notification_settings, privacy_settings } = req.body;
    const userId = req.user.id;

    const updateFields = [];
    const updateValues = [];

    if (display_name !== undefined) {
      updateFields.push('display_name = ?');
      updateValues.push(display_name);
    }

    if (bio !== undefined) {
      updateFields.push('bio = ?');
      updateValues.push(bio);
    }

    if (theme_preference !== undefined) {
      updateFields.push('theme_preference = ?');
      updateValues.push(theme_preference);
    }

    if (notification_settings !== undefined) {
      updateFields.push('notification_settings = ?');
      updateValues.push(JSON.stringify(notification_settings));
    }

    if (privacy_settings !== undefined) {
      updateFields.push('privacy_settings = ?');
      updateValues.push(JSON.stringify(privacy_settings));
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updateValues.push(userId);

    await executeQuery(
      `UPDATE users SET ${updateFields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      updateValues
    );

    // Log activity
    await executeQuery(
      'INSERT INTO user_activity (user_id, action, ip_address) VALUES (?, ?, ?)',
      [userId, 'profile_update', req.ip]
    );

    // Get updated user data
    const users = await executeQuery(`
      SELECT 
        id, username, email, display_name, bio, avatar_url, 
        status, last_seen, created_at, is_verified,
        theme_preference, notification_settings, privacy_settings
      FROM users 
      WHERE id = ?
    `, [userId]);

    const user = users[0];
    user.notification_settings = JSON.parse(user.notification_settings || '{}');
    user.privacy_settings = JSON.parse(user.privacy_settings || '{}');

    res.json({ message: 'Profile updated successfully', user });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Upload avatar
router.post('/avatar', [authenticateToken, upload.single('avatar')], async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const userId = req.user.id;
    const filePath = req.file.path;
    const fileName = req.file.filename;

    // Process image with Sharp (resize and optimize)
    await sharp(filePath)
      .resize(200, 200, { fit: 'cover' })
      .jpeg({ quality: 90 })
      .toFile(filePath.replace(path.extname(filePath), '_processed.jpg'));

    // Delete original file
    await fs.unlink(filePath);

    // Update filename to processed version
    const processedFileName = fileName.replace(path.extname(fileName), '_processed.jpg');
    const avatarUrl = `/uploads/avatars/${processedFileName}`;

    // Update user avatar in database
    await executeQuery(
      'UPDATE users SET avatar_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [avatarUrl, userId]
    );

    // Log activity
    await executeQuery(
      'INSERT INTO user_activity (user_id, action, ip_address) VALUES (?, ?, ?)',
      [userId, 'avatar_upload', req.ip]
    );

    res.json({ message: 'Avatar uploaded successfully', avatarUrl });
  } catch (error) {
    console.error('Avatar upload error:', error);
    res.status(500).json({ error: 'Failed to upload avatar' });
  }
});

// Get online users
router.get('/online', authenticateToken, async (req, res) => {
  try {
    const users = await executeQuery(`
      SELECT 
        id, username, display_name, avatar_url, status, last_seen
      FROM users 
      WHERE status = 'online' AND is_banned = FALSE
      ORDER BY last_seen DESC
      LIMIT 100
    `);

    res.json({ users });
  } catch (error) {
    console.error('Get online users error:', error);
    res.status(500).json({ error: 'Failed to get online users' });
  }
});

// Search users
router.get('/search', authenticateToken, async (req, res) => {
  try {
    const { q, limit = 20 } = req.query;
    
    if (!q || q.length < 2) {
      return res.status(400).json({ error: 'Search query must be at least 2 characters' });
    }

    const users = await executeQuery(`
      SELECT 
        id, username, display_name, avatar_url, status, last_seen
      FROM users 
      WHERE (username LIKE ? OR display_name LIKE ?) 
        AND is_banned = FALSE 
        AND id != ?
      ORDER BY 
        CASE WHEN username LIKE ? THEN 1 ELSE 2 END,
        last_seen DESC
      LIMIT ?
    `, [`%${q}%`, `%${q}%`, req.user.id, `${q}%`, parseInt(limit)]);

    res.json({ users });
  } catch (error) {
    console.error('Search users error:', error);
    res.status(500).json({ error: 'Failed to search users' });
  }
});

// Update user status
router.put('/status', [
  authenticateToken,
  body('status').isIn(['online', 'away', 'busy', 'offline']).withMessage('Invalid status')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { status } = req.body;
    const userId = req.user.id;

    await executeQuery(
      'UPDATE users SET status = ?, last_seen = CURRENT_TIMESTAMP WHERE id = ?',
      [status, userId]
    );

    // Log activity
    await executeQuery(
      'INSERT INTO user_activity (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
      [userId, 'status_update', JSON.stringify({ status }), req.ip]
    );

    res.json({ message: 'Status updated successfully', status });
  } catch (error) {
    console.error('Update status error:', error);
    res.status(500).json({ error: 'Failed to update status' });
  }
});

// Get user activity
router.get('/activity', authenticateToken, async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    const userId = req.user.id;

    const activities = await executeQuery(`
      SELECT 
        action, details, ip_address, created_at
      FROM user_activity 
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `, [userId, parseInt(limit)]);

    res.json({ activities });
  } catch (error) {
    console.error('Get activity error:', error);
    res.status(500).json({ error: 'Failed to get activity' });
  }
});

module.exports = router;
