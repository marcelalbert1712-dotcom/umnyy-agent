module.exports = {
  apps: [{
    name: "umnyy-agent",
    script: "node_modules/vite/bin/vite.js",
    cwd: __dirname,
    watch: false,
    autorestart: true,
    env: {
      NODE_ENV: "development",
    },
  }],
};
