# Chime V2 - Advanced Chat Platform

Chime V2 is a modern, feature-rich chat platform built with React, Node.js, Express, Socket.io, and MySQL. It features a beautiful dark theme with orange accents, real-time messaging, typing indicators, file uploads, emoji reactions, and much more.

![Chime V2](https://img.shields.io/badge/Chime-V2-orange?style=for-the-badge&logo=react)
![React](https://img.shields.io/badge/React-18-blue?style=for-the-badge&logo=react)
![Node.js](https://img.shields.io/badge/Node.js-18-green?style=for-the-badge&logo=node.js)
![MySQL](https://img.shields.io/badge/MySQL-8.0-blue?style=for-the-badge&logo=mysql)

## ✨ Features

### 🎯 Core Features
- **Real-time Messaging** - Instant message delivery with Socket.io
- **Typing Indicators** - See when others are typing
- **Multiple Chat Rooms** - Public and private rooms
- **User Profiles** - Custom profiles with avatars and bios
- **Friend System** - Add, manage, and chat with friends
- **File Uploads** - Share images and files
- **Emoji Reactions** - React to messages with emojis
- **Message Replies** - Reply to specific messages
- **Message Editing** - Edit your own messages
- **Custom Emoji Picker** - Extensive emoji selection
- **Dark Theme** - Beautiful dark UI with orange accents
- **Responsive Design** - Works on desktop and mobile

### 🚀 Advanced Features
- **Voice Chat Ready** - Architecture prepared for voice features
- **Notification System** - Real-time notifications
- **User Status** - Online, away, busy, offline statuses
- **Search Functionality** - Search messages and users
- **Room Management** - Create and manage chat rooms
- **Message History** - Persistent message storage
- **User Authentication** - Secure JWT-based auth
- **File Management** - Organized file storage system
- **Activity Logging** - User activity tracking

## 🛠️ Tech Stack

### Backend
- **Node.js** - Runtime environment
- **Express.js** - Web framework
- **Socket.io** - Real-time communication
- **MySQL** - Database
- **JWT** - Authentication
- **Multer** - File uploads
- **Sharp** - Image processing
- **bcryptjs** - Password hashing

### Frontend
- **React 18** - UI framework
- **TypeScript** - Type safety
- **Styled Components** - CSS-in-JS styling
- **React Router** - Client-side routing
- **Socket.io Client** - Real-time communication
- **Axios** - HTTP client
- **Lucide React** - Icon library

## 📋 Prerequisites

Before you begin, ensure you have the following installed:
- **Node.js** (v18 or higher)
- **npm** or **yarn**
- **MySQL** (v8.0 or higher)
- **Git**

## 🚀 Quick Start

### 1. Clone the Repository
```bash
git clone <repository-url>
cd ChimeV2
```

### 2. Install Dependencies
```bash
# Install server dependencies
npm install

# Install client dependencies
cd client
npm install
cd ..
```

### 3. Database Setup

1. **Create the Database**
   - Open your MySQL client (phpMyAdmin, MySQL Workbench, or command line)
   - Create a new database named `if0_40232921_chime_api`
   - Import the schema from `database/schema.sql`

2. **Execute the SQL Script**
   ```sql
   -- Run the contents of database/schema.sql in your MySQL client
   ```

### 4. Environment Configuration

1. **Copy the environment file**
   ```bash
   cp env.example .env
   ```

2. **Update the environment variables** in `.env`:
   ```env
   # Database Configuration
   DB_HOST=sql311.infinityfree.com
   DB_USER=if0_40232921
   DB_PASSWORD=S4LYpeaeRQFmOh
   DB_NAME=if0_40232921_chime_api
   DB_PORT=3306

   # JWT Configuration
   JWT_SECRET=your-super-secret-jwt-key-here

   # Server Configuration
   PORT=5000
   NODE_ENV=development
   CLIENT_URL=http://localhost:3000

   # File Upload Configuration
   MAX_FILE_SIZE=10485760
   UPLOAD_DIR=uploads
   ```

### 5. Create Upload Directories
```bash
mkdir -p server/uploads/avatars
mkdir -p server/uploads/images
mkdir -p server/uploads/files
```

### 6. Start the Application

**Option 1: Start both server and client separately**
```bash
# Terminal 1 - Start the server
npm run server

# Terminal 2 - Start the client
npm run client
```

**Option 2: Start both with concurrently**
```bash
npm run dev
```

### 7. Access the Application

- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:5000
- **API Health Check**: http://localhost:5000/api/health

## 📁 Project Structure

```
ChimeV2/
├── client/                 # React frontend
│   ├── src/
│   │   ├── components/     # Reusable components
│   │   ├── contexts/       # React contexts
│   │   ├── pages/          # Page components
│   │   ├── styles/         # Global styles
│   │   └── ...
│   └── package.json
├── server/                 # Node.js backend
│   ├── config/            # Database configuration
│   ├── middleware/        # Express middleware
│   ├── routes/            # API routes
│   ├── socket/            # Socket.io handlers
│   ├── uploads/           # File uploads
│   └── index.js
├── database/              # Database schema
│   └── schema.sql
├── package.json           # Root package.json
├── vercel.json           # Vercel deployment config
└── README.md
```

## 🔧 Configuration

### Database Configuration
The application is configured to use the provided MySQL database:
- **Host**: sql311.infinityfree.com
- **User**: if0_40232921
- **Database**: if0_40232921_chime_api
- **Port**: 3306

### File Upload Configuration
- **Max file size**: 10MB
- **Allowed types**: Images, videos, audio, documents
- **Storage**: Local file system (can be configured for cloud storage)

### Socket.io Configuration
- **CORS**: Configured for development and production
- **Authentication**: JWT-based socket authentication
- **Events**: Real-time messaging, typing indicators, reactions

## 🎨 Theming

Chime V2 features a beautiful dark theme with orange accents:
- **Primary Color**: #ff6b35 (Orange)
- **Background**: Dark grays and blacks
- **Text**: White and light grays
- **Accents**: Orange highlights throughout

## 📱 Features Overview

### Landing Page
- Modern hero section with chat preview
- Feature showcase
- User statistics
- Call-to-action buttons

### Authentication
- User registration and login
- JWT-based authentication
- Secure password hashing
- Session management

### Chat Interface
- Real-time messaging
- Typing indicators
- Message reactions
- File uploads
- Emoji picker
- Message replies and editing

### User Management
- User profiles
- Avatar uploads
- Status updates
- Friend system
- Online/offline indicators

## 🚀 Deployment

### Vercel Deployment
The application is configured for Vercel deployment:

1. **Connect to Vercel**
   ```bash
   npm install -g vercel
   vercel login
   ```

2. **Deploy**
   ```bash
   vercel
   ```

3. **Environment Variables**
   Set the environment variables in your Vercel dashboard:
   - `DB_HOST`
   - `DB_USER`
   - `DB_PASSWORD`
   - `DB_NAME`
   - `JWT_SECRET`
   - `CLIENT_URL`

### Manual Deployment
For other hosting platforms:

1. **Build the client**
   ```bash
   cd client
   npm run build
   cd ..
   ```

2. **Start the server**
   ```bash
   npm start
   ```

## 🧪 Testing

### API Testing
Use tools like Postman or curl to test the API endpoints:

```bash
# Health check
curl http://localhost:5000/api/health

# Register user
curl -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","email":"test@example.com","password":"password123","display_name":"Test User"}'
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 👨‍💻 Author

**Zayne Franke** - 2025

## 🆘 Support

If you encounter any issues or have questions:

1. Check the [Issues](https://github.com/your-repo/issues) page
2. Create a new issue with detailed information
3. Include error messages and steps to reproduce

## 🔮 Future Features

- **Voice Chat** - Real-time voice communication
- **Video Calls** - Video calling functionality
- **Screen Sharing** - Share your screen with others
- **Message Encryption** - End-to-end encryption
- **Bot Integration** - Chat bot support
- **Mobile App** - React Native mobile app
- **Push Notifications** - Browser and mobile notifications
- **Message Search** - Advanced search functionality
- **Themes** - Multiple theme options
- **Custom Emojis** - Upload custom emojis

## 🎉 Acknowledgments

- React team for the amazing framework
- Socket.io for real-time communication
- MySQL for reliable database
- All the open-source contributors who made this possible

---

**Chime V2** - The future of online communication! 🚀
