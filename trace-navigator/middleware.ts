import { withAuth } from 'next-auth/middleware';
import { isEmailAllowed } from './src/lib/access-control';

export default withAuth({
  pages: {
    signIn: '/login',
  },
  callbacks: {
    authorized: ({ token }) => isEmailAllowed(token?.email),
  },
});

export const config = {
  matcher: ['/((?!api|login|_next/static|_next/image|favicon.ico|arcus.logo.jpeg).*)'],
};