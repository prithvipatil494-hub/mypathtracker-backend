const express = require('express');
const cors = require('cors');
require('dotenv').config();

// Connect to DB
require('./db');

const todosRouter = require('./todos');

const app = express();
const PORT = process.env.PORT || 5001;  // Changed from 5000 to 5001
app.use(cors());
app.use(express.json());

app.use('/api/todos', todosRouter);

app.get('/', (req, res) => {
  res.send('To‑Do API is running');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
