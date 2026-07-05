const speakeasy = require('speakeasy');
const QRCode = require('qrcode');

const TOTP_ISSUER = process.env.TOTP_ISSUER || 'SecureAuth';

function generateSecret() {
  const secret = speakeasy.generateSecret({
    name: TOTP_ISSUER,
    length: 32
  });
  return {
    base32_secret: secret.base32,
    otpauth_url: secret.otpauth_url
  };
}

async function generateQR(secret, email) {
  const otpauthUrl = speakeasy.otpauthURL({
    secret: secret,
    label: email,
    issuer: TOTP_ISSUER,
    encoding: 'base32'
  });

  try {
    const qrCodeDataURL = await QRCode.toDataURL(otpauthUrl);
    return qrCodeDataURL;
  } catch (error) {
    console.error('QR Code generation error:', error);
    throw new Error('Failed to generate QR code');
  }
}

function verifyCode(secret, token, window = 1) {
  return speakeasy.totp.verify({
    secret: secret,
    encoding: 'base32',
    token: token,
    window: window
  });
}

function generateCode(secret) {
  return speakeasy.totp({
    secret: secret,
    encoding: 'base32'
  });
}

module.exports = {
  generateSecret, generateQR, verifyCode, generateCode
};
