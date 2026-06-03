/** RFC 7636 PKCE (S256) for Grant Access /connect. */

function randomVerifier(length = 64) {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    let out = '';
    for (let i = 0; i < length; i++) {
        out += alphabet[bytes[i] % alphabet.length];
    }
    return out;
}

function base64UrlEncode(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function createPkcePair() {
    const codeVerifier = randomVerifier(64);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier));
    const codeChallenge = base64UrlEncode(digest);
    return { codeVerifier, codeChallenge, codeChallengeMethod: 'S256' };
}
