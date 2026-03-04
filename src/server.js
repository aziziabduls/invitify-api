const app = require('./app');
const { initDb } = require('./utils/db');

const PORT = process.env.PORT || 4000;

async function start() {
  await initDb();
  app.listen(PORT, () => {
    console.log(`API server listening on port ${PORT}`);
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

