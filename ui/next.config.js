/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      { source: '/socket.io/:path*', destination: 'http://gateway:8080/socket.io/:path*' },
    ];
  },
};
module.exports = nextConfig;
