require('dotenv').config();
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const itemRoutes = require('./routes/items');
const eventRoutes = require('./routes/events');
const participantRoutes = require('./routes/participants');
const clientRoutes = require('./routes/client');
const organizerRoutes = require('./routes/organizers');

const app = express();

app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use('/auth', authRoutes);
app.use('/items', itemRoutes);
app.use('/events', eventRoutes);
app.use('/participants', participantRoutes);
app.use('/client', clientRoutes);
app.use('/organizers', organizerRoutes);


app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
});

// import route
const emailRoutes = require('./routes/emailRoutes');

// pakai route
app.use('/api', emailRoutes);

module.exports = app;

