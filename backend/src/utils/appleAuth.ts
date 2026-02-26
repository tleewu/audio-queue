import jwt from 'jsonwebtoken';
import jwksRsa from 'jwks-rsa';

const APPLE_JWKS_URI = 'https://appleid.apple.com/auth/keys';

const jwksClient = jwksRsa({
  jwksUri: APPLE_JWKS_URI,
  cache: true,
  cacheMaxEntries: 5,
  cacheMaxAge: 600_000, // 10 minutes
});

export interface AppleTokenPayload {
  sub: string;   // Apple user ID
  email?: string;
}

export async function verifyAppleToken(identityToken: string): Promise<AppleTokenPayload> {
  const bundleId = process.env.IOS_BUNDLE_ID;
  if (!bundleId) throw new Error('IOS_BUNDLE_ID env var not set');

  // Decode header to get key ID
  const decoded = jwt.decode(identityToken, { complete: true });
  if (!decoded || typeof decoded === 'string' || !decoded.header.kid) {
    throw new Error('Invalid Apple identity token');
  }

  const key = await jwksClient.getSigningKey(decoded.header.kid);
  const publicKey = key.getPublicKey();

  const payload = jwt.verify(identityToken, publicKey, {
    algorithms: ['RS256'],
    audience: bundleId,
    issuer: 'https://appleid.apple.com',
  }) as jwt.JwtPayload;

  if (!payload.sub) throw new Error('Apple token missing sub claim');

  return { sub: payload.sub, email: payload.email };
}
