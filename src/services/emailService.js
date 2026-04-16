const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

async function sendEmail({ to, subject, text, html, attachments }) {
  const info = await transporter.sendMail({
    from: `"Invitify Notification" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    text,
    html: html || `<p>${text}</p>`,
    attachments: attachments || [],
  });

  return info;
}

module.exports = {
  sendEmail,
};
