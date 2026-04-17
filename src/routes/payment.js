const express = require('express');
const axios = require('axios');
const { BASE_URL, encodeClientId, generateSignature } = require('../helpers/primavista');
const { pool } = require('../utils/db');
const { markAsPaid } = require('../services/participantService');

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
  const { orderId: rawOrderId } = req.body;
  if (!rawOrderId) return res.status(400).json({ error: 'orderId is required' });

  // Clean orderId from any appended noise (e.g. ?id=...)
  const orderId = rawOrderId.split('?')[0];

  try {
    const statusUrl = `${BASE_URL}/api/v2/general-check-payment`;
    const response = await axios.post(
      statusUrl,
      {
        payment_id: orderId,
        merchant_key: encodeClientId(),
      },
      {
        headers: { 'Content-Type': 'application/json' },
        validateStatus: () => true, // Handle all status codes manually
        timeout: 5000 // Stop waiting after 5 seconds
      }
    );

    const data = response.data;
    const httpStatus = response.status;

    if (httpStatus >= 400) {
      console.warn(`[PV Status] Gateway returned ${httpStatus}:`, data);
    }

    let participant = null;
    if (orderId && orderId.startsWith('P-')) {
      const parts = orderId.split('-');
      const participantIdStr = parts[parts.length - 1];
      const participantId = Number(participantIdStr);
      const eventId = Number(parts[1]);

      if (!isNaN(participantId)) {
        // If payment is successful, update our database using service
        if (data.payment_status === 'PAID' || data.transaction_status === 'SUCCESS') {
          participant = await markAsPaid(participantId, eventId);
        }

        // Always try to fetch participant info for the UI if we don't have it yet
        if (!participant) {
          const dbRes = await pool.query(
            "SELECT customer_name, customer_email FROM event_participants WHERE id = $1",
            [participantId]
          );
          participant = dbRes.rows[0];
        }
      }
    }

    res.json({
      ...(data || {}),
      customer_name: participant?.customer_name || data?.customer_name || 'Guest',
      customer_email: participant?.customer_email || '',
    });
  } catch (err) {
    console.error('[PV Status] Fatal Error:', err);
    res.status(500).json({ 
      error: 'Internal Server Error', 
      message: err.message
    });
  }
});

// ─── POST /api/payment/webhook ───────────────────────────────────────────────
// This URL goes in push_url when creating a payment
router.post('/webhook', express.json(), async (req, res) => {
  const notif = req.body;
  /*
    notif shape per Merchant Integration Document v2.1.0 (Page 10):
    {
      payment_method, transaction_id, transaction_time,
      transaction_status, payment_id, order_id,
      amount, payment_status,   // "PAID" | "NOT PAID"
      payment_time, account_number, issuer_name
    }
  */
  console.log('[PV webhook]', notif);

  try {
    if (notif.payment_status === 'PAID') {
      const referenceId = notif.order_id;
      if (referenceId && referenceId.startsWith('P-')) {
        const parts = referenceId.split('-');
        const participantId = parts[parts.length - 1];
        const eventId = parts[1];

        await markAsPaid(participantId, eventId);
      }
    }
    res.sendStatus(200); // Primavista expects a 200 OK
  } catch (err) {
    console.error('[PV webhook] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;