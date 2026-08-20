const crypto = require('crypto');

const keys = crypto.createECDH('prime256v1');
keys.generateKeys();
console.log('VAPID_PUBLIC_KEY=' + keys.getPublicKey().toString('base64url'));
console.log('VAPID_PRIVATE_KEY=' + keys.getPrivateKey().toString('base64url'));
