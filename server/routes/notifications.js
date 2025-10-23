const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { executeQuery } = require('../config/database');

const router = express.Router();

// Get user notifications
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { limit = 50, offset = 0, unread_only = false } = req.query;
    const userId = req.user.id;

    let query = `
      SELECT 
        id, type, title, content, data, is_read, created_at
      FROM notifications 
      WHERE user_id = ?
    `;
    
    const params = [userId];
    
    if (unread_only === 'true') {
      query += ' AND is_read = FALSE';
    }
    
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const notifications = await executeQuery(query, params);

    // Parse JSON data field
    notifications.forEach(notification => {
      if (notification.data) {
        notification.data = JSON.parse(notification.data);
      }
    });

    res.json({ notifications });
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({ error: 'Failed to get notifications' });
  }
});

// Mark notification as read
router.put('/:notificationId/read', authenticateToken, async (req, res) => {
  try {
    const { notificationId } = req.params;
    const userId = req.user.id;

    // Check if notification belongs to user
    const notifications = await executeQuery(
      'SELECT id FROM notifications WHERE id = ? AND user_id = ?',
      [notificationId, userId]
    );

    if (notifications.length === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    // Mark as read
    await executeQuery(
      'UPDATE notifications SET is_read = TRUE WHERE id = ?',
      [notificationId]
    );

    res.json({ message: 'Notification marked as read' });
  } catch (error) {
    console.error('Mark notification read error:', error);
    res.status(500).json({ error: 'Failed to mark notification as read' });
  }
});

// Mark all notifications as read
router.put('/mark-all-read', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    await executeQuery(
      'UPDATE notifications SET is_read = TRUE WHERE user_id = ? AND is_read = FALSE',
      [userId]
    );

    res.json({ message: 'All notifications marked as read' });
  } catch (error) {
    console.error('Mark all notifications read error:', error);
    res.status(500).json({ error: 'Failed to mark all notifications as read' });
  }
});

// Delete notification
router.delete('/:notificationId', authenticateToken, async (req, res) => {
  try {
    const { notificationId } = req.params;
    const userId = req.user.id;

    // Check if notification belongs to user
    const notifications = await executeQuery(
      'SELECT id FROM notifications WHERE id = ? AND user_id = ?',
      [notificationId, userId]
    );

    if (notifications.length === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    // Delete notification
    await executeQuery(
      'DELETE FROM notifications WHERE id = ?',
      [notificationId]
    );

    res.json({ message: 'Notification deleted successfully' });
  } catch (error) {
    console.error('Delete notification error:', error);
    res.status(500).json({ error: 'Failed to delete notification' });
  }
});

// Get unread notification count
router.get('/unread-count', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await executeQuery(
      'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = FALSE',
      [userId]
    );

    const unreadCount = result[0].count;

    res.json({ unreadCount });
  } catch (error) {
    console.error('Get unread count error:', error);
    res.status(500).json({ error: 'Failed to get unread count' });
  }
});

// Create notification (for internal use)
router.post('/create', [
  authenticateToken,
  // This endpoint should be restricted to admin users in production
], async (req, res) => {
  try {
    const { user_id, type, title, content, data } = req.body;

    if (!user_id || !type || !title) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    await executeQuery(
      'INSERT INTO notifications (user_id, type, title, content, data) VALUES (?, ?, ?, ?, ?)',
      [user_id, type, title, content, data ? JSON.stringify(data) : null]
    );

    res.status(201).json({ message: 'Notification created successfully' });
  } catch (error) {
    console.error('Create notification error:', error);
    res.status(500).json({ error: 'Failed to create notification' });
  }
});

module.exports = router;
