require('dotenv').config();
const { initDb } = require('../src/utils/db');

initDb()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
