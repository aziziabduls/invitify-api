const { pool } = require('../utils/db');
const { sendEmail } = require('./emailService');
const QRCode = require('qrcode');

async function markAsPaid(participantId, eventId) {
  const pId = Number(participantId);
  const eId = eventId ? Number(eventId) : null;
  
  if (isNaN(pId)) return null;

  // 1. Update status to 'paid' (idempotent: only if not already 'paid')
  let result = await pool.query(
    `WITH updated AS (
        UPDATE event_participants 
        SET status = 'paid', updated_at = NOW() 
        WHERE id = $1 AND status != 'paid' ${eId ? 'AND event_id = $2' : ''} 
        RETURNING *
    )
    SELECT u.*, e.name as event_name 
    FROM updated u
    JOIN events e ON e.id = u.event_id`,
    eId ? [pId, eId] : [pId],
  );

  let isJustPaid = true;

  if (result.rows.length === 0) {
    // If no row was updated, it might already be paid. Fetch the record anyway to return to UI.
    result = await pool.query(
      `SELECT p.*, e.name as event_name 
       FROM event_participants p
       JOIN events e ON e.id = p.event_id
       WHERE p.id = $1 ${eId ? 'AND p.event_id = $2' : ''}`,
      eId ? [pId, eId] : [pId],
    );
    isJustPaid = false;
  }

  if (result.rows.length === 0) {
    return null;
  }

  const paid = result.rows[0];

  // 2. Generate QR and Send Email (Background) - ONLY IF JUST MARKED AS PAID
  if (isJustPaid) {
    (async () => {
      try {
        const payload = {
          eventId: paid.event_id,
          participantId: paid.id,
          email: paid.customer_email,
          type: 'attendance_check',
        };
        
        const qrBuffer = await QRCode.toBuffer(JSON.stringify(payload), { type: 'png' });
        const cid = `attendance_qr_${paid.id}`;
        
        const html = `
          <div style="font-family: Arial, sans-serif; line-height:1.6; max-width: 600px; margin: 0 auto; border: 1px solid #eee; padding: 20px; border-radius: 10px;">
            <h2 style="color: #4F46E5;">Payment Confirmed!</h2>
            <p>Hi <strong>${paid.customer_name}</strong>,</p>
            <p>Your payment for <strong>${paid.event_name}</strong> has been successfully confirmed. You're all set!</p>
            
            <div style="background-color: #F9FAFB; padding: 15px; border-radius: 8px; margin: 20px 0; text-align: center;">
              <p style="margin-top: 0; font-weight: bold; color: #374151;">Your Entry QR Code</p>
              <img src="cid:${cid}" alt="Attendance QR" style="width:220px;height:220px;border: 4px solid #fff; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); border-radius:12px;" />
              <p style="margin-bottom: 0; font-size: 12px; color: #6B7280;">Show this QR at the event booth to check-in.</p>
            </div>
            
            <div style="font-size: 14px; color: #4B5563;">
              <p><strong>Transaction Detail:</strong></p>
              <ul style="list-style: none; padding: 0;">
                <li>Reference ID: ${paid.reference_id || 'P-' + paid.event_id + '-' + paid.id}</li>
                <li>Amount Paid: Rp ${Number(paid.final_price).toLocaleString('id-ID')}</li>
                <li>Status: Paid</li>
              </ul>
            </div>
            
            <p style="font-size: 12px; color: #9CA3AF; margin-top: 30px; border-top: 1px solid #eee; pt: 10px;">
              If the QR code is not visible, please "allow images" from this sender in your email client.
            </p>
          </div>`;

        await sendEmail({
          to: paid.customer_email,
          subject: `[Paid] Payment Confirmation: ${paid.event_name}`,
          text: `Payment confirmed for ${paid.event_name}. Your attendance QR code is attached.`,
          html,
          attachments: [
            {
              filename: `qr-${paid.id}.png`,
              content: qrBuffer,
              contentType: 'image/png',
              cid,
            },
          ],
        });
        
        console.log(`[Service] Status updated and email sent for participant ${participantId}`);
      } catch (err) {
        console.error(`[Service] Error sending confirmation email for ${participantId}:`, err.message);
      }
    })();
  }

  return paid;
}

module.exports = {
  markAsPaid,
};
