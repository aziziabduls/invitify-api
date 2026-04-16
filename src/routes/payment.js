const express = require('express');
const axios = require('axios');
const { BASE_URL, encodeClientId, generateSignature } = require('../helpers/primavista');

const router = express.Router();

// ─── POST /api/payment/create ───────────────────────────────────────────────
router.post('/create', async (req, res) => {
  const {
    orderId, userId = '1', merchantName,
    paymentMethod = '',  // '' = show all methods
    totalAmount, customerName,
    currency = 'IDR',
    items = [], shippingAddress = {},
    pushUrl, callbackUrl,
    expiresIn = '120',
  } = req.body;

  const timestamp = new Date().toISOString(); // e.g. "2025-03-21T06:50:02.358Z"

  const signature = generateSignature({
    expiresIn, orderId, userId, merchantName, paymentMethod,
    totalAmount, customerName, currency, pushUrl, callbackUrl, timestamp,
  });

  const payload = {
    expires_in: expiresIn,
    order_id: orderId,
    user_id: userId,
    merchant_name: merchantName,
    payment_method: paymentMethod,
    total_amount: totalAmount,
    customer_name: customerName,
    currency,
    push_url: pushUrl,
    callback_url: callbackUrl,
    items,
    shipping_address: shippingAddress,
    courier_agent: '',
    'x-timestamp': timestamp,
    'x-client-id': encodeClientId(),
    'x-signature': signature,
  };

  try {
    const { data, request } = await axios.post(
      `${BASE_URL}/api/v2.1/payment/create`,
      payload,
      { headers: { 'Content-Type': 'application/json' }, maxRedirects: 0, validateStatus: s => s < 400 }
    );

    // The gateway responds with an HTML redirect page or a URL
    // Expose the redirect URL back to your frontend
    const redirectUrl = request.res?.responseUrl || data?.redirect_url || data;
    res.json({ redirectUrl });
  } catch (err) {
    const msg = err.response?.data || err.message;
    console.error('[PV] create error:', msg);
    res.status(502).json({ error: msg });
  }
});

// ─── POST /api/payment/status ────────────────────────────────────────────────
router.post('/status', async (req, res) => {
  const { orderId } = req.body;

  try {
    const { data } = await axios.post(
      `${BASE_URL}/api/v2/general-check-payment`,
      {
        payment_id: orderId,
        merchant_key: encodeClientId(),
      },
      { headers: { 'Content-Type': 'application/json' } }
    );
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.response?.data || err.message });
  }
});

// ─── POST /api/payment/webhook ───────────────────────────────────────────────
// This URL goes in push_url when creating a payment
router.post('/webhook', express.json(), (req, res) => {
  const notif = req.body;
  /*
    notif shape:
    {
      payment_method, transaction_id, transaction_time,
      transaction_status, payment_id, order_id,
      amount, payment_status,   // "PAID" | "NOT PAID"
      payment_time, account_number, issuer_name
    }
  */
  console.log('[PV webhook]', notif);

  if (notif.payment_status === 'PAID') {
    // TODO: mark your order as paid in the DB
    // await Order.update({ status: 'paid' }, { where: { id: notif.order_id } });
  }

  res.sendStatus(200); // Primavista expects a 200 OK
});

module.exports = router;