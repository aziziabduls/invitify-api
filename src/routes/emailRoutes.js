const express = require('express');
const router = express.Router();
const { sendEmail } = require('../services/emailService');

router.post('/send-email', async (req, res) => {
  const { to, subject, text } = req.body;

  try {
    const info = await sendEmail({ to, subject, text });

    res.status(200).json({
      message: 'Email sent successfully',
      messageId: info.messageId,
    });
  } catch (error) {
    res.status(500).json({
      message: 'Failed to send email',
      error: error.message,
    });
  }
});

module.exports = router;