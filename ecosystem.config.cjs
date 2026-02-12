module.exports = {
  apps: [{
    name: "CNCxSOHO",
    script: "dist/index.js",
    cwd: "/root/CNCxSOHO-Import-Tracker",
    node_args: "--env-file=.env",
    env: {
      NODE_ENV: "production",
      PORT: "5000",
      S3_ENDPOINT: "https://nbg1.your-objectstorage.com",
      S3_BUCKET: "soho1",
      S3_ACCESS_KEY: "7JWR3D385HJID27P6L2Y",
      S3_SECRET_KEY: "6qjdEBVLTMYjBbLOPbis0lcMQIW3dpoOB9bM9N1m"
    }
  }]
}
