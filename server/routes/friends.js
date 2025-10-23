const express = require('express');
const { body, validationResult } = require('express-validator');
const { executeQuery } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Get friends list
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { status = 'accepted' } = req.query;
    const userId = req.user.id;

    let query = `
      SELECT 
        f.id, f.status, f.created_at,
        u.id as friend_id, u.username, u.display_name, u.avatar_url, u.status as friend_status, u.last_seen,
        CASE 
          WHEN f.user_id = ? THEN f.friend_id 
          ELSE f.user_id 
        END as actual_friend_id
      FROM friends f
      JOIN users u ON (
        CASE 
          WHEN f.user_id = ? THEN u.id = f.friend_id 
          ELSE u.id = f.user_id 
        END
      )
      WHERE (f.user_id = ? OR f.friend_id = ?) 
        AND f.status = ?
      ORDER BY u.display_name ASC
    `;

    const friends = await executeQuery(query, [userId, userId, userId, userId, status]);

    res.json({ friends });
  } catch (error) {
    console.error('Get friends error:', error);
    res.status(500).json({ error: 'Failed to get friends list' });
  }
});

// Get friend requests (sent and received)
router.get('/requests', authenticateToken, async (req, res) => {
  try {
    const { type = 'received' } = req.query; // 'sent' or 'received'
    const userId = req.user.id;

    let query;
    let params;

    if (type === 'sent') {
      query = `
        SELECT 
          f.id, f.created_at,
          u.id as friend_id, u.username, u.display_name, u.avatar_url, u.status
        FROM friends f
        JOIN users u ON f.friend_id = u.id
        WHERE f.user_id = ? AND f.status = 'pending'
        ORDER BY f.created_at DESC
      `;
      params = [userId];
    } else {
      query = `
        SELECT 
          f.id, f.created_at,
          u.id as friend_id, u.username, u.display_name, u.avatar_url, u.status
        FROM friends f
        JOIN users u ON f.user_id = u.id
        WHERE f.friend_id = ? AND f.status = 'pending'
        ORDER BY f.created_at DESC
      `;
      params = [userId];
    }

    const requests = await executeQuery(query, params);

    res.json({ requests });
  } catch (error) {
    console.error('Get friend requests error:', error);
    res.status(500).json({ error: 'Failed to get friend requests' });
  }
});

// Send friend request
router.post('/request', [
  authenticateToken,
  body('friend_id').isInt().withMessage('Invalid friend ID')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { friend_id } = req.body;
    const userId = req.user.id;

    if (friend_id === userId) {
      return res.status(400).json({ error: 'Cannot send friend request to yourself' });
    }

    // Check if friend exists
    const friends = await executeQuery('SELECT id FROM users WHERE id = ? AND is_banned = FALSE', [friend_id]);
    if (friends.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if friendship already exists
    const existingFriendship = await executeQuery(
      'SELECT id, status FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)',
      [userId, friend_id, friend_id, userId]
    );

    if (existingFriendship.length > 0) {
      const friendship = existingFriendship[0];
      if (friendship.status === 'pending') {
        return res.status(400).json({ error: 'Friend request already sent' });
      } else if (friendship.status === 'accepted') {
        return res.status(400).json({ error: 'Already friends' });
      } else if (friendship.status === 'blocked') {
        return res.status(400).json({ error: 'Cannot send friend request' });
      }
    }

    // Create friend request
    await executeQuery(
      'INSERT INTO friends (user_id, friend_id, status) VALUES (?, ?, ?)',
      [userId, friend_id, 'pending']
    );

    // Create notification for the friend
    await executeQuery(
      'INSERT INTO notifications (user_id, type, title, content, data) VALUES (?, ?, ?, ?, ?)',
      [
        friend_id,
        'friend_request',
        'New Friend Request',
        `${req.user.display_name} wants to be friends`,
        JSON.stringify({ from_user_id: userId, from_username: req.user.username })
      ]
    );

    // Log activity
    await executeQuery(
      'INSERT INTO user_activity (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
      [userId, 'friend_request_sent', JSON.stringify({ friend_id }), req.ip]
    );

    res.status(201).json({ message: 'Friend request sent successfully' });
  } catch (error) {
    console.error('Send friend request error:', error);
    res.status(500).json({ error: 'Failed to send friend request' });
  }
});

// Accept friend request
router.put('/accept/:requestId', authenticateToken, async (req, res) => {
  try {
    const { requestId } = req.params;
    const userId = req.user.id;

    // Check if request exists and belongs to user
    const requests = await executeQuery(
      'SELECT user_id, friend_id FROM friends WHERE id = ? AND friend_id = ? AND status = ?',
      [requestId, userId, 'pending']
    );

    if (requests.length === 0) {
      return res.status(404).json({ error: 'Friend request not found' });
    }

    const request = requests[0];

    // Update friendship status
    await executeQuery(
      'UPDATE friends SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      ['accepted', requestId]
    );

    // Create notification for the requester
    await executeQuery(
      'INSERT INTO notifications (user_id, type, title, content, data) VALUES (?, ?, ?, ?, ?)',
      [
        request.user_id,
        'friend_accepted',
        'Friend Request Accepted',
        `${req.user.display_name} accepted your friend request`,
        JSON.stringify({ friend_user_id: userId, friend_username: req.user.username })
      ]
    );

    // Log activity
    await executeQuery(
      'INSERT INTO user_activity (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
      [userId, 'friend_request_accepted', JSON.stringify({ friend_id: request.user_id }), req.ip]
    );

    res.json({ message: 'Friend request accepted successfully' });
  } catch (error) {
    console.error('Accept friend request error:', error);
    res.status(500).json({ error: 'Failed to accept friend request' });
  }
});

// Decline friend request
router.delete('/decline/:requestId', authenticateToken, async (req, res) => {
  try {
    const { requestId } = req.params;
    const userId = req.user.id;

    // Check if request exists and belongs to user
    const requests = await executeQuery(
      'SELECT user_id FROM friends WHERE id = ? AND friend_id = ? AND status = ?',
      [requestId, userId, 'pending']
    );

    if (requests.length === 0) {
      return res.status(404).json({ error: 'Friend request not found' });
    }

    // Delete friend request
    await executeQuery('DELETE FROM friends WHERE id = ?', [requestId]);

    // Log activity
    await executeQuery(
      'INSERT INTO user_activity (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
      [userId, 'friend_request_declined', JSON.stringify({ request_id: requestId }), req.ip]
    );

    res.json({ message: 'Friend request declined successfully' });
  } catch (error) {
    console.error('Decline friend request error:', error);
    res.status(500).json({ error: 'Failed to decline friend request' });
  }
});

// Remove friend
router.delete('/:friendId', authenticateToken, async (req, res) => {
  try {
    const { friendId } = req.params;
    const userId = req.user.id;

    // Check if friendship exists
    const friendships = await executeQuery(
      'SELECT id FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)',
      [userId, friendId, friendId, userId]
    );

    if (friendships.length === 0) {
      return res.status(404).json({ error: 'Friendship not found' });
    }

    // Delete friendship
    await executeQuery(
      'DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)',
      [userId, friendId, friendId, userId]
    );

    // Log activity
    await executeQuery(
      'INSERT INTO user_activity (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
      [userId, 'friend_removed', JSON.stringify({ friend_id: friendId }), req.ip]
    );

    res.json({ message: 'Friend removed successfully' });
  } catch (error) {
    console.error('Remove friend error:', error);
    res.status(500).json({ error: 'Failed to remove friend' });
  }
});

// Block user
router.post('/block', [
  authenticateToken,
  body('friend_id').isInt().withMessage('Invalid friend ID')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { friend_id } = req.body;
    const userId = req.user.id;

    if (friend_id === userId) {
      return res.status(400).json({ error: 'Cannot block yourself' });
    }

    // Check if friend exists
    const friends = await executeQuery('SELECT id FROM users WHERE id = ? AND is_banned = FALSE', [friend_id]);
    if (friends.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Delete existing friendship if any
    await executeQuery(
      'DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)',
      [userId, friend_id, friend_id, userId]
    );

    // Create blocked relationship
    await executeQuery(
      'INSERT INTO friends (user_id, friend_id, status) VALUES (?, ?, ?)',
      [userId, friend_id, 'blocked']
    );

    // Log activity
    await executeQuery(
      'INSERT INTO user_activity (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
      [userId, 'user_blocked', JSON.stringify({ friend_id }), req.ip]
    );

    res.status(201).json({ message: 'User blocked successfully' });
  } catch (error) {
    console.error('Block user error:', error);
    res.status(500).json({ error: 'Failed to block user' });
  }
});

// Unblock user
router.delete('/unblock/:friendId', authenticateToken, async (req, res) => {
  try {
    const { friendId } = req.params;
    const userId = req.user.id;

    // Check if blocked relationship exists
    const blocked = await executeQuery(
      'SELECT id FROM friends WHERE user_id = ? AND friend_id = ? AND status = ?',
      [userId, friendId, 'blocked']
    );

    if (blocked.length === 0) {
      return res.status(404).json({ error: 'User is not blocked' });
    }

    // Remove blocked relationship
    await executeQuery(
      'DELETE FROM friends WHERE user_id = ? AND friend_id = ? AND status = ?',
      [userId, friendId, 'blocked']
    );

    // Log activity
    await executeQuery(
      'INSERT INTO user_activity (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
      [userId, 'user_unblocked', JSON.stringify({ friend_id: friendId }), req.ip]
    );

    res.json({ message: 'User unblocked successfully' });
  } catch (error) {
    console.error('Unblock user error:', error);
    res.status(500).json({ error: 'Failed to unblock user' });
  }
});

// Get blocked users
router.get('/blocked', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const blocked = await executeQuery(`
      SELECT 
        f.id, f.created_at,
        u.id as friend_id, u.username, u.display_name, u.avatar_url, u.status
      FROM friends f
      JOIN users u ON f.friend_id = u.id
      WHERE f.user_id = ? AND f.status = 'blocked'
      ORDER BY f.created_at DESC
    `, [userId]);

    res.json({ blocked });
  } catch (error) {
    console.error('Get blocked users error:', error);
    res.status(500).json({ error: 'Failed to get blocked users' });
  }
});

module.exports = router;
