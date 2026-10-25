/** @type {import('next').NextConfig} */
const nextConfig = {
  // The app is also opened from the machine's LAN address during local testing.
  allowedDevOrigins: ["192.168.1.60"],
};

export default nextConfig;
