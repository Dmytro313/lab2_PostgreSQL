const multer = require('multer');
const path = require('path');

// --- 1. Налаштування для Аватарів (зберігаємо на диск) ---
const avatarStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/avatars/'),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `user-${req.session.userId}-${Date.now()}${ext}`);
    }
});

const avatarUpload = multer({
    storage: avatarStorage,
    limits: { fileSize: 2 * 1024 * 1024 }, // 2 МБ
    fileFilter: (req, file, cb) => {
        const allowed = ['image/jpeg', 'image/png', 'image/webp'];
        if (allowed.includes(file.mimetype)) cb(null, true);
        else cb(new Error('Дозволені лише формати JPG, PNG та WebP'));
    }
});

// --- 2. Налаштування для Імпорту нотаток (зберігаємо в пам'ять) ---
const importStorage = multer.memoryStorage();

const importUpload = multer({
    storage: importStorage,
    limits: { fileSize: 1 * 1024 * 1024 }, // Обмеження 1 МБ за умовою лаби
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['text/csv', 'application/json'];
        const ext = path.extname(file.originalname).toLowerCase();
        
        // Перевіряємо і mimetype, і розширення файлу
        if (allowedTypes.includes(file.mimetype) || ext === '.csv' || ext === '.json') {
            cb(null, true);
        } else {
            cb(new Error('Дозволені лише файли формату .csv та .json'));
        }
    }
});

// Експортуємо обидва налаштування
module.exports = { avatarUpload, importUpload };