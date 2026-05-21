const { createProxyMiddleware } = require("http-proxy-middleware");

module.exports = function (app) {
  app.use(
    "/api",
    createProxyMiddleware({
      target: process.env.REACT_APP_API_PROXY || "https://api.studio7.miami",
      changeOrigin: true,
      secure: true,
    })
  );
};
