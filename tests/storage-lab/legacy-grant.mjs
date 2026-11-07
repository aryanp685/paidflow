// Test-only reconstruction of a grant issued before the security hold.
import {createHmac} from 'node:crypto';
export function legacyGrant({secret,id,sessionId,exp}) {
  const payload=Buffer.from(JSON.stringify({id,exp})).toString('base64url');
  const mac=createHmac('sha256',secret).update(`paidflow-storage-grant-v1.${payload}.${sessionId}`).digest('base64url');
  return `${payload}.${mac}`;
}
