import type { NextConfig } from 'next';
import { httpUrl } from './lib/environment';
httpUrl('NEXT_PUBLIC_API_URL', process.env.NEXT_PUBLIC_API_URL);
const nextConfig: NextConfig = { output: 'standalone' };
export default nextConfig;
