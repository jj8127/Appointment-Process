// node hash-gen.mjs
import crypto from 'crypto';

const password = 'test1234!'; // 원하는 비밀번호
const salt = crypto.randomBytes(16);
const hash = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');

console.log('PASSWORD_SALT:', salt.toString('base64'));
console.log('PASSWORD_HASH:', hash.toString('base64'));
