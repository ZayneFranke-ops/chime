const jwt = require('jsonwebtoken');
const { executeQuery } = require('../config/database');

const JWT_SECRET = process.env.JWT_SECRET || 'chime-v2-secret-key-2025';

// Store active users and their socket connections
const activeUsers = new Map(); // userId -> socketId
const userSockets = new Map(); // socketId -> userId
const typingUsers = new Map(); // roomId -> Set of userIds

// Cleanup old typing indicators every 30 seconds
setInterval(() => {
  try {
    executeQuery(
      'DELETE FROM typing_indicators WHERE started_at < DATE_SUB(NOW(), INTERVAL 30 SECOND)'
    );
  } catch (error) {
    console.error('Error cleaning up typing indicators:', error);
  }
}, 30000);

// Authenticate socket connection
const authenticateSocket = async (socket, next) => {
  try {
    const token = socket.handshake.auth.token;
    
    if (!token) {
      return next(new Error('Authentication error'));
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Verify user exists and is not banned
    const users = await executeQuery(
      'SELECT id, username, display_name, avatar_url, status, is_banned FROM users WHERE id = ?',
      [decoded.userId]
    );

    if (users.length === 0) {
      return next(new Error('User not found'));
    }

    if (users[0].is_banned) {
      return next(new Error('Account suspended'));
    }

    socket.userId = decoded.userId;
    socket.user = users[0];
    next();
  } catch (error) {
    next(new Error('Authentication error'));
  }
};

const initializeSocket = (io) => {
  // Apply authentication middleware
  io.use(authenticateSocket);

  io.on('connection', (socket) => {
    console.log(`User ${socket.user.username} connected with socket ${socket.id}`);
    
    const userId = socket.userId;
    const user = socket.user;

    // Store user connection
    activeUsers.set(userId, socket.id);
    userSockets.set(socket.id, userId);

    // Update user status to online
    executeQuery(
      'UPDATE users SET status = "online", last_seen = CURRENT_TIMESTAMP WHERE id = ?',
      [userId]
    );

    // Log activity
    executeQuery(
      'INSERT INTO user_activity (user_id, action, ip_address) VALUES (?, ?, ?)',
      [userId, 'socket_connect', socket.handshake.address]
    );

    // Join user to their personal room for direct messages
    socket.join(`user_${userId}`);

    // Join public rooms
    socket.join('public_general');

    // Get user's private/group rooms and join them
    executeQuery(`
      SELECT rm.room_id 
      FROM room_members rm 
      JOIN chat_rooms cr ON rm.room_id = cr.id 
      WHERE rm.user_id = ? AND cr.is_active = TRUE
    `, [userId])
    .then(rooms => {
      rooms.forEach(room => {
        socket.join(`room_${room.room_id}`);
      });
    })
    .catch(error => {
      console.error('Error joining user to rooms:', error);
    });

    // Emit user online status to all connected users
    socket.broadcast.emit('user_online', {
      userId: userId,
      username: user.username,
      displayName: user.display_name,
      avatarUrl: user.avatar_url
    });

    // Handle joining a room
    socket.on('join_room', async (data) => {
      try {
        const { roomId } = data;
        
        // Check if user can access this room
        const rooms = await executeQuery(
          'SELECT type FROM chat_rooms WHERE id = ? AND is_active = TRUE',
          [roomId]
        );

        if (rooms.length === 0) {
          socket.emit('error', { message: 'Room not found' });
          return;
        }

        const room = rooms[0];

        // For private/group rooms, check membership
        if (room.type === 'private' || room.type === 'group') {
          const members = await executeQuery(
            'SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?',
            [roomId, userId]
          );

          if (members.length === 0) {
            socket.emit('error', { message: 'Access denied' });
            return;
          }
        }

        socket.join(`room_${roomId}`);
        socket.emit('joined_room', { roomId });

        // Notify others in the room
        socket.to(`room_${roomId}`).emit('user_joined_room', {
          userId: userId,
          username: user.username,
          displayName: user.display_name,
          avatarUrl: user.avatar_url,
          roomId: roomId
        });
      } catch (error) {
        console.error('Join room error:', error);
        socket.emit('error', { message: 'Failed to join room' });
      }
    });

    // Handle leaving a room
    socket.on('leave_room', (data) => {
      const { roomId } = data;
      socket.leave(`room_${roomId}`);
      
      // Notify others in the room
      socket.to(`room_${roomId}`).emit('user_left_room', {
        userId: userId,
        username: user.username,
        roomId: roomId
      });
    });

    // Handle sending messages
    socket.on('send_message', async (data) => {
      try {
        const { roomId, content, messageType = 'text', replyTo, fileUrl, fileName, fileSize } = data;

        // Validate message content
        if (!content || content.length > 2000) {
          socket.emit('error', { message: 'Invalid message content' });
          return;
        }

        // Check if user can send messages to this room
        const rooms = await executeQuery(
          'SELECT type FROM chat_rooms WHERE id = ? AND is_active = TRUE',
          [roomId]
        );

        if (rooms.length === 0) {
          socket.emit('error', { message: 'Room not found' });
          return;
        }

        const room = rooms[0];

        // For private/group rooms, check membership
        if (room.type === 'private' || room.type === 'group') {
          const members = await executeQuery(
            'SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?',
            [roomId, userId]
          );

          if (members.length === 0) {
            socket.emit('error', { message: 'Access denied' });
            return;
          }
        }

        // Insert message into database
        const result = await executeQuery(
          'INSERT INTO messages (room_id, user_id, content, message_type, reply_to, file_url, file_name, file_size) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [roomId, userId, content, messageType, replyTo, fileUrl, fileName, fileSize]
        );

        const messageId = result.insertId;

        // Get the created message with user info
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
        message.reactions = [];

        // Emit message to all users in the room
        io.to(`room_${roomId}`).emit('new_message', message);

        // Update user activity
        await executeQuery(
          'INSERT INTO user_activity (user_id, action, details, ip_address) VALUES (?, ?, ?)',
          [userId, 'message_sent', JSON.stringify({ room_id: roomId, message_id: messageId }), socket.handshake.address]
        );

      } catch (error) {
        console.error('Send message error:', error);
        socket.emit('error', { message: 'Failed to send message' });
      }
    });

    // Handle typing indicators
    socket.on('typing_start', async (data) => {
      try {
        const { roomId } = data;

        // Store typing indicator in database
        await executeQuery(
          'INSERT INTO typing_indicators (user_id, room_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE started_at = CURRENT_TIMESTAMP',
          [userId, roomId]
        );

        // Add to local typing set
        if (!typingUsers.has(roomId)) {
          typingUsers.set(roomId, new Set());
        }
        typingUsers.get(roomId).add(userId);

        // Emit typing indicator to other users in the room
        socket.to(`room_${roomId}`).emit('user_typing', {
          userId: userId,
          username: user.username,
          displayName: user.display_name,
          roomId: roomId
        });
      } catch (error) {
        console.error('Typing start error:', error);
      }
    });

    socket.on('typing_stop', async (data) => {
      try {
        const { roomId } = data;

        // Remove typing indicator from database
        await executeQuery(
          'DELETE FROM typing_indicators WHERE user_id = ? AND room_id = ?',
          [userId, roomId]
        );

        // Remove from local typing set
        if (typingUsers.has(roomId)) {
          typingUsers.get(roomId).delete(userId);
        }

        // Emit stop typing to other users in the room
        socket.to(`room_${roomId}`).emit('user_stopped_typing', {
          userId: userId,
          roomId: roomId
        });
      } catch (error) {
        console.error('Typing stop error:', error);
      }
    });

    // Handle message reactions
    socket.on('add_reaction', async (data) => {
      try {
        const { messageId, emoji } = data;

        // Add reaction to database
        await executeQuery(
          'INSERT INTO message_reactions (message_id, user_id, emoji) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE emoji = VALUES(emoji)',
          [messageId, userId, emoji]
        );

        // Get updated reaction count
        const reactions = await executeQuery(`
          SELECT 
            emoji, 
            COUNT(*) as count,
            GROUP_CONCAT(u.display_name) as users
          FROM message_reactions mr
          JOIN users u ON mr.user_id = u.id
          WHERE mr.message_id = ?
          GROUP BY emoji
        `, [messageId]);

        // Get message room
        const messages = await executeQuery(
          'SELECT room_id FROM messages WHERE id = ?',
          [messageId]
        );

        if (messages.length > 0) {
          const roomId = messages[0].room_id;
          
          // Emit reaction update to all users in the room
          io.to(`room_${roomId}`).emit('reaction_added', {
            messageId: messageId,
            emoji: emoji,
            userId: userId,
            username: user.username,
            reactions: reactions
          });
        }
      } catch (error) {
        console.error('Add reaction error:', error);
      }
    });

    socket.on('remove_reaction', async (data) => {
      try {
        const { messageId, emoji } = data;

        // Remove reaction from database
        await executeQuery(
          'DELETE FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?',
          [messageId, userId, emoji]
        );

        // Get updated reaction count
        const reactions = await executeQuery(`
          SELECT 
            emoji, 
            COUNT(*) as count,
            GROUP_CONCAT(u.display_name) as users
          FROM message_reactions mr
          JOIN users u ON mr.user_id = u.id
          WHERE mr.message_id = ?
          GROUP BY emoji
        `, [messageId]);

        // Get message room
        const messages = await executeQuery(
          'SELECT room_id FROM messages WHERE id = ?',
          [messageId]
        );

        if (messages.length > 0) {
          const roomId = messages[0].room_id;
          
          // Emit reaction update to all users in the room
          io.to(`room_${roomId}`).emit('reaction_removed', {
            messageId: messageId,
            emoji: emoji,
            userId: userId,
            reactions: reactions
          });
        }
      } catch (error) {
        console.error('Remove reaction error:', error);
      }
    });

    // Handle disconnect
    socket.on('disconnect', async () => {
      console.log(`User ${user.username} disconnected`);
      
      // Remove user from active users
      activeUsers.delete(userId);
      userSockets.delete(socket.id);

      // Remove user from all typing indicators
      typingUsers.forEach((users, roomId) => {
        users.delete(userId);
        if (users.size === 0) {
          typingUsers.delete(roomId);
        }
      });

      // Update user status to offline
      await executeQuery(
        'UPDATE users SET status = "offline", last_seen = CURRENT_TIMESTAMP WHERE id = ?',
        [userId]
      );

      // Log activity
      await executeQuery(
        'INSERT INTO user_activity (user_id, action, ip_address) VALUES (?, ?, ?)',
        [userId, 'socket_disconnect', socket.handshake.address]
      );

      // Emit user offline status to all connected users
      socket.broadcast.emit('user_offline', {
        userId: userId,
        username: user.username
      });
    });
  });
};

module.exports = {
  initializeSocket,
  activeUsers,
  userSockets
};
