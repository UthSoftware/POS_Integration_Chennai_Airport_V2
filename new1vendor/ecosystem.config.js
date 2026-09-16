module.exports = {
  apps: [{
    name: 'VidvedaSOAP',
    script: 'index.js',
    cwd: __dirname,
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    env: {
      ENABLE_SCHEDULER: 'true',
      DATA_SOURCE_MODE: 'auto',
      NODE_ENV: 'production'
    },
    error_file: './logs/pm2-err.log',
    out_file: './logs/pm2-out.log',
    log_file: './logs/pm2-combined.log',
    time: true,
    restart_delay: 5000,
    max_restarts: 999,
    min_uptime: '10s'
  }]
};
