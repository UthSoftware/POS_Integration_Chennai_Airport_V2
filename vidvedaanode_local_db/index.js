require('dotenv').config();
const express = require('express');
const vendorDataRoutes = require('./src/api/routes/VendorDataRoutes');
const createLogger = require('./src/config/logger');


const logger = createLogger('api');


const app = express();
const PORT = process.env.API_PORT || 30037;
// app.use(express.json());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));


// routes
app.use('/api', vendorDataRoutes);

// health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date() });
});

app.listen(PORT, () => {
  logger.info(`API server started on port ${PORT}`);
  console.log(`🚀 API running on port ${PORT}`);
});