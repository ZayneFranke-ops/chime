const express = require('express');
const { body, validationResult } = require('express-validator');
const { executeQuery } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Get all chat rooms
router.get('/rooms', authenticateToken, async (req, res) => {
  try {
    const { type = 'public' } = req.query;
    
    let query = `
      SELECT 
        cr.*, 
        u.username as owner_username,
        u.display_name as owner_display_name,
        (SELECT COUNT(*) FROM room_members rm WHERE rm.room_id = cr.id) as member_count,
        (SELECT COUNT(*) FROM messages m WHERE m.room_id = cr.id) as message_count
      FROM chat_rooms cr
      LEFT JOIN users u ON cr.owner_id = u.id
      WHERE cr.is_active = TRUE
    `;
    
    const params = [];
    
    if (type !== 'all') {
      query += ' AND cr.type = ?';
      params.push(type);
    }
    
    // For private/group rooms, check if user is a member
    if (type === 'private' || type === 'group') {
      query += ' AND EXISTS (SELECT 1 FROM room_members rm WHERE rm.room_id = cr.id AND rm.user_id = ?)';
      params.push(req.user.id);
    }
    
    query += ' ORDER BY cr.created_at DESC';
    
    const rooms = await executeQuery(query, params);
    
    res.json({ rooms });
  } catch (error) {
    console.error('Get rooms error:', error);
    res.status(500).json({ error: 'Failed to get chat rooms' });
  }
});

// Get room details
router.get('/rooms/:roomId', authenticateToken, async (req, res) => {
  try {
    const { roomId } = req.params;
    
    const rooms = await executeQuery(`
      SELECT 
        cr.*, 
        u.username as owner_username,
        u.display_name as owner_display_name,
        (SELECT COUNT(*) FROM room_members rm WHERE rm.room_id = cr.id) as member_count
      FROM chat_rooms cr
      LEFT JOIN users u ON cr.owner_id = u.id
      WHERE cr.id = ? AND cr.is_active = TRUE
    `, [roomId]);

    if (rooms.length === 0) {
      return res.status(404).json({ error: 'Room not found' });
    }

    const room = rooms[0];

    // Check if user can access this room
    if (room.type === 'private' || room.type === 'group') {
      const members = await executeQuery(
        'SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?',
        [roomId, req.user.id]
      );
      
      if (members.length === 0) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    // Get room members for private/group rooms
    if (room.type !== 'public') {
      const members = await executeQuery(`
        SELECT 
          u.id, u.username, u.display_name, u.avatar_url, u.status,
          rm.role, rm.joined_at, rm.last_read_at, rm.is_muted
        FROM room_members rm
        JOIN users u ON rm.user_id = u.id
        WHERE rm.room_id = ?
        ORDER BY rm.role DESC, rm.joined_at ASC
      `, [roomId]);
      
      room.members = members;
    }

    res.json({ room });
  } catch (error) {
    console.error('Get room error:', error);
    res.status(500).json({ error: 'Failed to get room details' });
  }
});

// Create new room
router.post('/rooms', [
  authenticateToken,
  body('name').isLength({ min: 1, max: 100 }).withMessage('Room name must be between 1 and 100 characters'),
  body('description').optional().isLength({ max: 500 }).withMessage('Description must be less than 500 characters'),
  body('type').isIn(['public', 'private', 'group']).withMessage('Invalid room type'),
  body('max_members').optional().isInt({ min: 2, max: 1000 }).withMessage('Max members must be between 2 and 1000')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { name, description, type, max_members } = req.body;
    const userId = req.user.id;

    // Create room
    const result = await executeQuery(
      'INSERT INTO chat_rooms (name, description, type, owner_id, max_members) VALUES (?, ?, ?, ?, ?)',
      [name, description, type, userId, max_members || 1000]
    );

    const roomId = result.insertId;

    // Add creator as owner
    await executeQuery(
      'INSERT INTO room_members (room_id, user_id, role) VALUES (?, ?, ?)',
      [roomId, userId, 'owner']
    );

    // Get created room
    const rooms = await executeQuery(`
      SELECT 
        cr.*, 
        u.username as owner_username,
        u.display_name as owner_display_name
      FROM chat_rooms cr
      LEFT JOIN users u ON cr.owner_id = u.id
      WHERE cr.id = ?
    `, [roomId]);

    res.status(201).json({ 
      message: 'Room created successfully', 
      room: rooms[0] 
    });
  } catch (error) {
    console.error('Create room error:', error);
    res.status(500).json({ error: 'Failed to create room' });
  }
});

// Get messages for a room
router.get('/rooms/:roomId/messages', authenticateToken, async (req, res) => {
  try {
    const { roomId } = req.params;
    const { limit = 50, offset = 0 } = req.query;

    // Check if user can access this room
    const rooms = await executeQuery('SELECT type FROM chat_rooms WHERE id = ? AND is_active = TRUE', [roomId]);
    
    if (rooms.length === 0) {
      return res.status(404).json({ error: 'Room not found' });
    }

    const room = rooms[0];
    
    if (room.type === 'private' || room.type === 'group') {
      const members = await executeQuery(
        'SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?',
        [roomId, req.user.id]
      );
      
      if (members.length === 0) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    // Get messages
    const messages = await executeQuery(`
      SELECT 
        m.*,
        u.username, u.display_name, u.avatar_url, u.status,
        (SELECT COUNT(*) FROM message_reactions mr WHERE mr.message_id = m.id) as reaction_count,
        rm.content as reply_content,
        ru.username as reply_username,
        ru.display_name as reply_display_name
      FROM messages m
      JOIN users u ON m.user_id = u.id
      LEFT JOIN messages rm ON m.reply_to = rm.id
      LEFT JOIN users ru ON rm.user_id = ru.id
      WHERE m.room_id = ?
      ORDER BY m.created_at DESC
      LIMIT ? OFFSET ?
    `, [roomId, parseInt(limit), parseInt(offset)]);

    // Get reactions for each message
    for (let message of messages) {
      const reactions = await executeQuery(`
        SELECT 
          emoji, 
          COUNT(*) as count,
          GROUP_CONCAT(u.display_name) as users
        FROM message_reactions mr
        JOIN users u ON mr.user_id = u.id
        WHERE mr.message_id = ?
        GROUP BY emoji
      `, [message.id]);
      
      message.reactions = reactions;
    }

    // Update last read time for user
    await executeQuery(
      'UPDATE room_members SET last_read_at = CURRENT_TIMESTAMP WHERE room_id = ? AND user_id = ?',
      [roomId, req.user.id]
    );

    res.json({ messages: messages.reverse() }); // Reverse to show oldest first
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ error: 'Failed to get messages' });
  }
});

// Send message
router.post('/rooms/:roomId/messages', [
  authenticateToken,
  body('content').isLength({ min: 1, max: 2000 }).withMessage('Message must be between 1 and 2000 characters'),
  body('message_type').optional().isIn(['text', 'image', 'file', 'emoji', 'gif', 'system']).withMessage('Invalid message type'),
  body('reply_to').optional().isInt().withMessage('Invalid reply_to ID')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { roomId } = req.params;
    const { content, message_type = 'text', reply_to, file_url, file_name, file_size } = req.body;
    const userId = req.user.id;

    // Check if user can access this room
    const rooms = await executeQuery('SELECT type FROM chat_rooms WHERE id = ? AND is_active = TRUE', [roomId]);
    
    if (rooms.length === 0) {
      return res.status(404).json({ error: 'Room not found' });
    }

    const room = rooms[0];
    
    if (room.type === 'private' || room.type === 'group') {
      const members = await executeQuery(
        'SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?',
        [roomId, req.user.id]
      );
      
      if (members.length === 0) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    // Insert message
    const result = await executeQuery(
      'INSERT INTO messages (room_id, user_id, content, message_type, reply_to, file_url, file_name, file_size) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [roomId, userId, content, message_type, reply_to, file_url, file_name, file_size]
    );

    const messageId = result.insertId;

    // Get created message with user info
    const messages = await executeQuery(`
      SELECT 
        m.*,
        u.username, u.display_name, u.avatar_url, u.status,
        rm.content as reply_content,
        ru.username as reply_username,
        ru.display_name as reply_display_name
      FROM messages m
      JOIN users u ON m.user_id = u.id
      LEFT JOIN messages rm ON m.reply_to = rm.id
      LEFT JOIN users ru ON rm.user_id = ru.id
      WHERE m.id = ?
    `, [messageId]);

    const message = messages[0];
    message.reactions = []; // Initialize empty reactions

    // Update user activity
    await executeQuery(
      'INSERT INTO user_activity (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
      [userId, 'message_sent', JSON.stringify({ room_id: roomId, message_id: messageId }), req.ip]
    );

    res.status(201).json({ 
      message: 'Message sent successfully', 
      messageData: message 
    });
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// Edit message
router.put('/messages/:messageId', [
  authenticateToken,
  body('content').isLength({ min: 1, max: 2000 }).withMessage('Message must be between 1 and 2000 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { messageId } = req.params;
    const { content } = req.body;
    const userId = req.user.id;

    // Check if user owns this message
    const messages = await executeQuery(
      'SELECT user_id FROM messages WHERE id = ?',
      [messageId]
    );

    if (messages.length === 0) {
      return res.status(404).json({ error: 'Message not found' });
    }

    if (messages[0].user_id !== userId) {
      return res.status(403).json({ error: 'You can only edit your own messages' });
    }

    // Update message
    await executeQuery(
      'UPDATE messages SET content = ?, is_edited = TRUE, edited_at = CURRENT_TIMESTAMP WHERE id = ?',
      [content, messageId]
    );

    res.json({ message: 'Message updated successfully' });
  } catch (error) {
    console.error('Edit message error:', error);
    res.status(500).json({ error: 'Failed to edit message' });
  }
});

// Delete message
router.delete('/messages/:messageId', authenticateToken, async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user.id;

    // Check if user owns this message
    const messages = await executeQuery(
      'SELECT user_id FROM messages WHERE id = ?',
      [messageId]
    );

    if (messages.length === 0) {
      return res.status(404).json({ error: 'Message not found' });
    }

    if (messages[0].user_id !== userId) {
      return res.status(403).json({ error: 'You can only delete your own messages' });
    }

    // Delete message
    await executeQuery('DELETE FROM messages WHERE id = ?', [messageId]);

    res.json({ message: 'Message deleted successfully' });
  } catch (error) {
    console.error('Delete message error:', error);
    res.status(500).json({ error: 'Failed to delete message' });
  }
});

// Add reaction to message
router.post('/messages/:messageId/reactions', [
  authenticateToken,
  body('emoji').isLength({ min: 1, max: 10 }).withMessage('Invalid emoji')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { messageId } = req.params;
    const { emoji } = req.body;
    const userId = req.user.id;

    // Check if message exists
    const messages = await executeQuery('SELECT 1 FROM messages WHERE id = ?', [messageId]);
    if (messages.length === 0) {
      return res.status(404).json({ error: 'Message not found' });
    }

    // Insert or update reaction
    await executeQuery(
      'INSERT INTO message_reactions (message_id, user_id, emoji) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE emoji = VALUES(emoji)',
      [messageId, userId, emoji]
    );

    res.json({ message: 'Reaction added successfully' });
  } catch (error) {
    console.error('Add reaction error:', error);
    res.status(500).json({ error: 'Failed to add reaction' });
  }
});

// Remove reaction from message
router.delete('/messages/:messageId/reactions/:emoji', authenticateToken, async (req, res) => {
  try {
    const { messageId, emoji } = req.params;
    const userId = req.user.id;

    await executeQuery(
      'DELETE FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?',
      [messageId, userId, emoji]
    );

    res.json({ message: 'Reaction removed successfully' });
  } catch (error) {
    console.error('Remove reaction error:', error);
    res.status(500).json({ error: 'Failed to remove reaction' });
  }
});

module.exports = router;
