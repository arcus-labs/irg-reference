const { servicePorts } = require('./shared/runtime-defaults.json');

module.exports = {
  apps: [
    {
      name: 'trace-navigator',
      cwd: './trace-navigator',
      script: 'npm',
      args: `start -- --hostname 127.0.0.1 --port ${servicePorts.traceNavigator}`,
      env: {
        NODE_ENV: 'production',
        PORT: String(servicePorts.traceNavigator),
      },
      autorestart: true,
      watch: false,
      time: true,
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '1G',
    },
    {
      name: 'irg-api',
      cwd: './api-impl-js',
      script: 'npm',
      args: 'run api',
      env: {
        NODE_ENV: 'production',
        IRG_API_PORT: String(servicePorts.irgApi),
      },
      autorestart: true,
      watch: false,
      time: true,
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '1G',
    },
  ],
};