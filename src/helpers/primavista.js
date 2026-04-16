const crypto = require('crypto');

const CLIENT_KEY = process.env.PV_CLIENT_KEY;   // e.g. "0195a318-f1ea-789d-b746-..."
const SECRET_KEY = process.env.PV_SECRET_KEY;
const BASE_URL   = 'https://merchant-dev.pvpg.co.id:7977';

/**
 * Build x-client-id header: BASE64(CLIENT_KEY)
 */
function encodeClientId() {
  return Buffer.from(CLIENT_KEY).toString('base64');
}

/**
 * Generate x-signature per Primavista spec:
 *   step1 = SHA256( [expires]:[orderId]:[userId]:[merchantName]:[method]:[amount]:[customer]:[currency]:[pushUrl]:[callbackUrl] )
 *   step2 = lowercase(step1) + ":" + clientKey + ":" + timestamp
 *   sig   = BASE64( HMAC-SHA256(step2, SECRET_KEY) )
 */
function generateSignature({ expiresIn, orderId, userId, merchantName, paymentMethod,
                              totalAmount, customerName, currency, pushUrl, callbackUrl, timestamp }) {
  const payload1 = [
    expiresIn, orderId, userId, merchantName,
    paymentMethod, totalAmount, customerName,
    currency, pushUrl, callbackUrl
  ].join(':');

  const sha256hex = crypto.createHash('sha256').update(payload1).digest('hex').toLowerCase();

  const payload2 = `${sha256hex}:${CLIENT_KEY}:${timestamp}`;

  const hmac = crypto.createHmac('sha256', SECRET_KEY).update(payload2).digest();
  return Buffer.from(hmac).toString('base64');
}

module.exports = { BASE_URL, encodeClientId, generateSignature };